"""Configured repositories and their agent delegates."""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from pathlib import Path

from .agent import chore_pull_request, implement_ticket, load_prompt
from .records import AgentWorkflow, ChoreWorkflow, Repository, RepositoryId


_ROOT = Path(__file__).resolve().parents[2]

# Git root of the eShop repository: where agents start in harness mode, whatever the invoking shell's cwd.
HARNESS_ROOT = _ROOT.parents[1]


# eShop is its own harness: Specs and Tickets live in the repository that the agents change.
# Worktrees must sit inside the directory the workflow runs from (the repository root), and .loop/ is gitignored.
ESHOP: Repository = Repository(
    checkout=HARNESS_ROOT,
    worktrees=HARNESS_ROOT / ".loop" / "worktrees",
    owner_name=RepositoryId("antshc", "eShop"),
)

HARNESS: Repository = ESHOP


@dataclass(frozen=True)
class RepositoryWorkflow:
    """One allowed target repository, the agent steps used to deliver its Tickets, and the optional chore step run after its PR is created."""

    repository: Repository
    run_agents: AgentWorkflow
    run_chore: ChoreWorkflow | None = None


def configured_repositories(implementation: Repository) -> tuple[RepositoryWorkflow, ...]:
    """Pairs each allowed checkout with its delegates; implements and cleans up on the implementation repository."""
    implement = partial(implement_ticket, template=load_prompt("implement"))
    chore = partial(chore_pull_request, template=load_prompt("chore"))
    return (RepositoryWorkflow(implementation, implement, chore),)
