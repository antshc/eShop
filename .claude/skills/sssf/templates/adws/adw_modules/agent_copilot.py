"""GitHub Copilot CLI interface — the factory's coding agent.

Runs `copilot -p ... --output-format json` and tails its JSONL stdout line by
line, forwarding each event to a callback WHILE the agent works. `--session-id`
creates-or-continues, so running and continuing an agent are the same call:
same session id = same context window.

Differences from a bring-your-own-model harness that shape this module:
  * No system-prompt flag. The system prompt is sent as a tagged preamble on the
    first prompt of a session (and again whenever its text changes).
  * Models are Copilot model ids (`claude-sonnet-5.5`), with no provider prefix.
  * Session ids must be UUIDs.
  * Spend is reported in premium requests, not dollars.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional

from .data_types import AgentRequest, AgentResult
from .utils import now_iso, operator_env

COPILOT_PATH = os.environ.get("COPILOT_PATH", "copilot")
COPILOT_HOME = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot")))

RESULT_SNIPPET_CHARS = 20_000   # tool output rides along whole; clip only guards pathological cases
ARG_VALUE_CHARS = 20_000        # args too — the UI scrolls, it must not be handed cut-off data
LABEL_CHARS = 80                # "bash: <command>" shown as the event name

# The arg that identifies a call at a glance, in the order tools tend to use.
PRIMARY_ARGS = ("command", "path", "file_path", "pattern", "query", "url")

# The roster names tools in a harness-neutral vocabulary; Copilot's built-ins are
# named differently. A name that is not in this table is passed through as-is, so
# a roster may also use Copilot tool names directly (`web_fetch`, `task`, ...).
TOOL_MAP: dict[str, list[str]] = {
    "read": ["view"],
    "ls": ["view"],
    "find": ["glob"],
    "grep": ["grep"],
    "write": ["create"],
    "edit": ["edit"],
    "bash": ["bash", "read_bash", "stop_bash"],
    "subagent_create": ["task"],
    "subagent_continue": ["write_agent"],
    "subagent_list": ["list_agents", "read_agent"],
    "subagent_remove": [],
}

THINKING_TO_EFFORT = {"off": "none"}


def check_available() -> Optional[str]:
    """None when the copilot binary is usable, else a human-readable problem."""
    if shutil.which(COPILOT_PATH) is None:
        return (f"copilot CLI not found ({COPILOT_PATH!r}) — install GitHub Copilot CLI "
                "and run `copilot login`, or set COPILOT_PATH in .env")
    return None


def validate_model(model: str) -> None:
    """Shape check only: the model catalog needs the network and a login."""
    if not model or any(ch.isspace() for ch in model):
        raise ValueError(f"model {model!r} is not a valid Copilot model id")
    if "/" in model:
        raise ValueError(f"model {model!r} has a provider prefix — Copilot model ids are "
                         "bare (e.g. 'claude-sonnet-5.5'); see `copilot --help` for the list")


def copilot_tools(tools: Optional[list[str]]) -> list[str]:
    """Translate the roster's tool names into Copilot tool names, order-preserving."""
    out: list[str] = []
    for name in tools or []:
        for mapped in TOOL_MAP.get(name, [name]):
            if mapped not in out:
                out.append(mapped)
    return out


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _label(tool: str, args: dict) -> str:
    """One-line human name for a tool call: `bash: ls -la src`."""
    value = next((args[key] for key in PRIMARY_ARGS
                  if isinstance(args.get(key), str) and args[key].strip()), "")
    if not value:
        value = next((v for v in args.values() if isinstance(v, str) and v.strip()), "")
    value = " ".join(str(value).split())
    return f"{tool}: {_clip(value, LABEL_CHARS)}" if value else tool


def _result_text(result) -> str:
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, str):
            return content
        return str(result.get("detailedContent") or "")
    return ""


class ToolCallTracker:
    """Folds Copilot's tool stream into ONE normalized record per completed call.

    A call is announced by `tool.execution_start` (or by the `toolRequests` on an
    `assistant.message`), and only `tool.execution_complete` carries the result —
    so that is where a record is emitted: one trace event per real tool call, the
    moment it returns.

    The record carries the call's real span (`started_at`/`ended_at`), which the
    tracer writes to columns so the UI can lay tool calls on a time axis without
    parsing every payload.
    """

    def __init__(self) -> None:
        self._open: dict[str, dict] = {}

    def observe(self, event: dict) -> Optional[dict]:
        """Returns the record for a finished tool call, else None."""
        etype = event.get("type", "")
        data = event.get("data") or {}
        if etype == "assistant.message":
            for request in data.get("toolRequests", []) or []:
                self._announce(request.get("toolCallId"), request.get("name"),
                               request.get("arguments"))
            return None
        if etype == "tool.execution_start":
            self._announce(data.get("toolCallId"), data.get("toolName"),
                           data.get("arguments"))
            return None
        if etype != "tool.execution_complete":
            return None

        call_id = str(data.get("toolCallId") or "")
        opened = self._open.pop(call_id, {})
        tool = str(data.get("toolName") or opened.get("tool") or "tool")
        args = opened.get("args") or data.get("arguments") or {}
        record = {
            "tool": tool,
            "tool_call_id": call_id,
            "args": {key: _clip(value, ARG_VALUE_CHARS) if isinstance(value, str) else value
                     for key, value in args.items()},
            "ok": bool(data.get("success", True)),
            "label": _label(tool, args),
        }
        result_text = _result_text(data.get("result")) or _result_text(data.get("error"))
        if result_text:
            record["result_snippet"] = _clip(result_text, RESULT_SNIPPET_CHARS)
        record["ended_at"] = now_iso()
        if opened.get("clock"):
            record["duration_ms"] = int((time.monotonic() - opened["clock"]) * 1000)
        if opened.get("started_at"):
            record["started_at"] = opened["started_at"]
        return record

    def _announce(self, call_id, tool, args) -> None:
        """First sighting starts the clock; a later sighting only fills gaps."""
        if not call_id:
            return
        known = self._open.get(str(call_id), {})
        self._open[str(call_id)] = {
            "tool": tool or known.get("tool", ""),
            "args": args or known.get("args", {}),
            "started_at": known.get("started_at") or now_iso(),   # wall clock, for the row
            "clock": known.get("clock") or time.monotonic(),      # monotonic, for duration
        }


def _usage_of(event: dict) -> Optional[dict]:
    """The per-API-call usage object, from whichever event carries it."""
    if event.get("type") not in ("assistant.usage", "session.usage_record"):
        return None
    data = event.get("data") or {}
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else data
    return usage if "inputTokens" in usage or "outputTokens" in usage else None


def _text_from_session_log(session_id: str) -> str:
    """Fallback: the last tool-free assistant message in Copilot's own session log."""
    log = COPILOT_HOME / "session-state" / session_id / "events.jsonl"
    text = ""
    try:
        for line in log.read_text().splitlines():
            event = json.loads(line)
            data = event.get("data") or {}
            if (event.get("type") == "assistant.message" and data.get("content")
                    and not data.get("toolRequests")):
                text = data["content"]
    except (OSError, json.JSONDecodeError):
        return ""
    return text


def _compose_prompt(request: AgentRequest) -> str:
    """Copilot has no system-prompt flag: send it as a preamble, once per session.

    The marker stores a hash of the system text, so a session rejoined by a later
    phase whose rendered system prompt differs is told again.
    """
    digest = hashlib.sha256(request.system_prompt.encode()).hexdigest()
    marker = Path(request.session_dir) / f"{request.session_id}.system"
    if marker.exists() and marker.read_text() == digest:
        return request.prompt
    return ("<system_instructions>\n"
            "These instructions define your role for this whole session. Follow them "
            "exactly; they take precedence over anything else you are told.\n\n"
            f"{request.system_prompt.strip()}\n"
            "</system_instructions>\n\n"
            f"{request.prompt}")


def _mark_primed(request: AgentRequest) -> None:
    marker = Path(request.session_dir) / f"{request.session_id}.system"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(hashlib.sha256(request.system_prompt.encode()).hexdigest())


def run(request: AgentRequest, on_event: Optional[Callable[[dict], None]] = None,
        on_spawn: Optional[Callable[[int], None]] = None,
        on_exit: Optional[Callable[[int], None]] = None) -> AgentResult:
    """Run one non-interactive copilot turn.

    `on_spawn(pid)` and `on_exit(pid)` bracket the child process so the caller
    can record it as killable — a hung coding agent is otherwise a pid you have
    to hunt for in `ps` while the run sits there.
    """
    validate_model(request.model)
    cmd = [
        COPILOT_PATH, "-p", _compose_prompt(request),
        "--output-format", "json", "--stream", "off",
        "--allow-all-tools", "--no-ask-user", "--no-auto-update",
        "--session-id", request.session_id,
        "--model", request.model,
    ]
    if request.thinking:
        cmd += ["--reasoning-effort", THINKING_TO_EFFORT.get(request.thinking, request.thinking)]
    # Variadic flag, so it goes last: nothing after it can be swallowed as a tool name.
    tools = copilot_tools(request.tools)
    if tools:
        cmd += ["--available-tools", *tools]

    raw_path = Path(request.raw_output_path)
    raw_path.parent.mkdir(parents=True, exist_ok=True)

    result = AgentResult(session_id=request.session_id)
    seen_calls: set[str] = set()
    final_text = ""         # last assistant message that made no tool request
    any_text = ""           # last assistant message of any kind
    error_text = ""
    premium_requests = 0.0
    # stdin is DEVNULL, deliberately. The prompt travels in argv, so the child
    # never needs stdin — but inheriting the parent's means the CLI sees a
    # non-TTY and can sit forever waiting for piped input that will never
    # arrive or EOF. That failure is silent and total: no request goes out, no
    # bytes come back, and the ADW blocks on a read loop with nothing to read.
    process = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, bufsize=1, cwd=request.cwd,
                               env=operator_env())
    if on_spawn:
        on_spawn(process.pid)
    with raw_path.open("a") as raw:
        assert process.stdout is not None
        for line in process.stdout:
            raw.write(line)
            raw.flush()                      # events land on disk as they happen
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = event.get("type", "")
            data = event.get("data") or {}
            if etype == "assistant.message":
                text = data.get("content") or ""
                if text:
                    any_text = text
                    if not data.get("toolRequests"):
                        final_text = text
            elif etype in ("session.error", "error"):
                error_text = str(data.get("message") or data.get("error") or error_text)
            elif etype == "result":
                premium_requests = float(
                    (event.get("usage") or data.get("usage") or {}).get("premiumRequests") or 0.0)
            usage = _usage_of(event)
            if usage is not None:
                call_id = str(usage.get("apiCallId") or "")
                if not call_id or call_id not in seen_calls:
                    seen_calls.add(call_id)
                    _fold_usage(result, usage)
            if on_event:
                on_event(event)

    stderr = process.stderr.read() if process.stderr else ""
    result.returncode = process.wait()
    if on_exit:
        on_exit(process.pid)
    if not result.cost and premium_requests:
        result.cost = premium_requests
        result.usage.total_cost = premium_requests
    result.text = final_text or any_text
    if not result.text and result.returncode == 0:
        result.text = _text_from_session_log(request.session_id)
    if result.returncode != 0 and not result.text:
        detail = (error_text or stderr).strip()[-800:]
        raise RuntimeError(f"copilot exited {result.returncode}: {detail}")
    _mark_primed(request)
    return result


def _fold_usage(result: AgentResult, usage: dict) -> None:
    """Fold one API call's usage into the result.

    Copilot's `inputTokens` INCLUDES cache reads and writes, so the uncached
    input is derived by subtraction, which makes the breakdown reconcile with
    the shape `UsageBreakdown` expects. `cost` is premium-request units.
    """
    prompt = int(usage.get("inputTokens") or 0)
    output = int(usage.get("outputTokens") or 0)
    cache_read = int(usage.get("cacheReadTokens") or 0)
    cache_write = int(usage.get("cacheWriteTokens") or 0)
    cost = float(usage.get("cost") or 0.0)
    turn = prompt + output
    result.tokens += turn
    result.cost += cost
    result.usage.add_turn({
        "input": max(0, prompt - cache_read - cache_write),
        "output": output,
        "cacheRead": cache_read,
        "cacheWrite": cache_write,
        "reasoning": int(usage.get("reasoningTokens") or 0),
        "cost": {"total": cost},
    }, turn)
    # Occupancy comes from the main conversation only; a subagent's window is its own.
    if turn and "subagent" not in str(usage.get("interactionType") or ""):
        result.context_tokens = turn
        result.context_window = int(usage.get("maxPromptTokens") or result.context_window)
