from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from loop import Instructions
from workflows.dev import agent
from workflows.dev.agents import CHORE, DEVELOPER, PLANNER, REVIEWER, VERIFIER
from workflows.dev.tests.doubles import DevHarness, envelope


def test_imported_profiles_compose_file_instructions_with_ticket_context(tmp_path: Path, monkeypatch) -> None:
    harness = DevHarness(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert harness.run(lambda prompt: harness.edit_and_report(10)) == 0
    prompt = harness.prompts[0]
    assert "## Agent instructions" in prompt and "## Task" in prompt
    assert "functional slice" in prompt and '"number": 10' in prompt
    assert "{{" not in prompt
    assert harness.runner.profiles[0] is DEVELOPER


def test_a_user_defined_python_profile_can_supply_inline_instructions(tmp_path: Path, monkeypatch) -> None:
    custom = replace(DEVELOPER, instructions="CUSTOM: implement and verify the assigned Ticket.")
    monkeypatch.setattr(agent, "DEVELOPER", custom)
    harness = DevHarness(tmp_path)
    assert harness.run(lambda prompt: harness.edit_and_report(10)) == 0
    assert "CUSTOM: implement and verify" in harness.prompts[0]
    assert '"number": 10' in harness.prompts[0]


def test_missing_profile_instructions_fail_before_the_cli_runs(tmp_path: Path, monkeypatch) -> None:
    custom = replace(DEVELOPER, instructions=Instructions.from_file(tmp_path / "missing.md"))
    monkeypatch.setattr(agent, "DEVELOPER", custom)
    harness = DevHarness(tmp_path)
    assert harness.run() == 1
    assert harness.runner.profiles == []
    assert harness.git_service.closed == 1


@pytest.mark.parametrize("profile", (PLANNER, DEVELOPER, VERIFIER, CHORE, REVIEWER))
def test_profile_instruction_files_have_no_task_placeholders(profile) -> None:
    assert profile.instructions.path.is_absolute()
    assert "{{" not in profile.instructions.path.read_text()
    # The opened workspace, rather than a fixed profile cwd, selects the checkout/worktree.
    assert profile.cwd is None


def test_console_logs_show_transitions_while_debug_keeps_failure_details(tmp_path: Path, capsys) -> None:
    harness = DevHarness(tmp_path)
    reply = envelope(result={"commit_message": "private-agent-output"})
    assert harness.run(lambda prompt: reply, argv=[
        "--no-otel", "--log-level", "DEBUG", "--log-dir", str(harness.log_dir),
    ]) == 1
    console = capsys.readouterr().err
    assert "Implement ticket" in console and "failed" in console
    assert "private-agent-output" not in console
    assert "git commit" not in console and "## Agent instructions" not in console
    assert "private-agent-output" in (harness.log_dir / "dev.log").read_text()
