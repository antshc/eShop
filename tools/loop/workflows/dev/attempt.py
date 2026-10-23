"""Ticket delivery: a developer agent edits, gates accept, the harness commits and closes."""

from __future__ import annotations

import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from loop import AgentWorkspace

from .checkout import GitService
from .gates import commit_subject, left_changes, made_no_commit
from .journal import FileExecutionStore
from .phases import Kind, Owner, Phase, Phases
from .platforms import TicketsTracker
from .records import (
    AgentCommitSubject, AgentWorkflow, Commit, RepositoryId, Spec, Ticket,
    TicketContext, TicketResult, TicketWorkflowError,
)


logger = logging.getLogger("workflow.tickets")


def deliver_tickets(
    spec: Spec,
    worktree: AgentWorkspace,
    run_agents: AgentWorkflow,
    *,
    git: GitService,
    tracker: TicketsTracker,
    store: FileExecutionStore,
    ticket_repository: RepositoryId,
    max_failures: int = 2,
    phases: Phases | None = None,
    publish: Callable[[], object] = lambda: None,
) -> bool:
    """Delivers actionable Tickets in order, retrying failed attempts and stopping at the failure cap.

    Per Ticket: one fresh developer agent, the gates, the harness's commit, the Ticket's closure, then `publish`.
    """
    if max_failures < 1:
        raise TicketWorkflowError("max_failures must be at least one")
    phases = phases or Phases()
    for ticket in spec.tickets:
        if not ticket.actionable:
            continue
        attempt = 0
        while True:
            attempt += 1
            head_before = git.head(worktree.path)
            context = _ticket_context(spec, ticket, worktree.path, git)
            with phases.phase(f"ticket #{ticket.number}", Kind.AGENT, Owner.DEVELOPER, ticket=ticket.number, attempt=attempt) as phase:
                result = _attempt(context, worktree, run_agents, git, head_before, phase)
            if isinstance(result, TicketResult):
                commit = _commit(context.identifier, ticket, result, worktree.path, git, phases)
                spec.close_ticket(
                    ticket.number, f"Delivered in {commit.sha}.\n\n{result.summary}\n\n{result.verification}"
                )
                with phases.phase("close-ticket", Kind.CODE, Owner.CODE, ticket=ticket.number, commit=commit.sha):
                    tracker.update_spec(spec)
                store.reset(ticket.url)
                publish()
                break
            logger.warning("ticket %s failed: %s", ticket.url, result)
            with phases.phase("restore", Kind.CODE, Owner.CODE, ticket=ticket.number, to=head_before.sha):
                git.restore(worktree.path, head_before.sha)
            if _record_failure(store, ticket_repository, ticket) >= max_failures:
                with phases.phase("escalate", Kind.CODE, Owner.CODE, ticket=ticket.number, reason=result):
                    spec.escalate(ticket.number, result)
                    tracker.update_spec(spec)
                return False
    return True


def _ticket_context(spec: Spec, ticket: Ticket, path: Path, git: GitService) -> TicketContext:
    base_branch, feature_branch = spec.base_branch, spec.feature_branch
    if base_branch is None or feature_branch is None:
        raise TicketWorkflowError(f"cannot resolve branches for Spec {spec.url}")
    identifier = AgentCommitSubject(spec.initiative, ticket.number)
    commits = git.initiative_commits(path, base_branch, identifier.initiative_commit_prefix)
    return TicketContext(
        ticket,
        identifier,
        tuple(f"{commit.sha[:7]} {commit.subject}" for commit in commits),
        base_branch,
        feature_branch,
    )


def _attempt(
    context: TicketContext,
    worktree: AgentWorkspace,
    run_agents: AgentWorkflow,
    git: GitService,
    head_before: Commit,
    phase: Phase,
) -> TicketResult | str:
    """Runs the developer and its gates; returns the accepted result, or the violation that rejects the attempt."""
    try:
        result = run_agents(context, worktree)
    except subprocess.CalledProcessError:
        phase.fail("agent process did not exit successfully")
        return "agent process did not exit successfully"
    except TicketWorkflowError as exception:
        phase.fail(str(exception))
        return str(exception)
    violation = _result_violation(context.identifier, result)
    if not phase.gate("response answers this Ticket and is complete", violation is None, violation or ""):
        return violation or "invalid response"
    violation = made_no_commit(git, worktree.path, head_before.sha)
    if not phase.gate("the agent did not commit", violation is None, violation or ""):
        return violation or "the agent committed"
    violation = left_changes(git, worktree.path)
    if not phase.gate("the agent left changes to commit", violation is None, violation or ""):
        return violation or "no changes"
    return result


def _result_violation(identifier: AgentCommitSubject, result: TicketResult) -> str | None:
    if result.identifier != str(identifier):
        return f"response identifier {result.identifier!r} does not match task {str(identifier)!r}"
    if result.status == "failed":
        return result.reason if isinstance(result.reason, str) else "failed result is missing reason"
    if result.status != "completed":
        return f"unknown result status: {result.status!r}"
    if not all(isinstance(value, str) for value in (result.commit_message, result.summary, result.verification)):
        return "completed result is missing a required commit_message, summary, or verification field"
    return None


def _commit(
    identifier: AgentCommitSubject, ticket: Ticket, result: TicketResult, path: Path, git: GitService, phases: Phases
) -> Commit:
    """The harness's own commit of the developer's work: the subject carries the initiative prefix, the body the agent's report."""
    subject = commit_subject(identifier.to_subject(), result.commit_message or "", ticket.title)
    body = f"{result.summary}\n\nVerification:\n{result.verification}"
    with phases.phase("commit", Kind.CODE, Owner.CODE, ticket=ticket.number) as phase:
        commit = git.commit(path, subject, body)
        phase.set(commit=commit.sha)
    return commit


def _record_failure(store: FileExecutionStore, repository: RepositoryId, ticket: Ticket) -> int:
    store.record_failure(
        ticket.url,
        owner=repository.owner,
        repo=repository.repo,
        task_id=str(ticket.number),
        title=ticket.title,
        items=[ticket.number],
    )
    return store.failed_attempts(ticket.url)
