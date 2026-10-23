# Plan: redesign `tools/loop` dev workflow (plan → develop → chore → review → finalize)

## Problem
`tools/loop/workflows/dev` today: for each open Spec it reads existing sub-issues, runs **one harness-started
agent per ticket**, publishes a draft PR, runs a **chore** agent. It cannot plan a Spec that has no sub-issues,
has no review step, creates the PR with an empty body (which breaks the `code-review` skill's initiative gate)
and never finalizes. Reference design: `D:\_projects\afk\brain\plugins\wf\skills\implement-spec`
(read at `/mnt/d/_projects/afk/...`).

## Decisions (confirmed)
- Planner creates **real GitHub sub-issues via `gh`**, then returns them as JSON.
- **One developer orchestrator agent** per Spec spawns a **fresh subagent per ticket**; the harness validates commits.
- Review = reviewer agent invoking the user-installed **`code-review`** skill (nothing vendored).
- Scope: design + Python changes + rewritten prompts + tests + README.

## Target flow (per Spec)
```
fetch/preflight ─► PLAN ─► open worktree ─► DEVELOP ─► publish draft PR ─► CHORE ─► close worktree ─► REVIEW ─► FINALIZE
 (harness)       (planner)   (harness)     (dev orch.   (harness; body    (chore     (harness)      (reviewer   (harness)
                                            + subagents)  has initiative ID)  agent)                  agent)
```
1. **Preflight (harness)** – fetch, routing labels (`repo:target`, `repo:base`), `hitl` skip, base branch exists (existing logic); publish earlier unpublished commits.
2. **Plan (planner agent)** – runs on the checkout, no worktree, read-only on code. Spec has sub-issues → returns them unchanged (no writes). None → decomposes, creates sub-issues in dependency order (`gh issue create` + link as sub-issue, blockers noted in body), returns JSON. Unplannable/ambiguous → `failed` → harness labels Spec `hitl` with the reason. Harness re-reads sub-issues and checks they match the returned numbers.
3. **Develop (developer orchestrator + ticket subagents)** – one run in the worktree. Orchestrator never edits code; per ticket, strictly sequential: fill `implement.md`, launch a fresh subagent, check its one commit, ≤2 rework rounds, stop at first unrecoverable ticket. Returns per-ticket results JSON.
4. **Harness validation** – per ticket in order: commit SHA is the next commit since last verified head, exactly one, subject `ccode(<initiative>|<n>): `, worktree clean. Verified tickets are closed with an evidence comment; first bad ticket → `git restore` to last good head, failure recorded, retry developer for remaining tickets until `MAX_TICKET_FAILURES`, then `escalate` (hitl on ticket + Spec).
5. **Publish (harness)** – push; draft PR whose body's first line is the initiative ID plus the list of ticket refs (updated after each develop round). Fixes the code-review initiative gate.
6. **Chore (chore agent)** – unchanged mechanics (diff split to `bin/review_diff`, ≤1 commit, best-effort, restore on violation); prompt rewritten.
7. **Close worktree** – the `with ... open()` block ends (pushed, clean) before review.
8. **Review (reviewer agent)** – runs from the checkout (no worktree); invokes `code-review` with the PR URL; returns JSON: per-axis outcome, findings, posted comment IDs. Skill creates/cleans its own review worktree.
9. **Finalize (harness)** – stale-head check, then comment summary on the Spec (tickets→commits, chore, review axes/findings). Mark PR **ready** only if every ticket delivered, no `hitl` open, all axes completed at the current head, and no unresolved bug/initiative findings; otherwise leave draft and say why. Never merges; Spec stays open for a human.

Missing steps added vs. today: planner, review, finalize, PR body/initiative ID, worktree-before-review ordering,
stale-head check, completeness summary, per-role session names for telemetry.

## Agent roles
| Role | Kind | Prompt | Starts in | May | Must not | Returns |
|---|---|---|---|---|---|---|
| Harness | Python | – | – | all GitHub writes for tickets/Spec, push, PR, git validation/restore | implement code | exit code |
| Planner | agent | `plan.md` | checkout | `gh` read; create sub-issues | edit code, commit, push, label `hitl`, close | `{tickets:[{number,title,blocked_by}], created}` |
| Developer (orchestrator) | agent | `develop.md` | worktree | spawn one subagent per ticket, read git, rework | edit code, batch/reuse subagents, push, touch GitHub | per-ticket `{number,status,commit,summary,verification,reason}` |
| Ticket implementer | subagent | `implement.md` | worktree | edit, test, **one** commit | push, touch GitHub, other tickets | one-ticket JSON (as today) |
| Chore | agent | `chore.md` | worktree | cleanup ≤1 commit on PR diff | refetch PR, fix out-of-scope | summary |
| Reviewer | agent | `review.md` | checkout | run `code-review`, post findings | edit/commit/push, merge, mark ready | `{axes,findings,posted}` |

## Code changes (`tools/loop/workflows/dev`)
- `records.py`: `Spec.sub_issue count / has_sub_issues`; `PlanContext/PlanResult`, `DevelopContext/TicketOutcome`, `ReviewContext/ReviewResult`; `RepositoryWorkflow` callables.
- `platforms.py`: tracker also exposes closed/total sub-issues (needed to tell “no plan” from “all done”); `PullRequestClient.set_body`, `mark_ready`.
- `reply.py`: parsers for planner / developer / reviewer JSON (reuse `LastJsonObject`).
- `agent.py`: profiles `PLANNER/DEVELOPER/CHORE/REVIEWER`; `plan_spec`, `develop_spec`, `review_pull_request`; per-role `*_args`.
- `plan.py` (new), `attempt.py` → orchestrated-batch validation (keep commit checks), `review.py` (new: run_review + finalize).
- `backlog.py`: new flow above; `repositories.py`: wire new delegates; `__init__.py` exports.
- `prompts/`: new `plan.md`, `develop.md`, `review.md`; rewrite `implement.md` (subagent contract, `{{KEY}}` placeholders filled by orchestrator) and `chore.md`.
- Tests: update `doubles.py` and existing tests; add `test_plan.py`, `test_develop.py`, `test_review.py`; extend `test_package.py` (all prompts present, placeholders match args).
- `README.md`: roles table, flow, options.

## Notes / risks
- `antshc/eShop` currently reports **issues disabled** to `gh`; the workflow needs them enabled to run for real (not an implementation blocker; tests use fakes).
- Subagent spawning depends on the Copilot CLI task tool being available to the developer profile; verify with one dry run, harness fails the run if no valid per-ticket commits appear.
- Reviewer without a worktree: confirm `new_agent().open()` (no `with_git`) starts at the checkout root.
- Spec is not closed automatically (reference skill does); left to a human — easy to flip later.
