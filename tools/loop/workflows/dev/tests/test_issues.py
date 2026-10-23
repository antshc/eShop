from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from workflows.dev.tests.doubles import commit_file, git
from workflows.dev.commands import CommandError
from workflows.dev.platforms import GitHubRepo, TicketsTracker
from workflows.dev.records import PlannedTicket, Spec, TicketWorkflowError
from workflows.dev.tests.doubles import FakeGhCli, issue


def _tracker(gh: FakeGhCli | Mock | None = None) -> TicketsTracker:
    return TicketsTracker("owner", "repo", gh=gh or FakeGhCli())


def _spec() -> Spec:
    return Spec(number=1, title="t", url="u", labels=())


def test_ticket_writes_map_to_the_matching_gh_command() -> None:
    gh = FakeGhCli()
    spec = _spec()
    spec.comment("hello")
    spec.hand_to_human("done")

    _tracker(gh).update_spec(spec)

    assert gh.calls == [
        ("issue", "comment", "1", "--repo", "owner/repo", "--body", "hello"),
        ("issue", "edit", "1", "--repo", "owner/repo", "--add-label", "hitl"),
        ("issue", "comment", "1", "--repo", "owner/repo", "--body", "done"),
    ]


def test_non_zero_gh_exit_raises_a_command_error_with_the_command_and_output() -> None:
    gh = Mock(side_effect=CommandError("gh issue comment 1", 1, "not found"))

    spec = _spec()
    spec.comment("x")

    with pytest.raises(CommandError, match="not found"):
        _tracker(gh).update_spec(spec)


def test_from_origin_reads_the_origin_remote(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    commit_file(repo, "README.md", "hello\n", "initial")
    git(repo, "remote", "add", "origin", "https://example.com/owner/repo.git")
    with pytest.raises(ValueError, match="unsupported remote"):
        GitHubRepo.from_origin(repo)

    git(repo, "remote", "set-url", "origin", "git@github.com:acme/harness.git")
    github_repo = GitHubRepo.from_origin(repo)

    assert github_repo.slug == "acme/harness"


def test_specs_report_how_many_sub_issues_exist_and_which_are_held_for_a_human() -> None:
    gh = FakeGhCli(
        specs=[issue(1, "Spec", labels=["spec"]), issue(2, "Empty", labels=["spec"])],
        tickets={1: [issue(10, "Open"), issue(11, "Held", labels=["hitl"]), issue(12, "Done", state="CLOSED")]},
    )

    first, second = _tracker(gh).specs()

    assert (first.sub_issue_total, first.held_tickets, [t.number for t in first.tickets]) == (3, (11,), [10])
    assert (second.sub_issue_total, second.needs_plan) == (0, True) and not first.needs_plan


def test_planned_tickets_become_linked_sub_issues_with_their_blockers_in_the_body() -> None:
    gh = FakeGhCli()
    spec = _spec()

    created = _tracker(gh).create_tickets(
        spec, [PlannedTicket("A", "body a"), PlannedTicket("B", "body b", (0,)), PlannedTicket("C", "c", (0, 1))]
    )

    assert [ticket.number for ticket in created] == [101, 102, 103]
    assert spec.tickets == created and spec.sub_issue_total == 3 and spec.has_work
    bodies = [call[call.index("--body") + 1] for call in gh.calls if call[:2] == ("issue", "create")]
    assert bodies == ["body a", "body b\n\nBlocked by #101", "c\n\nBlocked by #101, #102"]
    assert ("api", "--method", "POST", "repos/owner/repo/issues/1/sub_issues", "-F", "sub_issue_id=1101") in gh.calls


def test_a_failed_creation_reports_the_tickets_made_so_far_and_leaves_the_spec_unchanged() -> None:
    gh = FakeGhCli()
    real = gh.__call__

    def flaky(args: tuple[str, ...]) -> str:
        if args[:2] == ("issue", "create") and gh.next_issue > 100:
            raise CommandError("gh issue create", 1, "boom")
        return real(args)

    spec = _spec()

    with pytest.raises(TicketWorkflowError, match="after creating #101"):
        _tracker(flaky).create_tickets(spec, [PlannedTicket("A", ""), PlannedTicket("B", "")])

    assert spec.tickets == () and spec.sub_issue_total == 0
