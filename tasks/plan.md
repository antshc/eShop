# Implementation Plan: Deals page

Spec: [docs/specs/deals-page.md](../docs/specs/deals-page.md) — tracked as GitHub issue antshc/eShop#2.

## Overview

Add a `/deals` storefront page that lists the 10 cheapest catalog items, cheapest first. To support it, the v2 `ListItems` endpoint gets an optional `orderBy=price` parameter. The page reuses the existing `CatalogListItem` cards and catalog grid styles, the header gets a **Deals** link, and `GLOSSARY.md` gets the "Deals" term.

## Architecture Decisions

- **Generic API, page-owned N.** Extend v2 `GET /api/catalog/items` with `orderBy` (`name` default, `price` = Price→Name→Id). There is no deals endpoint; N=10 lives in the WebApp. (Spec decision 1)
- **Invalid `orderBy` → 400 problem details**, per [Error Handling and Request Validation](../docs/concepts/ops-error-handling-and-validation.md). Because `GetAllItems` is shared by four v1 endpoints that return `Ok<…>`, the v2 handler gets its own `Results<Ok<…>, BadRequest<ProblemDetails>>` signature. The v1 callers keep their current return types and name ordering, so v1 OpenAPI and behavior stay unchanged.
- **Interface parity.** `ICatalogService` gains the cheapest-items member, so `src/HybridApp/Services/CatalogService.cs` (which also implements it) gets the same implementation. This keeps the MAUI build green even though CI builds it in a separate workflow.
- **Full-height hero.** `Deals` is not added to `IsCompactHero`. (Spec decision 2)
- **Tests.** API ordering goes in the xUnit `Catalog.FunctionalTests` (assert ordering properties, not names). The browser flow goes in Playwright, and `DealsTest.spec.ts` must be registered in the anonymous project's `testMatch` in `playwright.config.ts`.

## Dependency Graph

```
T1 API orderBy (Catalog.API + functional tests)
 └── T2 Deals page reachable at /deals (client method + page)
      └── T3 Header Deals link + E2E flow
T4 Glossary term (independent)
```

## Task List

Tasks are tracked locally in [todo.md](todo.md) (not as GitHub sub-issues). Acceptance criteria and verification steps for each task are there.

### Phase 1: API foundation (highest risk first)
- [ ] T1: Catalog API v2 `ListItems` supports `orderBy=price`

### Checkpoint: API
- [ ] `dotnet build eShop.slnx` succeeds
- [ ] `dotnet test --project tests/Catalog.FunctionalTests/Catalog.FunctionalTests.csproj` passes (new and existing tests)
- [ ] v1 `ListItems` and default v2 ordering unchanged

### Phase 2: Storefront slice
- [ ] T2: Shopper can open `/deals` and see the 10 cheapest items (blocked by T1)
- [ ] T3: Header **Deals** link and E2E coverage (blocked by T2)
- [ ] T4: Define **Deals** in `GLOSSARY.md` (independent)

### Checkpoint: Complete
- [ ] `dotnet build eShop.slnx` succeeds; Catalog functional tests pass; `pnpm exec playwright test e2e/DealsTest.spec.ts` passes
- [ ] Existing E2E (`BrowseItemTest`, `CartTest`, `CheckoutTest`) still pass
- [ ] All spec Success Criteria checked
- [ ] Optional proof: `pnpm mole open /deals` screenshot matches the catalog grid
- [ ] Human review before PR

## Parallelization

- T4 can run any time, in parallel with everything else.
- T1 → T2 → T3 must run in order. T2 depends on the API contract; T3's E2E test asserts the page from T2.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Changing the `GetAllItems` return type ripples into the v1 handlers and their OpenAPI | Med | Split the v2 handler signature from a shared query helper; keep the v1 handlers' `Ok<…>` types; regression test for default ordering |
| Other functional tests in the shared fixture change prices (e.g. 1.99, 11000.08) | Med | Assert ordering properties and "first = min price in whole catalog", not hard-coded names (spec) |
| `DealsTest.spec.ts` silently not run because `playwright.config.ts` matches files by name | Med | Add it to the anonymous project's `testMatch` in T3 |
| HybridApp build breaks from the new interface member | Low | Implement it in HybridApp `CatalogService` in T2; MAUI build runs in its own workflow |
| E2E seed expectations (Guardian Blue Chalk Bag first, Excursion 20L Daypack 10th) drift if the functional tests share the E2E database | Low | E2E runs against a fresh AppHost seed; functional tests use their own fixture |

## Open Questions

- None blocking. The spec's "Ask first" items (schema change, new deps, catalog client-side sort, `proof/features`, `ARCHITECTURE.md`) are not needed by this plan.
