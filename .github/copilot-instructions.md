# Copilot Instructions

## 1. Scope and repository topology

Single repository: docs and codebase live together at the repo root (no `workspace/` split, no harness).

- **Docs & decisions** live at the root: `GLOSSARY.md` (domain glossary) and `ARCHITECTURE.md` (system map, ADR/Concept indexes), with ADRs under `docs/adr/` and Crosscutting Concepts under `docs/concepts/` (both created lazily).
- **Source code** lives in `src/` (services, apps, shared libraries) and `tests/`; the solution is [`eShop.slnx`](../eShop.slnx), orchestrated by the Aspire AppHost at `src/eShop.AppHost`.

Within this file, resolve conflicts in this order: **safety and repository targeting → authoritative sources → navigation → build and validation → documentation conventions.** This ordering scopes only the rules in this file; it does not override `AGENTS.md`, path-scoped instructions, or user instructions.

## 2. Safety and repository targeting

- Work happens in `antshc/eShop` (`origin`). `upstream` is `dotnet/eShop` — never push or open PRs against it.
- Verify the target before the first `git`/`gh pr` action in a session by actually running:

  ```bash
  git remote get-url origin   # expect https://github.com/antshc/eShop(.git)
  git rev-parse --show-toplevel
  ```

- Never commit build output (`artifacts/`, `bin/`, `obj/`) or secrets.
- Create `gh` issues, PRs, and labels against `antshc/eShop` (or run from the repo root).

## 3. Authoritative sources

Consult these before searching the code:

- **Domain glossary:** [`GLOSSARY.md`](../GLOSSARY.md) — domain terminology.
- **Architecture:** [`ARCHITECTURE.md`](../ARCHITECTURE.md) — system map, ADR/Concept indexes.
- **Getting started / run / test:** [`README.md`](../README.md), [`tests/README.md`](../tests/README.md).
- **Contributing:** [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## 4. Code navigation

1. Read the relevant authoritative source first and state which doc you checked (or that none applies) before searching.
2. Know the exact symbol → use code intelligence/LSP (definitions, references, rename). Know only the concept → semantic search. Literal/config value → text search.
3. Exclude `artifacts/`, `**/bin/`, `**/obj/`, `TestResults/`, and `node_modules/` from searches.
4. Docs are leads, not proof: confirm behavior against current source or tests, then stop searching once you can name the file and symbol that control the behavior.

## 5. Build and validation

- SDK is pinned by [`global.json`](../global.json) (.NET 10, Microsoft.Testing.Platform runner).
- Build: `dotnet build eShop.slnx` (web-only subset: `eShop.Web.slnf`).
- Run the app: `aspire run` (requires a running container runtime).
- Tests: `dotnet test <project>` for the smallest affected test project under `tests/`; E2E tests use Playwright (`playwright.config.ts`, `e2e/`).
- Use the `aspire*`, `dotnet-inspect`, and `playwright-cli` skills for Aspire lifecycle, .NET API lookup, and browser automation.

## 6. Documentation conventions

- Author all docs (`GLOSSARY.md`, `ARCHITECTURE.md`, ADRs, Crosscutting Concepts) at the repo root / `docs/`.
- Keep `GLOSSARY.md` and `ARCHITECTURE.md` high-level — no implementation details, specs, or scratch notes.
- Cross-reference plans against code under `src/`.

## 7. Skills

- Create every skill under `.github/skills/<skill-name>/` — never in the user skills directory (`~/.copilot/skills/`). Each skill is its own folder holding `SKILL.md` plus any reference files.
- Do not reference a skill's own files via bare relative markdown links; load them via the skill's absolute base directory.

Available skills: `aspire`, `aspire-init`, `aspire-orchestration`, `aspire-deployment`, `aspire-monitoring`, `aspireify`, `dotnet-inspect`, `playwright-cli` — see each skill's frontmatter `description` for trigger conditions; do not restate them here.

## 8. Tools

- **`gh` CLI** — GitHub issues are the only backlog backend; authenticated as `antshc`.
- **Aspire CLI** (`aspire`) — start/stop/describe/logs for the AppHost.
