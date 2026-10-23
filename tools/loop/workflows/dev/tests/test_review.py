from __future__ import annotations

from pathlib import Path

from workflows.dev.tests.doubles import DevHarness, RecordingPhases, clean_review, crash, envelope, issue

AXES = ("bugs", "quality", "smells", "initiative")


def _review(head: str, *, outcomes: dict[str, str] | None = None, findings: list[dict] | None = None) -> str:
    outcomes = outcomes or {}
    axes = [{"name": name, "outcome": outcomes.get(name, "completed"), "note": ""} for name in AXES]
    return envelope("", result={"axes": axes, "findings": findings or [], "posted": ["c1"], "head": head})


def _run(harness: DevHarness, **kwargs) -> int:
    return harness.run(lambda prompt: harness.edit_and_report(10), **kwargs)


def _summary(harness: DevHarness) -> str:
    return [call[-1] for call in harness.calls("issue", "comment") if call[2] == "1"][-1]


def test_a_clean_review_at_the_current_head_marks_the_pull_request_ready(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    assert _run(harness) == 0

    assert harness.calls("pr", "ready") == [("pr", "ready", "https://github.com/owner/repo/pull/99", "--repo", "owner/repo")]
    assert "ready for review" in _summary(harness)
    assert harness.calls("issue", "close", "1") == []


def test_the_reviewer_runs_from_the_checkout_after_the_worktree_is_closed(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    closed_at_review: list[int] = []

    def reviewer(prompt: str) -> str:
        closed_at_review.append(harness.git_service.closed)
        return clean_review(harness.git.commits[-1].sha)

    harness.runner.review_handler = reviewer

    _run(harness)

    assert closed_at_review == [1]
    [prompt] = harness.runner.review_prompts
    assert f"`{harness.root}`" in prompt and "https://github.com/owner/repo/pull/99" in prompt
    assert harness.runner.profiles[-1].name == "reviewer"


def test_the_pull_request_body_starts_with_the_initiative_id_and_lists_the_tickets(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    _run(harness)

    [create] = harness.calls("pr", "create")
    body = create[create.index("--body") + 1]
    assert body.splitlines()[0] == "Checkout"
    assert "- [x] #10 Add login form" in body


def test_a_blocking_finding_keeps_the_pull_request_a_draft(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    finding = {"axis": "bugs", "kind": "bug", "summary": "null reference in Cart"}
    harness.runner.review_handler = lambda prompt: _review(harness.git.commits[-1].sha, findings=[finding])

    _run(harness)

    assert harness.calls("pr", "ready") == []
    summary = _summary(harness)
    assert "left as a draft" in summary and "null reference in Cart" in summary and "unresolved bug/initiative" in summary


def test_quality_findings_are_reported_but_do_not_block_readiness(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    finding = {"axis": "smells", "kind": "smell", "summary": "long method"}
    harness.runner.review_handler = lambda prompt: _review(harness.git.commits[-1].sha, findings=[finding])

    _run(harness)

    assert len(harness.calls("pr", "ready")) == 1 and "smell: long method" in _summary(harness)


def test_an_incomplete_axis_keeps_the_pull_request_a_draft(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    harness.runner.review_handler = lambda prompt: _review(harness.git.commits[-1].sha, outcomes={"bugs": "failed"})

    _run(harness)

    assert harness.calls("pr", "ready") == [] and "a review axis did not complete" in _summary(harness)


def test_a_review_of_another_head_keeps_the_pull_request_a_draft(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    harness.runner.review_handler = lambda prompt: _review("0ldh3ad")

    _run(harness)

    assert harness.calls("pr", "ready") == [] and "not " in _summary(harness)


def test_a_head_that_moved_after_the_review_keeps_the_pull_request_a_draft(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    def reviewer(prompt: str) -> str:
        reviewed = harness.git.commits[-1].sha
        harness.git.add_commit("someone pushed")
        return clean_review(reviewed)

    harness.runner.review_handler = reviewer

    _run(harness)

    assert harness.calls("pr", "ready") == [] and "moved to" in _summary(harness)


def test_a_reviewer_that_changes_the_checkout_is_rejected(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    def reviewer(prompt: str) -> str:
        harness.git.edit("src/oops.py")
        return clean_review(harness.git.commits[-1].sha)

    harness.runner.review_handler = reviewer

    _run(harness)

    assert harness.calls("pr", "ready") == []
    assert "read-only agent changed the working tree" in _summary(harness)


def test_a_crashing_reviewer_leaves_the_draft_and_does_not_fail_the_run(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    harness.runner.review_handler = crash()

    assert _run(harness) == 0

    assert harness.calls("pr", "ready") == [] and "the reviewer failed" in _summary(harness)


def test_a_ticket_left_for_a_human_keeps_the_pull_request_a_draft(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path, tickets={1: [issue(10, "Add login form"), issue(11, "Add tests", labels=("hitl",))]})

    _run(harness)

    assert harness.calls("pr", "ready") == []
    assert "Tickets held for a human: #11" in _summary(harness)


def test_no_review_runs_when_the_delivery_stopped_at_a_failed_ticket(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    assert harness.run(crash()) == 1

    assert harness.runner.review_prompts == [] and harness.calls("pr", "ready") == []


def test_finalize_never_merges_or_closes_the_spec(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    _run(harness)

    assert harness.calls("pr", "merge") == [] and all(call[2] != "1" for call in harness.calls("issue", "close"))


def test_the_summary_maps_commits_and_reports_the_chore(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    phases = RecordingPhases()

    _run(harness, phases=phases)

    summary = _summary(harness)
    assert "ccode(Checkout|10): work" in summary and "Chore: nothing" in summary
    assert "Review: bugs completed" in summary
