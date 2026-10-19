---
feature: catalog
touches:
  - src/WebApp/Components/Pages/Catalog/
  - src/WebAppComponents/Catalog/
  - src/WebApp/wwwroot/js/catalog-sort.js
  - src/Catalog.API/
prove: pnpm mole prove --feature catalog
---

# Catalog browsing (eShop)

The AdventureWorks storefront home page (`/`) lists the product catalog for an anonymous visitor. They page through it and narrow it by brand and type. Server-rendered Blazor; the seed has 101 products, 13 brands and 8 types, 9 products per page.

Run every command below from the repo root with `pnpm mole`. The loop in the [verify-mole skill](../SKILL.md) applies.

## Sub-features

- **Product grid:** product cards (`.catalog-product`, with `.name` and `.price`), 9 per page.
- **Count:** `.catalog-count` shows the total matches (`101 products`), not the page size.
- **Pagination:** Prev, page numbers, ellipsis and Next. The page lives in the URL as `?page=N`.
- **Filters:** Brand and Type tags, each with a count. Several tags in one group are OR; the two groups are AND. The URL holds `?brand=ID&type=ID`. **Clear all filters** appears once one is active.
- **Empty state:** "No products match these filters" with a Clear all filters button.
- **Sort:** a client-side control (Name A to Z/Z to A, Price low to high/high to low). It reorders the cards on the current page only, and the choice is saved in localStorage under `aw.catalog.sort.v1`.

## How to get to it (user POV)

Open the storefront (`http://localhost:5045`). The heading reads "Ready for a new adventure?" and the grid fills in a moment later. Click page **2**, or a Brand or Type tag. Reload: the same page, filters and products are still there.

## Driving it with mole

```bash
pnpm mole doctor                          # app up and build fresh?
pnpm mole reset                           # fresh visitor (clears cookies and the saved sort)
pnpm mole open /
pnpm mole page 2
pnpm mole reload
pnpm mole snapshot                        # count, page, products (name, price, href)
pnpm mole filter --brand Daybird          # also --type Navigation, --clear
pnpm mole console --errors
pnpm mole prove --feature catalog         # this feature only; run pnpm mole prove (all) before you report
```

Handles: heading "Ready for a new adventure?", `.catalog-product`, `.catalog-count`, `.catalog-empty`, role `link` named `2` (exact) for pagination, "Clear all filters", and the filter tags inside `.catalog-search-group` (Brand, Type).

## What done means

1. The home page lists products, and page 2 shows 9 (as `e2e/BrowseItemTest.spec.ts`).
2. `?page=2` survives a reload, and so does the product list.
3. A brand or type filter narrows the list, and `.catalog-count` matches it. Daybird has 10 products.
4. Picking a filter sends the visitor back to page 1 (the filter links drop `page`).
5. A filter with no matches shows the empty state, not a blank page. Clear all filters restores the full catalog.

## Gotchas

- The grid streams in after the first paint, and the first load after a cold start is slow. A count of 0 straight after `open` is not a finding. Wait or `snapshot` again.
- Sort only reorders the cards on the page you are on, and the preference outlives a reload. If the card order surprises you, run `pnpm mole reset` first. The first card is whatever the saved sort puts first.
- `prove --feature catalog` covers the hero heading, the product list and its count (101), page 2 with a reload, the Daybird filter (10 products, page dropped), the empty state and Clear all filters. It does not check Type filters, counts per tag or sort: drive those yourself.
- A PASS does not fail on `pageErrors`. After the user path, check `pnpm mole console --errors` is empty.
- Blazor does not hot-reload under mole. After editing `src/WebApp` or `src/WebAppComponents`, restart the app (`pnpm mole down`, then `up`); otherwise `doctor` reports the build STALE and `prove` exits 2.
- Anonymous visitor only. Signed-in behavior needs the `e2e/` credentials and is out of scope.
