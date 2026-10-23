"""The verify stage: a verifier agent drives the integrated app and fixes what the change got wrong; the harness commits the fixes."""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from loop import AgentWorkspace

from .checkout import GitService
from .commands import CommandError
from .gates import commit_subject, find_verification_skills, made_no_commit, protected_changes
from .phases import Kind, Owner, Phases
from .platforms import TicketsTracker
from .records import Spec, TicketWorkflowError, VerifyContext, VerifyResult, VerifyWorkflow, loop_session_name, slugify


@dataclass(frozen=True)
class VerifyReport:
    """The settled outcome of app verification; `verdict` is a verdict or `skipped` when the repository has no verification skill."""

    verdict: str
    summary: str = ""
    evidence_dir: Path | None = None
    unfixed: tuple[str, ...] = ()
    fix_commit: str = ""

    @property
    def blocks_ready(self) -> bool:
        """Any verdict but `pass` or `skipped` keeps the PR a draft."""
        return self.verdict not in ("pass", "skipped")


SKIPPED = VerifyReport("skipped", "no app-verification skill found")


def verify_app(
    spec: Spec,
    pull_request_url: str,
    worktree: AgentWorkspace,
    run_verify: VerifyWorkflow,
    *,
    git: GitService,
    tracker: TicketsTracker,
    phases: Phases,
    evidence_root: Path,
) -> VerifyReport:
    """Verifies the integrated branch when the repository has a verification skill; fix commits are pushed, the verdict is posted on the Spec."""
    base_branch, feature_branch = spec.base_branch, spec.feature_branch
    if base_branch is None or feature_branch is None:
        raise TicketWorkflowError(f"cannot resolve branches for Spec {spec.url}")
    skills = find_verification_skills(worktree.path)
    if not skills:
        with phases.phase("verify", Kind.AGENT, Owner.VERIFIER, spec=spec.number) as phase:
            phase.skip("No app-verification skill found")
        return SKIPPED
    evidence_dir = evidence_root / slugify(spec.initiative) / datetime.now().strftime("%Y%m%dT%H%M%S")
    evidence_dir.mkdir(parents=True, exist_ok=True)
    head_before = git.head(worktree.path)
    result = VerifyResult("inconclusive")
    note = ""
    with phases.phase("verify", Kind.AGENT, Owner.VERIFIER, spec=spec.number, skills=len(skills)) as phase:
        try:
            context = VerifyContext(
                pull_request_url,
                base_branch,
                feature_branch,
                evidence_dir,
                skills,
                json.dumps({"number": spec.number, "title": spec.title, "url": spec.url, "body": spec.body}, indent=2),
                json.dumps([asdict(ticket) for ticket in spec.tickets], indent=2),
                tuple(f"{commit.sha[:7]} {commit.subject}" for commit in git.branch_commits(worktree.path, base_branch)),
                loop_session_name(spec.number, spec.title),
            )
            result = run_verify(context, worktree)
        except (CommandError, subprocess.CalledProcessError, TicketWorkflowError) as exception:
            note = f"verifier failed: {exception}"
            phase.fail("Verification did not complete")
        phase.set(verdict=result.verdict)
        moved = made_no_commit(git, worktree.path, head_before.sha)
        if moved:
            phase.fail("Verifier committed changes")
        if not phase.gate("the agent did not commit", moved is None, moved or ""):
            note = moved or ""
        if not note and result.verdict != "inconclusive":
            evidence = any(evidence_dir.iterdir())
            if not evidence:
                phase.fail("Verification evidence missing")
            if not phase.gate("evidence was saved", evidence, f"no evidence in {evidence_dir}"):
                note = f"no evidence in {evidence_dir}"
    verdict = "inconclusive" if note else result.verdict
    if note:
        with phases.phase("restore", Kind.CODE, Owner.CODE, to=head_before.sha):
            git.restore(worktree.path, head_before.sha)
    fix_commit = ""
    if not note:
        files = git.changed_files(worktree.path)
        forbidden = protected_changes(files)
        if forbidden:
            note = "fixes touched the proof framework and were discarded: " + ", ".join(forbidden)
            with phases.phase("restore", Kind.CODE, Owner.CODE, to=head_before.sha):
                git.restore(worktree.path, head_before.sha)
            verdict = "partial" if verdict == "pass" else verdict
        elif files:
            subject = commit_subject(f"fix({spec.initiative}): ", result.commit_message, "fix verification findings")
            with phases.phase("commit-fixes", Kind.CODE, Owner.CODE, spec=spec.number) as phase:
                commit = git.commit(worktree.path, subject, result.summary)
                phase.set(commit=commit.sha)
                git.push_if_ahead(worktree.path, feature_branch, base_branch)
            fix_commit = commit.sha
    unfixed = tuple(
        finding.summary + (f" ({finding.reason})" if finding.reason else "")
        for finding in result.findings
        if finding.status != "fixed"
    )
    if verdict == "pass" and unfixed:
        verdict = "partial"
    report = VerifyReport(verdict, note or result.summary, evidence_dir, unfixed, fix_commit)
    _post_verdict(spec, tracker, report)
    return report


def _post_verdict(spec: Spec, tracker: TicketsTracker, report: VerifyReport) -> None:
    lines = [f"dev: app verification **{report.verdict}**", "", report.summary, "", f"Evidence: `{report.evidence_dir}`"]
    if report.fix_commit:
        lines.append(f"Fix commit: {report.fix_commit}")
    if report.unfixed:
        lines += ["", "Unfixed findings:", *(f"- {item}" for item in report.unfixed)]
    spec.comment("\n".join(lines))
    tracker.update_spec(spec)
