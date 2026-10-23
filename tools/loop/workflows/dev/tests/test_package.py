from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from workflows.dev import ESHOP, HARNESS, PROMPT, agent, load_prompt
from workflows.dev.records import ChoreContext, PlanContext, ReviewContext, Spec, VerifyContext
from workflows.dev.tests.doubles import DevHarness

ROOT = Path(__file__).resolve().parents[3]


def test_harness_and_default_prompt_paths_survive_the_package_move(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)

    assert ESHOP.checkout == ROOT.parents[1]
    assert ESHOP.worktrees == ROOT.parents[1] / ".loop" / "worktrees"
    assert str(ESHOP.owner_name) == "antshc/eShop"
    assert HARNESS is ESHOP
    assert PROMPT == ROOT / "workflows/dev/agents/implement.md"
    assert load_prompt("implement") == PROMPT.read_text()
    assert "{{TICKET_JSON}}" in load_prompt("implement")


def test_missing_named_prompt_raises_instead_of_falling_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(agent, "PROMPTS", tmp_path)

    with pytest.raises(FileNotFoundError, match="missing.md"):
        load_prompt("missing")


def test_missing_default_prompt_is_logged_and_fails_before_opening_a_worktree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(agent, "PROMPTS", tmp_path)
    harness = DevHarness(tmp_path)

    assert harness.run(argv=["--log-dir", str(harness.log_dir), "--log-level", "DEBUG"]) == 1
    assert harness.git_service.opened == []
    assert harness.prompts == []
    assert "implement.md" in (harness.log_dir / "dev.log").read_text()


def test_dev_runs_with_its_resources_and_no_sibling_workflow_files(tmp_path: Path) -> None:
    package = tmp_path / "workflows" / "dev"
    shutil.copytree(ROOT / "workflows/dev", package, ignore=shutil.ignore_patterns("__pycache__"))
    (package.parent / "__init__.py").write_text("")
    environment = os.environ | {"PYTHONPATH": str(ROOT / "src")}

    help_result = subprocess.run(
        [sys.executable, "-m", "workflows.dev", "--help"],
        cwd=tmp_path, env=environment, capture_output=True, text=True,
    )
    assert help_result.returncode == 0, help_result.stderr
    assert "--log-dir" in help_result.stdout and "--log-level" in help_result.stdout

    resources = subprocess.run(
        [
            sys.executable, "-c",
            "from pathlib import Path; from workflows.dev import HARNESS, load_prompt; "
            "assert HARNESS.checkout == Path.cwd().parents[1]; assert '{{TICKET_JSON}}' in load_prompt('implement')",
        ],
        cwd=tmp_path, env=environment, capture_output=True, text=True,
    )
    assert resources.returncode == 0, resources.stderr


_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def _spec() -> Spec:
    return Spec(1, "Checkout: Add login", "https://github.com/owner/repo/issues/1", ("repo:base:main",), body="body")


def test_every_role_prompt_exists_and_its_placeholders_match_the_arguments_exactly() -> None:
    plan = agent.plan_args(PlanContext(_spec(), "main"), Path("/c"))
    verify = agent.verify_args(
        VerifyContext("url", "main", "feature", Path("/e"), (Path("/s/SKILL.md"),), "{}", "[]", ("a1 first",)), Path("/w")
    )
    review = agent.review_args(ReviewContext("url", Path("/c"), "Checkout", "abc"))
    chore = agent.chore_args(ChoreContext("url", "main", "feature", Path("/d")), Path("/w"))

    for name, args in (("plan", plan), ("verify", verify), ("review", review), ("chore", chore)):
        assert set(_PLACEHOLDER.findall(load_prompt(name))) == set(args), name
        agent.render_prompt(load_prompt(name), args)


@pytest.mark.parametrize("name", ["implement", "chore", "verify"])
def test_prompts_of_agents_that_edit_forbid_committing(name: str) -> None:
    prompt = " ".join(load_prompt(name).split())

    assert "git commit" in prompt and "Loop commits" in prompt


@pytest.mark.parametrize("name", ["plan", "review"])
def test_prompts_of_read_only_agents_forbid_editing_and_committing(name: str) -> None:
    prompt = load_prompt(name)

    assert "never edit" in prompt.lower() or "only read" in prompt.lower()
    assert "commit" in prompt


def test_each_actor_has_its_own_named_profile_for_its_aspire_resource() -> None:
    profiles = {
        profile.name for profile in (agent.PLANNER, agent.DEVELOPER, agent.VERIFIER, agent.CHORE, agent.REVIEWER)
    }

    assert profiles == {"planner", "developer", "verifier", "chore", "reviewer"}
