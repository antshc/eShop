"""Configured repositories and their agent delegates."""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from pathlib import Path

from .agent import chore_pull_request, implement_ticket, load_prompt, plan_spec, review_pull_request, verify_app
from .records import (
    AgentWorkflow, ChoreWorkflow, PlanWorkflow, Repository, RepositoryId, ReviewWorkflow, VerifyWorkflow,
)


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
    """One allowed target repository, the developer step that delivers each Ticket, and the optional planner, verifier, chore and reviewer steps around it; a step left None is skipped."""

    repository: Repository
    run_agents: AgentWorkflow
    run_chore: ChoreWorkflow | None = None
    run_plan: PlanWorkflow | None = None
    run_verify: VerifyWorkflow | None = None
    run_review: ReviewWorkflow | None = None


def configured_repositories(implementation: Repository) -> tuple[RepositoryWorkflow, ...]:
    """Pairs each allowed checkout with its delegates; implements and cleans up on the implementation repository."""
    implement = partial(implement_ticket, template=load_prompt("implement"))
    chore = partial(chore_pull_request, template=load_prompt("chore"))
    plan = partial(plan_spec, template=load_prompt("plan"))
    verify = partial(verify_app, template=load_prompt("verify"))
    review = partial(review_pull_request, template=load_prompt("review"))
    return (RepositoryWorkflow(implementation, implement, chore, plan, verify, review),)
