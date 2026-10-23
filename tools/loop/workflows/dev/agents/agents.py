"""Importable agent settings; each agent Markdown file contains its complete prompt."""

from loop import AgentProfile, Permissions, copilot

from ..definition import Owner

# Keep managed workspace/start-mode selection in run.py. Profiles never override it.
PLANNER = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="high", name=Owner.PLANNER,
    permissions=Permissions(),
)
DEVELOPER = AgentProfile(
    copilot, model="claude-sonnet-5.5", reasoning_effort="medium", name=Owner.DEVELOPER,
    permissions=Permissions(),
)
VERIFIER = AgentProfile(
    copilot, model="claude-sonnet-5.5", reasoning_effort="medium", name=Owner.VERIFIER,
    permissions=Permissions(),
)
CHORE = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="medium", name=Owner.CHORE,
    permissions=Permissions(),
)
REVIEWER = AgentProfile(
    copilot, model="gpt-6.1-sol", reasoning_effort="high", name=Owner.REVIEWER,
    permissions=Permissions(),
)
