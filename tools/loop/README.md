# loop dev workflow

Delivers the Tickets (sub-issues) of an open Spec issue on `antshc/eShop`: one worktree per Spec,
one agent run per Ticket, then a draft pull request. It is built on the
[loop](https://github.com/antshc/loop) library; eShop is its own harness, so Specs, Tickets and
code all live in this repository.

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

Every Agent Run and Worktree is exported as OpenTelemetry spans and metrics over OTLP/HTTP, as
service `loop-dev` with one resource per agent. The default endpoint is the standalone Aspire
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
