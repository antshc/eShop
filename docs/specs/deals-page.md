# Spec: Deals page

Status: Approved (2026-10-28)

## Objective

Add a **Deals** page to the storefront that shows the **10 cheapest catalog items**, cheapest first. Shoppers on a budget can then find low-priced items in one click without browsing the whole catalog.

- **User:** Budget-minded shoppers on the storefront (`src/WebApp`), whether signed in or not.
- **Why:** Today the catalog can be browsed only by brand and type, sorted by name. The "Price: Low to High" sort reorders only the current page in the browser, so there is no quick way to see the cheapest items across the whole catalog.
- **"Cheap" means:** The lowest absolute `Price`. It does not mean discounted. There are no sales, no was/now pricing and no new pricing data.

### Confirmed intent

| | |
|---|---|
| Outcome | A Deals page listing the 10 cheapest catalog items, cheapest first |
| User | Budget-minded shoppers |
| Success | One click on **Deals** in the header shows the 10 lowest-priced items as normal product cards; shoppers open and buy them the same way as from the home catalog |
| Constraint | Use the existing single `Price`; N is fixed at 10 |
| Out of scope | Discounts or was/now pricing, admin-configurable deals, a home-page deals section, a shopper price slider or filters, and any change to how the basket or checkout handle prices |

### Behavior rules

1. The header nav shows a **Deals** link next to **Shop all** on every storefront page.
2. The **Deals** link opens `/deals`, and the link is marked current (`is-current`) on that page.
3. `/deals` shows at most **10** items, drawn from the **whole** catalog (every brand and type).
4. Items are ordered by `Price` ascending. Equal prices are ordered by `Name` ascending, then by `Id` ascending, so the result is deterministic.
5. Each item renders with the existing product card (`CatalogListItem`): image, brand, name and price. Clicking a card opens the existing item page, where the shopper adds it to the cart as usual.
6. If the catalog has fewer than 10 items, all of them are shown. If it has none, the page shows an empty state instead of a blank page.
7. The Deals page has no brand/type filters, no sort control and no pagination.
8. Items are listed whatever their stock (`AvailableStock`), the same as on the home catalog.

## Tech Stack

- .NET 10 (SDK pinned in `global.json`), ASP.NET Core minimal APIs with `Asp.Versioning`, and EF Core with PostgreSQL in `Catalog.API`.
- Blazor server-side rendering with `[StreamRendering]` in `WebApp`; shared components in `WebAppComponents`. The WebApp calls Catalog.API v2.
- Aspire AppHost (`src/eShop.AppHost`) for orchestration.
- Tests: xUnit functional tests on the Microsoft.Testing.Platform runner, and Playwright for E2E.

## Design

### API: Catalog.API

Extend the **v2** `ListItems` endpoint (`GET /api/catalog/items`, `CatalogApi.GetAllItems`) with an optional `orderBy` query parameter:

| `orderBy` | Ordering |
|---|---|
| omitted / `name` | `Name` (current behavior, unchanged) |
| `price` | `Price` asc, then `Name` asc, then `Id` asc |
| anything else | `400 Bad Request` (problem details) |

The Deals page calls `GET /api/catalog/items?orderBy=price&pageIndex=0&pageSize=10`. The v1 endpoint is unchanged. N=10 is a page decision held in the WebApp; the API stays generic.

### WebApp / WebAppComponents

- `CatalogService` (and `ICatalogService`) gets a method that fetches the N cheapest items through the API above.
- New page `src/WebApp/Components/Pages/Deals/Deals.razor` at `@page "/deals"` with `[StreamRendering]`:
  - Hero title "Deals" with a short subtitle about the lowest prices, set through the existing `page-header-title` and `page-header-subtitle` sections. It uses the **full-height** hero band (not compact), so the page is **not** added to `IsCompactHero`.
  - A loading skeleton, then a grid of `CatalogListItem` cards reusing the catalog grid styles, plus the empty state from rule 6.
- `HeaderBar.razor` gets a **Deals** nav link and an `IsDeals` check for `is-current`.

### Docs

- `GLOSSARY.md` → under **Language**, add **Deals**: the 10 lowest-priced catalog items, cheapest first. A deal is not a discount; prices are the normal catalog price.

## Commands

```bash
# Build
dotnet build eShop.slnx

# Catalog API functional tests (needs a container runtime)
dotnet test --project tests/Catalog.FunctionalTests/Catalog.FunctionalTests.csproj

# Run the app (needs a container runtime)
aspire run

# E2E (app running, or let Playwright start it per playwright.config.ts)
pnpm exec playwright test e2e/DealsTest.spec.ts

# Optional storefront proof
pnpm mole up --start && pnpm mole open /deals && pnpm mole snapshot
```

## Project Structure

```
src/Catalog.API/Apis/CatalogApi.cs                → orderBy on v2 ListItems
src/WebAppComponents/Services/CatalogService.cs   → cheapest-items client method
src/WebAppComponents/Services/ICatalogService.cs  → interface member
src/WebApp/Components/Pages/Deals/Deals.razor     → new page (+ Deals.razor.css only if needed)
src/WebApp/Components/Layout/HeaderBar.razor      → Deals nav link
tests/Catalog.FunctionalTests/CatalogApiTests.cs  → orderBy tests
e2e/DealsTest.spec.ts                             → browser flow
GLOSSARY.md                                       → "Deals" term
```

## Code Style

Follow the existing minimal-API style in `CatalogApi.cs`: typed results, `[Description]` on query parameters, and the `IQueryable` built up before paging.

```csharp
[Description("Order of the results: 'name' (default) or 'price' (cheapest first, ties by name then id).")] string? orderBy

IOrderedQueryable<CatalogItem> ordered = orderBy switch
{
    null or "name" => root.OrderBy(c => c.Name),
    "price" => root.OrderBy(c => c.Price).ThenBy(c => c.Name).ThenBy(c => c.Id),
    _ => // reject with 400 per the existing error-handling conventions
};
```

- Razor pages mirror `Pages/Catalog/Catalog.razor`: inject `CatalogService`, load in `OnInitializedAsync`, render the skeleton while `null`.
- Reuse the existing CSS classes (`catalog-items`, `catalog-card-skeleton`, `catalog-empty`) before adding new ones.
- Comments only where clarification is needed.

## Testing Strategy

Following `docs/concepts/ops-test-strategy.md`:

- **API functional tests (xUnit, `Catalog.FunctionalTests`, v2 only):**
  - `orderBy=price` returns items with non-decreasing `Price`, and ties are ordered by `Name`.
  - `orderBy=price&pageSize=10` returns 10 items, and the first is the cheapest item in the whole catalog.
  - Omitting `orderBy` keeps today's name ordering (regression).
  - An unknown `orderBy` value returns 400.
  - Assert ordering *properties* rather than hard-coded names, because other tests in the fixture update prices.
- **E2E (Playwright, `e2e/DealsTest.spec.ts`, anonymous):**
  - Clicking **Deals** in the header goes to `/deals`.
  - 10 `.catalog-product` cards are shown, and their displayed prices are non-decreasing.
  - Against the seed data, the first card is "Guardian Blue Chalk Bag" ($21.99). The 10th is "Excursion 20L Daypack" ($64.99), which shows the name tie-break against "Zenith Cycling Jersey" at the same price.
  - Clicking a card opens its item page.
- **Manual or proof:** `mole open /deals` and a screenshot to check the layout matches the catalog grid.

## Boundaries

- **Always:** Keep v1 and the default v2 ordering unchanged; reuse `CatalogListItem` and the existing catalog styles; run the Catalog functional tests and the new E2E test before committing; follow the conventions in `CatalogApi.cs` and `Catalog.razor`.
- **Ask first:** Any database or schema change; new NuGet or npm dependencies; changing the existing catalog page's client-side sort; adding a Deals feature to `proof/features`; any `ARCHITECTURE.md` change, or `GLOSSARY.md` changes beyond the "Deals" term.
- **Never:** Add discount or original-price fields; change basket or checkout pricing; make N configurable by admins or shoppers; push to or open PRs against `dotnet/eShop`.

## Success Criteria

- [ ] Every storefront page shows a **Deals** link in the header; it navigates to `/deals` and is marked current there.
- [ ] `/deals` shows exactly 10 product cards from the whole catalog (fewer only if the catalog has fewer than 10 items).
- [ ] Cards are ordered by price ascending, with ties by name. Against the seed data, card 1 is "Guardian Blue Chalk Bag" and card 10 is "Excursion 20L Daypack".
- [ ] Cards look and behave like home-catalog cards: clicking one opens the item page, and it can be added to the cart from there.
- [ ] `GET /api/catalog/items?orderBy=price` (v2) works as specified; the default and v1 behavior are unchanged; an invalid `orderBy` returns 400.
- [ ] `/deals` uses the full-height hero band with the title "Deals".
- [ ] `GLOSSARY.md` defines **Deals**.
- [ ] `dotnet build eShop.slnx` succeeds; the Catalog functional tests and `e2e/DealsTest.spec.ts` pass.

## Decisions

1. **API shape:** Extend v2 `ListItems` with `orderBy`; no dedicated deals endpoint.
2. **Hero:** Full-height hero band.
3. **Docs:** Add "Deals" to `GLOSSARY.md`.
4. **Tracking:** Filed as GitHub issue antshc/eShop#2 (labels `spec`, `enhancement`).
