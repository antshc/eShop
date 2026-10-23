from __future__ import annotations

from pathlib import Path

import pytest

from loop import AgentProfile, copilot

from workflows.dev import agent
from workflows.dev.chore import DIFF_DIR, MANIFEST_NAME, capture_pull_request_diff
from workflows.dev.platforms import GitHubRepo
from workflows.dev.records import ChoreContext
from workflows.dev.tests.doubles import PR_DIFF, DevHarness, FakeGhCli, crash

_CHORE_SUBJECT = "chore(Checkout): tidy"


def _github() -> GitHubRepo:
    return GitHubRepo("owner", "repo", gh=FakeGhCli())


def test_capture_writes_one_diff_per_file_and_a_manifest_of_real_paths(tmp_path: Path) -> None:
    directory = capture_pull_request_diff(_github(), "https://github.com/owner/repo/pull/99", tmp_path)

    assert directory == tmp_path / DIFF_DIR
    manifest = (directory / MANIFEST_NAME).read_text().splitlines()
    assert manifest == ["src/app.py\tsrc_app.py", "new/name.py\tnew_name.py"]
    assert (directory / "src_app.py").read_text() == PR_DIFF.split("diff --git a/old")[0]
    assert (directory / "new_name.py").read_text().startswith("diff --git a/old/name.py b/new/name.py\n")


def test_capture_recreates_the_directory_and_keeps_paths_that_flatten_to_one_name_apart(tmp_path: Path) -> None:
    stale = tmp_path / DIFF_DIR / "stale"
    stale.parent.mkdir(parents=True)
    stale.write_text("old")
    diff = "diff --git a/a/b_c b/a/b_c\n+x\ndiff --git a/a_b/c b/a_b/c\n+y\n"
    github = GitHubRepo("owner", "repo", gh=lambda args: diff)

    directory = capture_pull_request_diff(github, "url", tmp_path)

    assert not stale.exists()
    assert (directory / MANIFEST_NAME).read_text().splitlines() == ["a/b_c\ta_b_c", "a_b/c\t2_a_b_c"]
    assert (directory / "a_b_c").read_text().endswith("+x\n") and (directory / "2_a_b_c").read_text().endswith("+y\n")


def test_an_empty_pull_request_diff_yields_an_empty_manifest(tmp_path: Path) -> None:
    directory = capture_pull_request_diff(GitHubRepo("o", "r", gh=lambda args: ""), "url", tmp_path)

    assert (directory / MANIFEST_NAME).read_text() == ""


def test_chore_prompt_placeholders_match_the_supplied_arguments_exactly() -> None:
    context = ChoreContext("url", "chore(X): ", "main", "feature", Path("/w/bin/review_diff"))

    args = agent.chore_args(context, Path("/w"))

    assert set(agent._PLACEHOLDER.findall(agent.load_prompt("chore"))) == set(args)


def test_chore_prompt_lists_the_branch_commits_with_their_bodies() -> None:
    context = ChoreContext("url", "chore(X): ", "main", "feature", Path("/w/d"), ("a1b2c3d first\n    why",))

    prompt = agent.render_prompt(agent.load_prompt("chore"), agent.chore_args(context, Path("/w")))

    assert "a1b2c3d first\n    why" in prompt


def _deliver(harness: DevHarness) -> int:
    return harness.run(lambda prompt: harness.commit_and_report(10))


def test_the_chore_runs_in_the_worktree_after_the_pull_request_exists_on_its_diff(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    seen: list[tuple[bool, list[str]]] = []

    def chore(prompt: str) -> str:
        manifest = harness.worktree / DIFF_DIR / MANIFEST_NAME
        seen.append((bool(harness.calls("pr", "create")), manifest.read_text().splitlines()))
        return ""

    harness.runner.chore_handler = chore

    assert _deliver(harness) == 0

    assert harness.runner.profiles == [
        AgentProfile(copilot, model="claude-sonnet-5.5", reasoning_effort="medium"),
        AgentProfile(copilot, model="gpt-6.1-sol", reasoning_effort="medium"),
    ]
    assert seen == [(True, ["src/app.py\tsrc_app.py", "new/name.py\tnew_name.py"])]
    assert harness.calls("pr", "diff") == [("pr", "diff", "https://github.com/owner/repo/pull/99")]
    [prompt] = harness.runner.chore_prompts
    assert f"`{harness.worktree}`" in prompt and "chore(Checkout): " in prompt and "# REVIEW PROCESS" in prompt
    assert not (harness.worktree / DIFF_DIR).exists()


def test_each_agent_session_is_named_after_its_github_issue(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    assert _deliver(harness) == 0

    ticket_name, chore_name = harness.runner.names
    assert ticket_name is not None and ticket_name.startswith("loop(10) ")
    assert chore_name is not None and chore_name.startswith("loop(")


def test_a_chore_commit_is_pushed_to_the_pull_request_branch(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    def chore(prompt: str) -> str:
        harness.git.commit(_CHORE_SUBJECT)
        return "tidied"

    harness.runner.chore_handler = chore

    assert _deliver(harness) == 0

    assert harness.git.commits[-1].subject == _CHORE_SUBJECT
    assert harness.git.pushes == [(harness.worktree, "add-login-page")] * 2


def test_a_chore_with_nothing_to_clean_pushes_nothing_more(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    assert _deliver(harness) == 0

    assert len(harness.runner.chore_prompts) == 1
    assert len(harness.git.pushes) == 1 and harness.git.restores == []


@pytest.mark.parametrize("subject", ["ccode(Checkout|10): sneaky", "unrelated"])
def test_a_chore_commit_with_a_foreign_subject_is_discarded_without_failing_the_run(
    tmp_path: Path, subject: str
) -> None:
    harness = DevHarness(tmp_path)
    harness.runner.chore_handler = lambda prompt: harness.git.commit(subject)

    assert _deliver(harness) == 0

    delivered = harness.git.commits[-1].sha
    assert [commit.subject for commit in harness.git.commits].count(subject) == 0
    assert harness.git.restores == [delivered]
    assert len(harness.git.pushes) == 1


def test_a_chore_leaving_the_worktree_dirty_is_discarded(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    def chore(prompt: str) -> str:
        harness.git.commit(_CHORE_SUBJECT)
        harness.git.dirty = True
        return ""

    harness.runner.chore_handler = chore

    assert _deliver(harness) == 0

    assert len(harness.git.restores) == 1 and len(harness.git.pushes) == 1


def test_a_chore_with_two_commits_is_discarded(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    def chore(prompt: str) -> str:
        harness.git.commit(_CHORE_SUBJECT)
        harness.git.commit(_CHORE_SUBJECT)
        return ""

    harness.runner.chore_handler = chore

    assert _deliver(harness) == 0

    assert len(harness.git.restores) == 1 and len(harness.git.pushes) == 1


def test_a_crashing_chore_agent_is_discarded_without_failing_the_run(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    harness.runner.chore_handler = crash()

    assert _deliver(harness) == 0

    assert len(harness.git.restores) == 1 and len(harness.git.pushes) == 1
    assert not (harness.worktree / DIFF_DIR).exists()


def test_no_chore_runs_when_the_delivery_stopped_at_a_failed_ticket(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    code = harness.run(crash())

    assert code == 1 and harness.runner.chore_prompts == []
