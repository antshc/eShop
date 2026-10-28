# Constraints

Last reviewed: 2026-10-28 by @antshc

This file sets the project's quality bar. Read it before writing code. Do not weaken it to make a change pass: tightening a rule can go in any commit, loosening one needs its own commit with the reason.

**Mode: warn.** Floor and architecture findings are reported by the checks and must be listed in the hand-off (PR body or task summary), but they do not block. The build already blocks in CI and still does. To make the checks block, run them with `--strict` and update this line.

## Floor

Always applies and needs no setup. Checked against the diff from the merge base with `origin/main`, including untracked files, by `node tools/constraints/floor-guard.mjs`.

- No new suppressions: `#pragma warning disable`, `[SuppressMessage]`, `[ExcludeFromCodeCoverage]`, `<NoWarn>`, `<WarningsNotAsErrors>`, `<TreatWarningsAsErrors>false`, `.editorconfig` severities lowered to `none`/`silent`/`suggestion`, `@ts-ignore`, `eslint-disable`
- No unfinished work: `throw new NotImplementedException()`, empty `catch { }`, new `TODO`
- No easier tests: no added `Skip =`, `[Ignore]`, `test.skip`/`test.only`/`test.fixme`; no deleted test files; no assertions removed from tests that stay
- No new project references beyond the recorded baseline (see Architecture)
- No secrets in source: written only, with no scanner installed (security scanning was not selected)
- This file does not get weakened to make a change pass

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Floor | 0 new floor findings in the diff | `node tools/constraints/floor-guard.mjs` | every edit, task end, CI |
| Architecture | 0 project references outside the baseline | `node tools/constraints/project-graph.mjs` | every edit, task end, CI |
| Build | 0 errors; warnings are errors (`TreatWarningsAsErrors`) | `dotnet build eShop.Web.slnf` | task end, CI |

Why these numbers: each rule is a count that should stay at 0, so nothing needs tuning. The architecture rule keeps today's graph rather than an invented ideal, because today's code passes it and any new edge is a decision someone should see.

### Architecture

The allowed project references (`From -> To`) are recorded in [tools/constraints/project-references.baseline.txt](tools/constraints/project-references.baseline.txt): 46 edges taken from `eShop.slnx` on 2026-10-28. The AppHost wires services by path (`AddCSharpApp`), not through `ProjectReference`, so it has no outgoing edges.

- A new edge (for example `WebApp -> Catalog.API`) is reported as `boundary-widened`. Remove it and call the service over HTTP, or get the edge reviewed and record it with `node tools/constraints/project-graph.mjs --update` in its own commit.
- A removed edge tightens the graph: run `--update` to ratchet the baseline down.

## Lifecycle

| Stage | Command | Runs | Budget |
|-------|---------|------|--------|
| After an edit | `pnpm check:fast` | floor + architecture | under 5s |
| Task end (before hand-off) | `pnpm check:task` | fast + web build | 90s |
| CI (`pr-validation.yml`, `constraints` job) | `node tools/constraints/check.mjs --stage fast --base origin/<base>` | floor + architecture (`continue-on-error`) | unlimited |

Exit codes: `0` pass or warn-only findings, `1` build failure (or findings with `--strict`), `2` a check could not run. A `2` is "can't tell", not "clean".

## Measured, not yet enforced

Recorded with `git grep` on tracked files, 2026-10-28.

| Metric | Today | Direction |
|--------|-------|-----------|
| Warning suppressions in `src/`, `tests/` (`#pragma warning disable`, `[SuppressMessage]`) | 20 | must not grow |
| `<NoWarn>` entries in `*.csproj` / `*.props` | 3 | must not grow |
| `TODO` in `src/`, `tests/`, `e2e/` | 7 | must not grow |
| Skipped tests | 0 | must not grow |
| Project references | 46 | must not grow |

## Exceptions

None. Add a row with an ID (`W1`, `W2`, …), the rule, the path, the reason, an owner and an expiry no more than 90 days out. The floor guard reports every new row.

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|

## Not covered

These dimensions were considered and not selected on 2026-10-28: coverage on new code, security scanning (secrets, dependencies), performance budgets and accessibility. Every check above is judged by the project's own code (`git diff`, `ProjectReference`, the compiler), so there is no external check such as axe, Lighthouse or osv-scanner. The build's NuGet audit warnings `NU1901`–`NU1904` are still suppressed in `Directory.Build.props`.
