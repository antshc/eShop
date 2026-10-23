"""Named prompt templates and the default implementation agent delegate."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path

from loop import AgentProfile, AgentRequest, AgentWorkspace, copilot

from .records import (
    AgentCommitSubject, ChoreContext, Ticket, TicketContext, TicketResult as DevResult,
    TicketWorkflowError as DevError, loop_session_name,
)
from .reply import DevResponse


logger = logging.getLogger("workflow.dev")

DEVELOPER = AgentProfile(copilot, model="claude-sonnet-5.5", reasoning_effort="medium")
CHORE = AgentProfile(copilot, model="gpt-6.1-sol", reasoning_effort="medium")


PROMPTS = Path(__file__).parent / "prompts"
PROMPT = PROMPTS / "implement.md"


def load_prompt(name: str) -> str:
    """Reads a named Markdown template from the dev prompt folder."""
    return (PROMPTS / f"{name}.md").read_text()


class PromptError(DevError):
    """A prompt template placeholder has no matching argument."""


_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def render_prompt(template: str, args: Mapping[str, str]) -> str:
    """Replaces each `{{KEY}}` placeholder; a missing argument raises, an unused one is logged."""
    used: set[str] = set()

    def substitute(match: re.Match[str]) -> str:
        key = match[1]
        if key not in args:
            raise PromptError(f"missing prompt argument: {key}")
        used.add(key)
        return args[key]

    rendered = _PLACEHOLDER.sub(substitute, template)
    for key in sorted(set(args) - used):
        logger.warning("unused prompt argument: %s", key)
    return rendered


def prompt_args(
    ticket: Ticket,
    identifier: AgentCommitSubject,
    initiative_commits: Sequence[str],
    worktree: Path,
    base_branch: str,
    feature_branch: str,
) -> dict[str, str]:
    """Values for every placeholder in the dev prompt template."""
    return {
        "TICKET_JSON": json.dumps(asdict(ticket), indent=2),
        "INITIATIVE_COMMITS": "\n".join(initiative_commits) or "No task commits for this Initiative exist on the feature branch yet.",
        "COMMIT_SUBJECT_PREFIX": identifier.to_subject(),
        "WORKTREE_PATH": str(worktree),
        "TARGET_BRANCH": base_branch,
        "FEATURE_BRANCH": feature_branch,
    }


def implement_ticket(context: TicketContext, worktree: AgentWorkspace, *, template: str) -> DevResult:
    """Runs one fresh implementation agent and decodes its response for the selected Ticket."""
    args = prompt_args(
        context.ticket,
        context.identifier,
        context.initiative_commits,
        worktree.path,
        context.base_branch,
        context.feature_branch,
    )
    prompt = render_prompt(template, args)
    name = loop_session_name(context.ticket.number, context.ticket.title)
    output = worktree.agent(DEVELOPER).run(AgentRequest(prompt, name)).output
    return DevResponse(context.identifier).decode(output)


def chore_args(context: ChoreContext, worktree: Path) -> dict[str, str]:
    """Values for every placeholder in the chore prompt template."""
    return {
        "PULL_REQUEST_URL": context.pull_request_url,
        "COMMIT_SUBJECT_PREFIX": context.commit_subject_prefix,
        "WORKTREE_PATH": str(worktree),
        "TARGET_BRANCH": context.base_branch,
        "FEATURE_BRANCH": context.feature_branch,
        "DIFF_DIR": str(context.diff_dir),
        "BRANCH_COMMITS": "\n\n".join(context.branch_commits) or "No commits exist on the feature branch yet.",
    }


def chore_pull_request(context: ChoreContext, worktree: AgentWorkspace, *, template: str) -> None:
    """Runs one fresh chore agent over the pull request's captured diff; its changes stay in the worktree."""
    prompt = render_prompt(template, chore_args(context, worktree.path))
    worktree.agent(CHORE).run(AgentRequest(prompt, context.session_name))
