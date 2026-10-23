"""Settings, dependency wiring, and the dev entry point."""

from __future__ import annotations

import argparse
import logging
import os
from collections.abc import Callable, Sequence
from functools import partial
from pathlib import Path

from loop import Agent, AgentBuilder, AgentOptions, AgentStartMode, LoopHook, configure_logging, otlp_observer

from .backlog import DevDeps, process_specs
from .checkout import GitService
from .journal import FileExecutionStore
from .platforms import GithubFactory, TicketsTracker, github_for
from .repositories import ESHOP, HARNESS, HARNESS_ROOT, RepositoryWorkflow, configured_repositories


logger = logging.getLogger("workflow.dev")


LOG_DIR_NAME = ".loop"


LOG_LEVEL = "INFO"


# WORKTREE starts every agent CLI in the branch worktree; HARNESS starts it in HARNESS_ROOT and prefixes the prompt with an instruction to change into the worktree.
# eShop is its own harness, so there is no shared context to start from.
START_MODE = AgentStartMode.WORKTREE


LOOP_HOOKS: tuple[LoopHook, ...] = ()


MAX_TICKET_FAILURES = 2


# The standalone Aspire dashboard's OTLP/HTTP port (`aspire dashboard run`).
DEFAULT_OTEL_ENDPOINT = "http://localhost:4318"


OTEL_SERVICE_NAME = "loop-dev"


def _with_telemetry(new_agent: Callable[[], AgentBuilder], endpoint: str) -> Callable[[], AgentBuilder]:
    """Reports every Agent Run and Worktree over OTLP/HTTP to `endpoint`; needs the `loop[otel]` extra."""
    # One observer for the whole run so spans share providers and metrics aggregate.
    observer = otlp_observer(endpoint=endpoint, service_name=OTEL_SERVICE_NAME, resource_per_agent=True)
    return lambda: new_agent().with_observer(observer)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="dev")
    parser.add_argument("--log-dir", type=Path, default=None)
    parser.add_argument("--log-level", default=LOG_LEVEL)
    parser.add_argument("--spec", type=int, default=None, metavar="NUMBER", help="deliver only this Spec issue number")
    parser.add_argument(
        "--otel-endpoint",
        default=None,
        metavar="URL",
        help=f"OTLP/HTTP base URL for traces and metrics (default: OTEL_EXPORTER_OTLP_ENDPOINT, else {DEFAULT_OTEL_ENDPOINT})",
    )
    parser.add_argument("--no-otel", action="store_true", help="do not export telemetry")
    return parser.parse_args(argv)


def main(
    argv: list[str] | None = None,
    *,
    git: GitService | None = None,
    github_factory: GithubFactory | None = None,
    new_agent: Callable[[], AgentBuilder] | None = None,
    store: FileExecutionStore | None = None,
    loop_hooks: tuple[LoopHook, ...] = LOOP_HOOKS,
    repositories: Sequence[RepositoryWorkflow] | None = None,
) -> int:
    """Delivers harness Specs through configured repositories, defaulting to implementation on the implementation repository."""
    args = _parse_args(argv)

    log_dir = (args.log_dir or Path.cwd() / LOG_DIR_NAME).resolve()
    # The workflow is the application: it owns the root logger so its own records land in the same file.
    configure_logging(args.log_level, log_file=log_dir / "dev.log", logger="")

    try:
        github = github_for(HARNESS, github_factory)
        if repositories is None:
            repositories = configured_repositories(ESHOP)
        if new_agent is None:
            new_agent = partial(Agent, AgentOptions(start_mode=START_MODE, harness_dir=HARNESS_ROOT))
            if not args.no_otel:
                endpoint = args.otel_endpoint or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or DEFAULT_OTEL_ENDPOINT
                new_agent = _with_telemetry(new_agent, endpoint)
        deps = DevDeps(
            tracker=TicketsTracker(HARNESS.owner_name.owner, HARNESS.owner_name.repo, gh=github.run),
            store=store or FileExecutionStore(log_dir),
            git=git or GitService(),
            new_agent=new_agent,
            loop_hooks=loop_hooks,
            ticket_repository=HARNESS.owner_name,
            github_factory=github_factory,
            max_ticket_failures=MAX_TICKET_FAILURES,
            spec_number=args.spec,
        )
        return process_specs(repositories, deps)
    except Exception as exception:  # last-resort boundary: log and fail, never crash bare
        logger.exception("unexpected error: %s", exception)
        return 1
