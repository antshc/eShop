# loop dev workflow

Delivers an open Spec issue on `antshc/eShop` end to end: plan its Tickets (sub-issues), deliver each
one on a shared worktree, verify the running app, clean up, review, and finalize a draft pull
request. It is built on the [loop](https://github.com/antshc/loop) library; eShop is its own
harness, so Specs, Tickets and code all live in this repository.

**Code owns the flow; agents are bounded actors inside it.** Python sequences the stages, retries,
validates every agent's work and performs every commit, push, PR and issue write. An agent only works
(edits files or reads) and answers with a JSON envelope; its proposed commit message is the only thing the
harness takes from it.

## Actors

| Actor | Kind | Aspire resource | Starts in | May | Must not | Returns |
|---|---|---|---|---|---|---|
| Engineer | human | `engineer` | - | start a run, resolve `hitl` | - | - |
| Harness | code | `code` | - | fetch, worktrees, **commits**, restore, push, PRs, issue writes, all gates | implement code | exit code |
| Planner | agent | `planner` | checkout | read the repo and Spec | edit, commit, create issues | `tickets[{title, body, blocked_by}]` |
| Developer (fresh per Ticket) | agent | `developer` | worktree | edit code and tests, run checks | commit, push, touch GitHub, other Tickets | `commit_message`, `summary`, `verification` |
| Verifier | agent | `verifier` | worktree | drive the app with the repo's verification skill (`verify-mole`), fix app code and tests | commit, change `proof/`, `e2e/`, skills | `verdict`, `findings`, `commit_message` |
| Chore | agent | `chore` | worktree | clean up the PR diff (`bin/review_diff`) | commit, refetch the PR, fix out-of-scope code | `commit_message`, `summary`, `out_of_scope` |
| Reviewer | agent | `reviewer` | checkout | run the installed `code-review` skill, post findings | edit, commit, push, merge, mark ready | `axes`, `findings`, `posted`, `head` |

Read-only roles (planner, reviewer) are held to it by comparing `HEAD` and `git status` before and after
the run; a violation fails the stage (the user's checkout is never reset). In the worktree, any run that
moves `HEAD` is discarded with `git restore`.

## Flow (per Spec)

```
engineer  spec #N
 |- code     preflight       fetch, routing labels, hitl skip, base branch exists, publish earlier commits
 |- planner  plan            only when the Spec has no sub-issues; read-only
 |- code     create-tickets  validates the plan, creates linked sub-issues (blockers in the body)
 |- code     deliver         worktree
 |   per Ticket, in order:
 |   |- developer  ticket #n   edits only
 |   |- code       gates       valid envelope, HEAD unmoved, changes to commit
 |   |- code       commit      `ccode(<initiative>|<n>): <message>`, body = summary + verification
 |   |- code       close-ticket, publish   evidence comment; push + draft PR (body line 1 = initiative ID)
 |   `- failure -> restore, retry up to MAX_TICKET_FAILURES, then escalate (`hitl` on Ticket and Spec)
 |- verifier verify          skipped when no verification skill exists; fixes become one `fix(<initiative>): ` commit
 |- chore    chore           best effort; one `chore(<initiative>): ` commit
 |- reviewer review          after the worktree is closed, from the checkout
 `- code     finalize        stale-head check, summary comment, mark the PR ready only if every gate passes
```

The PR is marked ready only when every Ticket is delivered, none is held for a human, app verification passed
(or there is no verification skill), the review completed every axis at the current head, and no `bug` or
`initiative` finding is unresolved. Otherwise it stays a draft and the Spec comment says why. The Spec is never
closed and the PR never merged.

## Phases

Every stage is a phase: a named span owned by one actor, of a kind (`engineer`, `code` or `agent`).
A phase starts as `fail` and earns `success` by exiting cleanly with every gate green; an exception or a
failed gate keeps it `fail`. Phases nest in the order below and are exported as spans (see [Telemetry](#telemetry)).

| Phase | Kind | Owner (resource) | Attributes | Gates (a failed gate fails the phase) |
|---|---|---|---|---|
| `spec #N` | engineer | `engineer` | `spec`, `initiative` | - (run root; wraps everything below) |
| `preflight` | code | `code` | `spec` | - (fails when the base branch is missing) |
| `plan` | agent | `planner` | `spec`, `planned` | checkout unchanged, plan valid (1-15 Tickets, each blocked only by earlier ones) |
| `create-tickets` | code | `code` | `spec`, `tickets` | - (fails when a sub-issue cannot be created or linked) |
| `deliver` | code | `code` | `spec` | - (the worktree's lifetime; wraps the ticket, verify and chore phases) |
| `ticket #n` | agent | `developer` | `ticket`, `attempt` | response answers this Ticket, the agent did not commit, the agent left changes |
| `commit` | code | `code` | `ticket`, `commit` | - (harness commit of the developer's edits) |
| `close-ticket` | code | `code` | `ticket`, `commit` | - (evidence comment and closure) |
| `restore` | code | `code` | `ticket`, `to` | - (`git restore` to the last good head after a rejected attempt or discarded fixes) |
| `escalate` | code | `code` | `ticket`, `reason` | - (`hitl` on the Ticket and the Spec after `MAX_TICKET_FAILURES`) |
| `publish` | code | `code` | `spec`, `pull_request` | - (push, draft PR create or body update; runs after every Ticket) |
| `verify` | agent | `verifier` | `spec`, `skills`, `verdict` | the agent did not commit, evidence was saved |
| `commit-fixes` | code | `code` | `spec`, `commit` | - (one `fix(<initiative>): ` commit; skipped when fixes touch `proof/`, `e2e/` or skills) |
| `chore` | agent | `chore` | `spec` | the agent did not commit |
| `commit-chore` | code | `code` | `spec`, `commit` | - (one `chore(<initiative>): ` commit and push) |
| `review` | agent | `reviewer` | `spec`, `head`, `findings`, `posted` | checkout unchanged, every axis completed, the reviewed head is the current head |
| `finalize` | code | `code` | `spec`, `ready` | PR head unchanged since the review |

`ticket #n`, `commit`, `close-ticket` and `publish` repeat per Ticket; `restore` and `escalate` appear only on
failure; `verify` and `commit-fixes` only when the repository has a verification skill.

## Setup

```sh
python -m pip install -r tools/loop/requirements.txt
```

Needs Git, an authenticated `gh`, and the Copilot CLI. Run it from the repository root: Loop
requires worktrees inside the working directory, so they go to `.loop/worktrees/` (gitignored,
as are the logs and journal in `.loop/`).

## Run

```sh
PYTHONPATH=tools/loop python -m workflows dev --spec <SPEC_ISSUE_NUMBER>
```

Agents run on the host with your permissions and the dev workflow creates commits, pushes
branches and opens draft PRs: read the prompts in [workflows/dev/prompts/](workflows/dev/prompts/)
first. A Spec needs `repo:target:antshc/eShop` and `repo:base:<branch>` labels; Specs labelled
`hitl` are skipped.

| Option | Default | Effect |
|---|---|---|
| `--spec NUMBER` | every open Spec | Deliver only this Spec issue. |
| `--log-dir DIR` | `./.loop` | Journal and `dev.log`. |
| `--log-level LEVEL` | `INFO` | Log level. |
| `--otel-endpoint URL` | `OTEL_EXPORTER_OTLP_ENDPOINT`, else `http://localhost:4318` | OTLP/HTTP base URL for telemetry. |
| `--no-otel` | off | Do not export telemetry. |

## Telemetry

Every Agent Run, Worktree and **phase** is exported as OpenTelemetry spans and metrics over OTLP/HTTP, as
service `loop-dev` with one Aspire resource per actor (`engineer`, `code`, `planner`, `developer`, `verifier`,
`chore`, `reviewer`). Each stage above is a phase span on its owner's resource with `loop.phase.kind`
(`engineer | code | agent`), `loop.phase.owner`, `loop.phase.status` (`fail` until the stage earns `success`),
the Spec/Ticket/commit it concerned, and one `loop.gate` event per verified claim. Agent runs from inside the
worktree nest under the `loop.worktree` span rather than their phase span; correlate them by time and ticket. The default endpoint is the standalone Aspire
dashboard. Either run it in Docker (UI on http://localhost:18888):

```sh
mkdir -p .loop/dashboard
docker compose -f tools/loop/compose.yaml up -d
```

[compose.yaml](compose.yaml) binds the ports to localhost, allows anonymous access (local development
only), and persists each start under `.loop/dashboard/` as the host user (override with `LOOP_UID`/`LOOP_GID`
if your ids are not 1000; `LOOP_DASHBOARD_PORT`, `LOOP_OTLP_GRPC_PORT` and `LOOP_OTLP_HTTP_PORT` change the
host ports). Or run it with the Aspire CLI:

```sh
ASPIRE_DASHBOARD_DATA_DIRECTORY="$PWD/.loop/dashboard" \
  aspire dashboard run --otlp-http-url http://localhost:4318 --allow-anonymous --application-name eShop-loop --persistence Run
```

`--persistence Run` saves each dashboard start as its own SQLite database under
`.loop/dashboard/runs/` (gitignored; last 10 unpinned runs kept), so telemetry survives restarts and past
runs can be picked in the dashboard. Without `ASPIRE_DASHBOARD_DATA_DIRECTORY` the data goes to
`~/.aspire/dashboard/`. Use `Resume` for one continuous history, `None` (the default) for a temporary database.

If the dashboard requires an API key (no `--allow-anonymous`), set `OTEL_EXPORTER_OTLP_HEADERS="x-otlp-api-key=<key>"`.
Without a collector the export fails quietly in the background; pass `--no-otel` to skip it.
Only the default agent factory is instrumented; a `new_agent` passed to `main()` owns its own setup.

## Tests

```sh
cd tools/loop && PYTHONPATH=. python -m pytest workflows
```
