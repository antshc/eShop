---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied instruction file that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `.github/instructions/pstack-models.instructions.md`, an always-applied instruction file that sets pstack's model per role. Copilot loads it into every new session for this repo, so every skill that names a role line finds it already in context. The file is committed with the repo, so the choices are shared. A personal choice goes in `~/.copilot/instructions/pstack-models.instructions.md` instead.

## Steps

### 1. Detect available models

Enumerate the `model` values the subagent tool accepts in this session (the `task` tool's `model` enum in Copilot CLI, the model picker in VS Code), and the `reasoning_effort` values each one supports. That is the dependable source. If you cannot detect any, ask the user to paste the model IDs they have access to. Never write a real model you have not confirmed is available. The alias `inherit-parent` is always valid even though it is not a detected model, and `auto` is its synonym.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `.github/instructions/pstack-models.instructions.md` (or the personal copy) already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer `ask_user` over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by family, list, or alias (`inherit-parent`, `auto`). `unlimited`, `large`, `medium`, and `small` set the effort token of every real slug, panel entries included, to `max`, `xhigh`, `high`, or `medium`. A role value is `<model> <effort>`, so the effort token is the last token, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. If the model does not support that effort, use the highest effort it supports at or below the target, else mark the role as needing a choice. `inherit-parent` and `auto` do not change. So `unlimited` turns `claude-opus-5.5 xhigh` into `claude-opus-5.5 max`. A model that tops out at `xhigh`, such as Grok, stays at `xhigh` under `unlimited`. `large` keeps both defaults. `small` turns them into `claude-opus-5.5 medium` and `grok-4.7 medium`.

**(c) Show the roles and confirm.** Show every role with its model, marking any real model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` (this role runs on the parent chat model) as the options. Prefer `ask_user` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model written must be in the detected set, and its effort must be one that model supports. `inherit-parent` and `auto` always pass. If a chosen model is not available, stop and ask again.

### 5. Write the rule

Write `.github/instructions/pstack-models.instructions.md` with `applyTo: "**"`, a `# budget` line with the chosen label and its target effort, and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```
---
description: pstack per-role model choices (overrides skill defaults)
applyTo: "**"
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# Value format: `<model> <effort>`. Pass the model as `model` and the effort as `reasoning_effort`.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model` and `reasoning_effort`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: grok-4.7 xhigh
bug-fix: grok-4.7 xhigh
perf-issue: grok-4.7 xhigh
hillclimb: grok-4.7 xhigh
judgment and prose: claude-opus-5.5 xhigh
hardest tasks: claude-opus-5.5 xhigh
how explorer: grok-4.7 xhigh
how explainer: claude-opus-5.5 xhigh
why investigators: grok-4.7 xhigh
why synthesizer: claude-opus-5.5 xhigh
reflect tooling: grok-4.7 xhigh
reflect judgment, divergent, synthesizer: claude-opus-5.5 xhigh
arena runners: claude-opus-5.5 xhigh, grok-4.7 xhigh
arena cross-judge pool: claude-opus-5.5 xhigh, grok-4.7 xhigh
swarm workers: grok-4.7 xhigh
architect runners: claude-opus-5.5 xhigh, grok-4.7 xhigh
interrogate reviewers: claude-opus-5.5 xhigh, grok-4.7 xhigh
```

### 6. Confirm

Tell the user the file was written and that it applies to new sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves from `.github/skills/` or `~/.copilot/skills/`). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves from `.github/skills/` or `~/.copilot/skills/`). On no, move on without pushing.
