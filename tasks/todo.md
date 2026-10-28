# Tasks: Deals page

Spec: [docs/specs/deals-page.md](../docs/specs/deals-page.md) (antshc/eShop#2). Plan: [plan.md](plan.md).

## Task 1: Catalog API v2 ListItems supports orderBy=price

**Description:**
Extend the **v2** `ListItems` endpoint (`GET /api/catalog/items`, `CatalogApi.GetAllItems`) with an optional `orderBy` query parameter so callers can fetch the cheapest items across the whole catalog. `price` orders by `Price` asc → `Name` asc → `Id` asc; omitted/`name` keeps today's name ordering; anything else returns `400` problem details. v1 endpoints and their `Ok<…>` signatures (`GetAllItemsV1`, `GetItemsByName`, `GetItemsByBrandAndTypeId`, `GetItemsByBrandId`) stay unchanged — split the v2 handler's `Results<Ok<…>, BadRequest<ProblemDetails>>` signature from a shared query helper rather than widening the v1 return types.

**Acceptance criteria:**
- [x] `GET /api/catalog/items?api-version=2.0&orderBy=price` returns items with non-decreasing `Price`, ties by `Name` then `Id`; `pageSize=10` returns 10 items whose first is the cheapest in the whole catalog.
- [x] Omitting `orderBy` (or `orderBy=name`) and all v1 endpoints keep name ordering; an unknown `orderBy` returns `400` with problem details.
- [x] `orderBy` has a `[Description]` (shows in OpenAPI); no schema/DB change.

**Verification:**
- [x] Tests pass: `dotnet test --project tests/Catalog.FunctionalTests/Catalog.FunctionalTests.csproj` (new v2 tests: price ordering + ties, top-10 = global min, default-order regression, invalid → 400; assert ordering properties, not hard-coded names)
- [x] Build succeeds: `dotnet build eShop.slnx`
- [x] Manual check: Scalar/OpenAPI for v2 `ListItems` shows `orderBy`; v1 doc unchanged

**Dependencies:**
None

**Files likely touched:**
- `src/Catalog.API/Apis/CatalogApi.cs`
- `tests/Catalog.FunctionalTests/CatalogApiTests.cs`

**Estimated scope:**
S (2 files) — highest risk, do first

## Checkpoint: After Task 1 (API)
- [x] `dotnet build eShop.Web.slnf` succeeds (full `eShop.slnx` needs the MAUI workload locally)
- [x] `dotnet test --project tests/Catalog.FunctionalTests/Catalog.FunctionalTests.csproj` passes (43/43)
- [x] v1 `ListItems` and default v2 ordering unchanged
- [ ] Review with human before proceeding

## Task 2: Shopper can open /deals and see the 10 cheapest items

**Description:**
Add a cheapest-items client method and the `/deals` page so a shopper visiting `/deals` sees the 10 lowest-priced catalog items as normal product cards. `ICatalogService`/`CatalogService` gain a method calling `api/catalog/items?orderBy=price&pageIndex=0&pageSize={n}`; the HybridApp `CatalogService` (also implements `ICatalogService`) gets the same member. New `Pages/Deals/Deals.razor` at `@page "/deals"` with `[StreamRendering]`, mirroring `Catalog.razor`: hero title "Deals" + subtitle via `page-header-title`/`page-header-subtitle` (full-height hero — **not** added to `IsCompactHero`), loading skeleton, a `catalog-items` grid of `CatalogListItem`, and a `catalog-empty` state. No filters, sort control, or pagination. N=10 is a constant in the page.

**Acceptance criteria:**
- [ ] `/deals` renders at most 10 `CatalogListItem` cards from the whole catalog ordered price asc (ties by name); cards link to the existing item page.
- [ ] Zero items → empty state (not blank); while loading → skeleton; hero is full-height with title "Deals".
- [ ] No brand/type filters, sort control or pagination on the page; existing catalog CSS classes reused (add `Deals.razor.css` only if needed).

**Verification:**
- [ ] Build succeeds: `dotnet build eShop.slnx`
- [ ] Manual check: `aspire run`, open `/deals` — first card "Guardian Blue Chalk Bag" ($21.99), 10th "Excursion 20L Daypack" ($64.99); clicking a card opens its item page; layout matches home grid (optional `pnpm mole open /deals && pnpm mole snapshot`)

**Dependencies:**
Blocked by Task 1

**Files likely touched:**
- `src/WebAppComponents/Services/ICatalogService.cs`
- `src/WebAppComponents/Services/CatalogService.cs`
- `src/HybridApp/Services/CatalogService.cs`
- `src/WebApp/Components/Pages/Deals/Deals.razor`

**Estimated scope:**
M (4 files)

## Task 3: Header Deals link with E2E coverage

**Description:**
Make Deals reachable in one click and cover the whole flow end-to-end. `HeaderBar.razor` gets a **Deals** nav link next to **Shop all** (`href="deals"`) and an `IsDeals` check that adds `is-current` on the Deals page. Add an anonymous Playwright spec `e2e/DealsTest.spec.ts` and register it in the `'e2e tests without logged in'` project's `testMatch` in `playwright.config.ts` (files are matched by name, so it won't run otherwise).

**Acceptance criteria:**
- [ ] Every storefront page shows **Deals** next to **Shop all**; it navigates to `/deals` and has `is-current` there (and only there).
- [ ] E2E: click **Deals** → `/deals`; 10 `.catalog-product` cards with non-decreasing prices; card 1 "Guardian Blue Chalk Bag", card 10 "Excursion 20L Daypack"; clicking a card opens its item page.
- [ ] `DealsTest.spec.ts` runs under the anonymous project; existing E2E specs unaffected.

**Verification:**
- [ ] Tests pass: `pnpm exec playwright test e2e/DealsTest.spec.ts` and `pnpm exec playwright test e2e/BrowseItemTest.spec.ts`
- [ ] Build succeeds: `dotnet build eShop.slnx`
- [ ] Manual check: header link visible on home, item, cart pages; highlighted only on `/deals`

**Dependencies:**
Blocked by Task 2

**Files likely touched:**
- `src/WebApp/Components/Layout/HeaderBar.razor`
- `e2e/DealsTest.spec.ts`
- `playwright.config.ts`

**Estimated scope:**
S–M (3 files)

## Task 4: Define Deals in GLOSSARY.md

**Description:**
Add the **Deals** term to `GLOSSARY.md` under **Language**: the 10 lowest-priced catalog items, cheapest first. A deal is not a discount; prices are the normal catalog price. No other glossary or `ARCHITECTURE.md` changes (spec "Ask first").

**Acceptance criteria:**
- [ ] `GLOSSARY.md` → **Language** defines **Deals** as above, matching the existing entry format.
- [ ] No other glossary entries changed.

**Verification:**
- [ ] Manual check: diff touches only the new term; renders correctly on GitHub

**Dependencies:**
None (can run in parallel)

**Files likely touched:**
- `GLOSSARY.md`

**Estimated scope:**
XS (1 file)

## Checkpoint: Complete (after Tasks 1–4)
- [ ] `dotnet build eShop.slnx` succeeds; Catalog functional tests pass; `pnpm exec playwright test e2e/DealsTest.spec.ts` passes
- [ ] Existing E2E (`BrowseItemTest`, `CartTest`, `CheckoutTest`) still pass
- [ ] All spec Success Criteria checked
- [ ] Optional proof: `pnpm mole open /deals` screenshot matches the catalog grid
- [ ] Human review before PR
