"""Claude Code interface — STUB. The factory runs on the GitHub Copilot CLI only.

The config schema accepts `coding_agent: claude_code` so nothing breaks at the
schema level, but selecting it raises until v2 implements this interface
(`claude -p --output-format stream-json --resume <session_id>`).
"""

from __future__ import annotations


def run(*args, **kwargs):
    raise NotImplementedError(
        "coding_agent 'claude_code' is not implemented in v1 — SSSF v1 runs the "
        "GitHub Copilot CLI only. Set coding_agent: copilot (or omit it) in sssf.config.yaml."
    )
