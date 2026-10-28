# Agent Skills Workshop — build a feature end to end

The 25 engineering skills in this folder come from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (see [AGENT-SKILLS-NOTICE.md](../AGENT-SKILLS-NOTICE.md)). Each skill is a `<name>/SKILL.md` that Copilot loads on demand. The four personas live in [../agents](../agents) and the shared checklists in [../references](../references).

This README is a hands-on workshop: you drive one small feature through the full lifecycle (idea → spec → plan → build → test → review → ship) using the skills, and verify it in the running eShop.

> The workshop uses only the Osmani skills. Other folders here (`aspire*`, `dotnet-inspect`, `playwright-cli`, `verify-mole`, ...) are eShop-specific and not part of it.

## 1. How to invoke a skill

In Copilot Chat (VS Code or CLI) every skill is a slash command named after its folder:

```text
/spec-driven-development  <your prompt>
```

Fallback that works everywhere: *"Use the spec-driven-development skill to …"*. Run `/skills` to confirm they are discovered. Personas are invoked as `@code-reviewer`, `@security-auditor`, `@test-engineer`, `@web-performance-auditor`.

The upstream shortcuts `/spec`, `/plan`, `/build`, `/test`, `/review`, `/ship` are Claude Code only. Use this mapping:

| Phase | Skill (slash command) |
|-------|-----------------------|
| Clarify | `/interview-me`, `/idea-refine` |
| Define | `/spec-driven-development` |
| Quality bar | `/constraint-driven-development` |
| Plan | `/planning-and-task-breakdown` |
| Build | `/incremental-implementation` (+ `/api-and-interface-design`, `/frontend-ui-engineering`) |
| Verify | `/test-driven-development`, `/browser-testing-with-devtools` |
| Review | `/code-review-and-quality`, `/security-and-hardening`, `/performance-optimization` |
| Ship | `/git-workflow-and-versioning`, `/documentation-and-adrs`, `/shipping-and-launch` |

## 2. The workshop feature

**Feature: "Deals page".** A new page for bargain hunters, built as new code next to the existing catalog rather than changing it. It touches three layers — a good size for one sitting (60–90 min):

| Layer | Where | Change |
|-------|-------|--------|
| API | [src/Catalog.API/Apis/CatalogApi.cs](../../src/Catalog.API/Apis/CatalogApi.cs) | New endpoint |
| Web client + UI | [src/WebAppComponents](../../src/WebAppComponents), [src/WebApp](../../src/WebApp) | New client method and page |
| Tests | [tests/Catalog.FunctionalTests](../../tests/Catalog.FunctionalTests), [e2e/](../../e2e) | New test cases/files only |

### Feature description (paste this into the first prompt)

The description is deliberately vague. Do not add detail: the point of Step 1 is that `/interview-me` pulls the details out of you.

```text
I want a "deals" page in the shop where people can quickly find cheap items.
```

Optional stretch goals for later phases: "add a Deals link to the header" (the first change to an existing page, so do it as its own task), "response caching on the endpoint", "add `count` to the OpenAPI doc", "log how often /deals is served".

## 3. Prerequisites

```bash
git remote get-url origin          # expect https://github.com/antshc/eShop(.git)
git switch -c workshop/deals-page dotnet build eShop.slnx            # baseline must be green
aspire start                       # needs a container runtime
```

Read first: [ARCHITECTURE.md](../../ARCHITECTURE.md), [GLOSSARY.md](../../GLOSSARY.md), [tests/README.md](../../tests/README.md). Run `dotnet test tests/Catalog.FunctionalTests` once to confirm the baseline passes.

## 4. Flow diagram — the skill chain

Top to bottom is the order you run the skills. Each box is a slash command; the text under it is the artifact it produces. Dashed boxes are optional, and the loop in the middle repeats per task.

```mermaid
flowchart TB
    S0["Setup<br/>git switch -c workshop/deals-page<br/>dotnet build + test"]
    S1["/interview-me<br/>confirmed requirements"]
    S2["/spec-driven-development<br/>docs/plans/deals-page-spec.md"]
    S3["/constraint-driven-development<br/>CONSTRAINTS.md"]
    S4["/planning-and-task-breakdown<br/>tasks/plan.md + tasks/todo.md"]

    subgraph LOOP["Build loop - repeat per task"]
        direction TB
        B1["/test-driven-development<br/>failing test (RED)"]
        B2["/incremental-implementation<br/>+ /api-and-interface-design<br/>+ /frontend-ui-engineering<br/>passing code (GREEN)"]
        B3["/git-workflow-and-versioning<br/>atomic commit"]
        B1 --> B2 --> B3
        B3 -. next task .-> B1
    end

    V["aspire start, then<br/>/browser-testing-with-devtools<br/>+ pnpm test:e2e<br/>runtime evidence"]

    subgraph REVIEW["Review - fix findings, rerun tests"]
        direction TB
        R1["/code-review-and-quality<br/>@code-reviewer"]
        R2["@security-auditor<br/>/security-and-hardening"]
        R3["/performance-optimization"]
        R1 --> R2 --> R3
    end

    D["/documentation-and-adrs<br/>API docs, ADR if needed"]
    L["/shipping-and-launch<br/>checklist + rollback plan"]
    P["git push origin<br/>gh pr create --repo antshc/eShop"]

    S0 --> S1 --> S2 -.-> S3 -.-> S4
    S2 --> S4
    S4 --> LOOP --> V --> REVIEW --> D --> L --> P

    classDef optional stroke-dasharray: 5 5;
    class S3 optional;
```

Your job at each arrow: read the output, correct it, and approve before running the next skill (spec, plan, and every RED → GREEN step are the gates).

## 5. Step-by-step exercises

Each step: **prompt → what to check → output**. Prompts are copy-paste ready.

### Step 1 — Clarify (`/interview-me`)

```text
/interview-me I want a "deals" page in the shop where people can quickly find cheap items.
```
Answer the questions one at a time with your own ideas. Expect questions like: what counts as a "deal"? how many items? where does the page live? what happens when there are none? does it need an API? what must not change?
**Check:** Copilot asks one question at a time, doesn't invent answers for you, and ends with a confirmed summary of requirements. That summary is the input to Step 2.

### Step 2 — Specify (`/spec-driven-development`)

```text
/spec-driven-development Write the spec for the confirmed feature. Read
ARCHITECTURE.md, GLOSSARY.md, docs/concepts/ops-error-handling-and-validation.md
and the existing Catalog API first. Save it as docs/plans/deals-page-spec.md.
```
**Check:** the spec has objective, commands (`dotnet test tests/Catalog.FunctionalTests`), project structure, testing strategy, boundaries, and testable acceptance criteria. Reject vague criteria like "works well".
**Output:** `docs/plans/deals-page-spec.md`. Edit it, then approve.

### Step 3 — Quality bar (optional, `/constraint-driven-development`)

```text
/constraint-driven-development Define constraints for this feature: all new
code covered by tests, no skipped tests, no new warnings, p95 of GET /items
not slower than baseline.
```
**Output:** `CONSTRAINTS.md`. Skills will now flag a weakened bar (skipped tests, suppressions).

### Step 4 — Plan (`/planning-and-task-breakdown`)

```text
/planning-and-task-breakdown Break docs/plans/deals-page-spec.md into
vertical slices with acceptance criteria and dependencies. Save to
tasks/plan.md and tasks/todo.md.
```
**Check:** ~4–6 tasks, each shippable on its own, e.g. (1) API `deals` endpoint returning the cheapest N, (2) `count` validation + 400 ProblemDetails, (3) `GetDeals` in the WebAppComponents `CatalogService`, (4) `/deals` page with empty state and `?count=`, (5) Playwright e2e, (6) docs. No task bigger than ~5 files.

### Step 5 — Build with TDD (`/test-driven-development` + `/incremental-implementation`)

Repeat for each task:

```text
/test-driven-development Task 1 from tasks/todo.md. Write the failing test first
in tests/Catalog.FunctionalTests/CatalogApiTests.cs and show me it fails.
```
```text
/incremental-implementation Implement only task 1 so the test passes. Use
/api-and-interface-design for the parameter contract. Run the tests, then stop.
```
For the UI slice use `/frontend-ui-engineering` (accessible `<select>` with a label, keyboard usable, no layout shift).
**Check each loop:** RED seen → GREEN seen → `dotnet test tests/Catalog.FunctionalTests` green → small commit.
```text
/git-workflow-and-versioning Commit this slice with an atomic message.
```

### Step 6 — Verify in the running app

```bash
aspire start
```
```text
/browser-testing-with-devtools Prove the /deals page shows the 8 cheapest items in ascending price order,
?count=3 shows exactly 3, an invalid count falls back to 8, and the existing Catalog page still works.
```
Then run `pnpm test:e2e`.
**Check:** evidence shows the actual prices in order, not just "page loaded"; the browser console is clean.

### Step 7 — Review (`/code-review-and-quality`)

```text
/code-review-and-quality Review all changes on this branch against main.
```
Then personas:
```text
@security-auditor Check the new `count` parameter and endpoint for abuse (large values, unauthenticated access) and error leakage.
@test-engineer Is the test coverage for the deals endpoint and page sufficient? Which edge cases are missing (empty catalog, equal prices, count 0/25)?
```
```text
/performance-optimization Does ORDER BY price use an index? Any extra queries per page load?
```
**Check:** findings are tagged by severity; fix Critical/Important ones, rerun tests.

### Step 8 — Document and ship

```text
/documentation-and-adrs Update API docs and add an ADR only if a decision needs recording
(e.g. a hard upper bound of 24 on `count`).
```
```text
/shipping-and-launch Produce the pre-launch checklist and rollback plan for this change.
```
```bash
git push origin workshop/deals-page
gh pr create --repo antshc/eShop --base main
```
Never target `dotnet/eShop` (`upstream`).

## 6. Done checklist

- [ ] Spec, plan and todo exist and match what was built
- [ ] Every acceptance criterion has a passing test (API + e2e)
- [ ] `dotnet build eShop.slnx` and affected `dotnet test` projects are green
- [ ] Feature verified in the running app with evidence
- [ ] Review findings fixed; no secrets or `artifacts/`/`bin/`/`obj/` committed
- [ ] Docs updated; PR opened against `antshc/eShop`

## 7. Tips

- One skill per prompt; let it finish and approve its output before moving on.
- If the agent goes off-track, run `/debugging-and-error-recovery` or `/doubt-driven-development` for a fresh-context challenge of its decision.
- Unsure which skill applies? Ask: *"Use using-agent-skills to pick the next skill for this task."*
- Skills reference shared checklists via `../../references/…`; those resolve to [../references](../references).

## 8. Other feature ideas for repeat runs

| Idea | Layers |
|------|--------|
| Wishlist (save items for later) | Identity, new service or Basket extension, WebApp |
| "Low stock" badge on items | Catalog API, WebApp component |
| Order history CSV export | Ordering API, WebApp |
| Rate limiting on Basket gRPC | Basket.API, ServiceDefaults |
