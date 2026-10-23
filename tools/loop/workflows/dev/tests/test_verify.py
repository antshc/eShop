from __future__ import annotations

import re
from pathlib import Path

from workflows.dev.tests.doubles import DevHarness, envelope

SKILL = "---\nname: verify-x\ndescription: Drive and prove the storefront in a real browser.\n---\n# Verify\n"


def _with_skill(harness: DevHarness) -> None:
    def open_worktree() -> None:
        skill = harness.worktree / ".github" / "skills" / "verify-x" / "SKILL.md"
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_text(SKILL)

    harness.git_service.on_open = open_worktree


def _verdict(verdict: str = "pass", *, findings: list[dict] | None = None, message: str = "") -> str:
    return envelope(
        "",
        result={
            "verdict": verdict,
            "summary": "drove the cart",
            "verification": "mole add-to-cart",
            "findings": findings or [],
            "commit_message": message,
        },
    )


def _save_evidence(harness: DevHarness, prompt: str) -> None:
    directory = Path(re.search(r"`([^`]*evidence[^`]*)`", prompt)[1])
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "cart.png").write_text("png")


def _run(harness: DevHarness) -> int:
    return harness.run(lambda prompt: harness.edit_and_report(10))


def _verifier(harness: DevHarness, reply: str, *, edit: str | None = None, evidence: bool = True):
    def handler(prompt: str) -> str:
        if evidence:
            _save_evidence(harness, prompt)
        if edit is not None:
            harness.git.edit(edit)
        return reply

    harness.runner.verify_handler = handler


def test_the_verifier_is_skipped_when_the_repository_has_no_verification_skill(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)

    assert _run(harness) == 0

    assert harness.runner.verify_prompts == []


def test_a_passing_verdict_is_posted_on_the_spec_with_its_evidence_path(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)
    _verifier(harness, _verdict("pass"))

    assert _run(harness) == 0

    [prompt] = harness.runner.verify_prompts
    assert "verify-x/SKILL.md" in prompt and f"`{harness.worktree}`" in prompt
    comments = [call[-1] for call in harness.calls("issue", "comment") if call[2] == "1"]
    verdict = next(body for body in comments if "app verification" in body)
    assert "**pass**" in verdict and str(harness.log_dir / "evidence") in verdict
    assert harness.runner.profiles[1].name == "verifier"
    assert len(harness.git.commits) == 2


def test_the_harness_commits_the_verifiers_fixes_and_pushes_them(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)

    def verifier(prompt: str) -> str:
        _save_evidence(harness, prompt)
        harness.git.edit("src/WebApp/Cart.razor")
        return _verdict("pass", findings=[{"summary": "cart total wrong", "status": "fixed"}], message="Fix the cart total")

    harness.runner.verify_handler = verifier

    assert _run(harness) == 0

    assert harness.git.commits[-1].subject == "fix(Checkout): Fix the cart total"
    assert len(harness.git.pushes) == 2


def test_fixes_that_touch_the_proof_framework_are_discarded(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)
    _verifier(harness, _verdict("pass", message="tweak"), edit="proof/features/cart.ts")

    assert _run(harness) == 0

    assert len(harness.git.commits) == 2 and harness.git.restores
    body = next(call[-1] for call in harness.calls("issue", "comment") if "app verification" in call[-1])
    assert "**partial**" in body and "proof/features/cart.ts" in body


def test_unfixed_findings_downgrade_a_pass_to_partial(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)
    _verifier(harness, _verdict("pass", findings=[{"summary": "slow", "status": "unfixed", "reason": "needs infra"}]))

    _run(harness)

    body = next(call[-1] for call in harness.calls("issue", "comment") if "app verification" in call[-1])
    assert "**partial**" in body and "slow (needs infra)" in body


def test_a_verdict_without_evidence_is_inconclusive(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)
    _verifier(harness, _verdict("pass"), evidence=False)

    _run(harness)

    body = next(call[-1] for call in harness.calls("issue", "comment") if "app verification" in call[-1])
    assert "**inconclusive**" in body and "no evidence" in body


def test_a_verifier_that_commits_is_discarded_and_inconclusive(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)

    def verifier(prompt: str) -> str:
        _save_evidence(harness, prompt)
        harness.git.edit()
        harness.git.add_commit("verifier commit")
        return _verdict("pass")

    harness.runner.verify_handler = verifier

    _run(harness)

    assert "verifier commit" not in [commit.subject for commit in harness.git.commits]
    body = next(call[-1] for call in harness.calls("issue", "comment") if "app verification" in call[-1])
    assert "**inconclusive**" in body


def test_a_crashing_verifier_is_inconclusive_and_does_not_fail_the_run(tmp_path: Path) -> None:
    from workflows.dev.tests.doubles import crash

    harness = DevHarness(tmp_path)
    _with_skill(harness)
    harness.runner.verify_handler = crash()

    assert _run(harness) == 0

    body = next(call[-1] for call in harness.calls("issue", "comment") if "app verification" in call[-1])
    assert "**inconclusive**" in body


def test_a_pass_is_required_for_the_pull_request_to_be_marked_ready(tmp_path: Path) -> None:
    harness = DevHarness(tmp_path)
    _with_skill(harness)
    _verifier(harness, _verdict("fail"))

    _run(harness)

    assert harness.calls("pr", "ready") == []
    assert "app verification is fail" in harness.calls("issue", "comment")[-1][-1]
