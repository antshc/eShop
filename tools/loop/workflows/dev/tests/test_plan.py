from __future__ import annotations

import json
from pathlib import Path

import pytest

from workflows.dev.tests.doubles import DevHarness, envelope, issue

TWO_PLANNED = {
    "status": "completed",
    "result": {
        "tickets": [
            {"title": "Add the form", "body": "Build the form.", "blocked_by": []},
            {"title": "Validate the form", "body": "Add validation.", "blocked_by": [0]},
        ]
    },
}


def _unplanned(tmp_path: Path) -> DevHarness:
    return DevHarness(tmp_path, tickets={1: []})


def test_a_spec_without_sub_issues_is_planned_then_delivered(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)
    harness.runner.plan_handler = lambda prompt: json.dumps(TWO_PLANNED)
    numbers = iter((101, 102))

    code = harness.run(lambda prompt: harness.edit_and_report(next(numbers), initiative="Checkout"))

    assert code == 0
    creates = harness.calls("issue", "create")
    assert [call[call.index("--title") + 1] for call in creates] == ["Add the form", "Validate the form"]
    assert "Blocked by #101" in creates[1][creates[1].index("--body") + 1]
    assert "Blocked by" not in creates[0][creates[0].index("--body") + 1]
    links = [call for call in harness.gh.calls if call[:3] == ("api", "--method", "POST")]
    assert [call[3] for call in links] == ["repos/owner/repo/issues/1/sub_issues"] * 2
    assert [call[-1] for call in links] == ["sub_issue_id=1101", "sub_issue_id=1102"]
    assert [call[2] for call in harness.calls("issue", "close")] == ["101", "102"]
    assert len(harness.runner.plan_prompts) == 1 and "Add login page" in harness.runner.plan_prompts[0]


def test_the_planner_runs_as_the_planner_profile_on_the_checkout(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)
    harness.runner.plan_handler = lambda prompt: json.dumps(TWO_PLANNED)

    harness.run(lambda prompt: harness.edit_and_report(101))

    assert harness.runner.profiles[0].name == "planner"
    assert f"`{harness.root}`" in harness.runner.plan_prompts[0]


def test_a_spec_with_sub_issues_is_never_planned(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    harness.run(lambda prompt: harness.edit_and_report(10))

    assert harness.runner.plan_prompts == [] and harness.calls("issue", "create") == []


def test_a_spec_whose_sub_issues_are_all_closed_is_not_planned_again(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path, tickets={1: [issue(10, "Done", state="CLOSED")]})

    assert harness.run() == 0

    assert harness.runner.plan_prompts == [] and harness.calls("issue", "create") == []


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (envelope("", "failed", {"reason": "needs a product decision"}), "needs a product decision"),
        ("no json", "no response object"),
        (json.dumps({"status": "completed", "result": {"tickets": []}}), "no Tickets"),
        (
            json.dumps({"status": "completed", "result": {"tickets": [{"title": "A", "body": "", "blocked_by": [0]}]}}),
            "does not come before it",
        ),
        (json.dumps({"status": "completed", "result": {"tickets": [{"title": " ", "body": ""}]}}), "missing result.title"),
    ],
)
def test_an_unplannable_spec_is_handed_to_a_human_and_nothing_is_created(
    tmp_path: Path, reply: str, reason: str
) -> None:
    harness = _unplanned(tmp_path)
    harness.runner.plan_handler = lambda prompt: reply

    code = harness.run()

    assert code == 0
    assert harness.calls("issue", "create") == [] and harness.git_service.opened == []
    assert [call[2] for call in harness.calls("issue", "edit") if call[-1] == "hitl"] == ["1"]
    assert any(reason in call[-1] for call in harness.calls("issue", "comment"))


def test_a_planner_that_changes_the_checkout_is_rejected_before_any_ticket_is_created(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)

    def planner(prompt: str) -> str:
        harness.git.edit("src/oops.py")
        return json.dumps(TWO_PLANNED)

    harness.runner.plan_handler = planner

    harness.run()

    assert harness.calls("issue", "create") == []
    assert any("read-only agent changed the working tree" in call[-1] for call in harness.calls("issue", "comment"))


def test_a_planner_that_commits_is_rejected(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)

    def planner(prompt: str) -> str:
        harness.git.add_commit("planner commit")
        return json.dumps(TWO_PLANNED)

    harness.runner.plan_handler = planner

    harness.run()

    assert harness.calls("issue", "create") == []
    assert any("only the harness commits" in call[-1] for call in harness.calls("issue", "comment"))


def test_a_failure_while_creating_tickets_names_the_ones_already_created(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)
    harness.runner.plan_handler = lambda prompt: json.dumps(TWO_PLANNED)
    original = harness.gh.__call__
    created = 0

    def flaky(args: tuple[str, ...]) -> str:
        nonlocal created
        if args[:2] == ("issue", "create"):
            created += 1
            if created == 2:
                from workflows.dev.commands import CommandError

                raise CommandError("gh issue create", 1, "rate limited")
        return original(args)

    harness.github = type(harness.github)("owner", "repo", gh=flaky)

    harness.run()

    assert any("after creating #101" in call[-1] for call in harness.calls("issue", "comment"))
    assert [call[2] for call in harness.calls("issue", "edit") if call[-1] == "hitl"] == ["1"]


def test_a_spec_is_not_planned_when_its_base_branch_does_not_exist(tmp_path: Path) -> None:
    harness = _unplanned(tmp_path)
    harness.git.remote_branches = set()

    harness.run()

    assert harness.runner.plan_prompts == [] and harness.calls("issue", "create") == []
    assert any("does not exist" in call[-1] for call in harness.calls("issue", "comment"))
