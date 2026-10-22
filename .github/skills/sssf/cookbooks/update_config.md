# Update Config

Add or retune agents in `sssf.config.yaml`.

## Retune model or thinking

Edit the agent's entry in place:

```yaml
  - name: builder
    model: claude-sonnet-5.5         # bare Copilot model id
    thinking: high                   # was medium
```

Write the model as a bare Copilot model id (no provider prefix); `agents.validate()` rejects ids containing `/`. Which ids work depends on your Copilot plan. See `references/config.md`.

Thinking levels map to `copilot --reasoning-effort`: `off | minimal | low | medium | high | xhigh | max` (`off` is sent as `none`). Which levels a model accepts depends on the model.

**A model change means a fresh session.** `agent_map.json` records the model each coding-agent session was created with. When a joined run (`--adw-id`) finds the config's model no longer matches the recorded one, that agent starts a **new** session rather than resuming — the map is updated, never a bad resume. Thinking changes do not invalidate a session; model changes do. Expect the agent to lose its accumulated context window on the first run after the change.

## Recolor an agent's lane

```yaml
  - name: builder
    color: "#22d3ee"      # hex; the starter roster ships violet/cyan/amber/green
```

Purely cosmetic and safe to change mid-project: the color rides the `agent_start` event and the `agent_sessions` row, so the visualizer picks it up on the next run without touching past sessions. Omit the key to let the UI's fallback palette choose.

## Retune tools

The roster's seven neutral names — `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` — are translated to Copilot's built-ins (`view`, `bash`, `edit`, `create`, `grep`, `glob`); see `references/config.md`. An agent that doesn't name `grep`/`find`/`ls` will shell out through `bash` to search and list. Other names (`task`, `web_fetch`, ...) pass through verbatim.

Set the roster-wide floor in `defaults`, then narrow per agent:

```yaml
defaults:
  tools: [read, bash, edit, write, grep, find, ls]

agents:
  - name: reviewer
    tools:                # explicit list wins over defaults
      - read
      - grep
      - find
      - ls
      - bash
      - write
```

**Resolution:** the agent's own list wins → else it inherits `defaults.tools` → else `None`, meaning all tools. An empty list is not "all tools"; it is a tool-less agent, and it will stall.

Narrow by role, not by reflex:

- Any agent that must produce a `context_handoff/` artifact needs **`write`** — without it, it falls back to a `bash` heredoc to create the file the gate checks for.
- Withhold `edit`/`write` only where the restriction *is* the guarantee. The reviewer's contract is "change nothing", so withholding `edit` makes that structural instead of merely prompted.
- Recon agents should get the full read surface (`read`, `grep`, `find`, `ls`) — cheaper and more legible in the trace than the equivalent `bash` calls.

**Subagents.** Planner and scout list `task`, `read_agent`, `write_agent` and `list_agents` so they can fan out recon with Copilot's native subagents. An agent without them cannot spawn any.

## Harness extensions

`harness_engineering` is reserved: the Copilot backend does not load extensions, so entries are ignored. Tighten agent behavior through its `system.md`, its `tools` list, and `writes` instead.

## Add a new agent

Three steps, all required — skipping any one fails `agents.validate()` at ADW startup, before anything spawns:

1. **Prompts.** Create `adws/adw_data/prompt_engineering/{name}/system.md` (Purpose + Instructions — the agent's static identity, nothing else) and `user.md` (an h3 per incoming datum: `{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`, then the task, then a `## Report` section showing the exact output JSON). Copy an existing pair as the shape.
2. **Config entry.** Name, purpose, prompt refs, plus anything that differs from `defaults`.
3. **An output type.** Every agent call parses against a concrete Pydantic model in `adw_modules/data_types.py`. If none of `PlanOutput`, `BuildOutput`, `ScoutOutput`, `ReviewOutput`, `DocumentOutput` fits the new agent's report, add one — see `update_modules.md`. The user prompt's `Report` section must show exactly that JSON shape.

Then name the agent in an ADW's `REQUIRED_AGENTS` and call it.

## Rules that do not bend

- ADW scripts name **agents**, never models. Swapping a model is a config edit and touches no Python.
- One agent, one prompt, one purpose. If an entry needs two purposes, it is two agents.
- Output types never appear in config — they live at the call site, paired with the user prompt.

Full spec: `references/config.md`.
