"""Importable Python agent definitions; requests supply only execution context."""

from pathlib import Path

from loop import AgentProfile, Instructions, Permissions, copilot

from .definition import Owner

INSTRUCTIONS = Path(__file__).resolve().parent / "instructions"

# Keep managed workspace/start-mode selection in run.py. Profiles never override it.
PLANNER = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="high", name=Owner.PLANNER,
    instructions=Instructions.from_file(INSTRUCTIONS / "plan.md"),
    permissions=Permissions(),
)
DEVELOPER = AgentProfile(
    copilot, model="claude-sonnet-5.5", reasoning_effort="medium", name=Owner.DEVELOPER,
    instructions=Instructions.from_file(INSTRUCTIONS / "implement.md"),
    permissions=Permissions(),
)
VERIFIER = AgentProfile(
    copilot, model="claude-sonnet-5.5", reasoning_effort="medium", name=Owner.VERIFIER,
    instructions=Instructions.from_file(INSTRUCTIONS / "verify.md"),
    permissions=Permissions(),
)
CHORE = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="medium", name=Owner.CHORE,
    instructions=Instructions.from_file(INSTRUCTIONS / "chore.md"),
    permissions=Permissions(),
)
REVIEWER = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="high", name=Owner.REVIEWER,
    instructions=Instructions.from_file(INSTRUCTIONS / "review.md"),
    permissions=Permissions(),
)
