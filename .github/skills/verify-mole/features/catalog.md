---
feature: catalog
touches:
  - src/WebApp/Components/Pages/Catalog/
  - src/WebAppComponents/Catalog/
  - src/WebApp/wwwroot/js/catalog-sort.js
  - src/Catalog.API/
surfaces:
  - web
  - api
prove: pnpm mole prove --feature catalog
---

# Catalog browsing (eShop)

An anonymous visitor lists the product catalog, pages through it, and narrows it by brand and type. The seed has 101 products, 13 brands and 8 types, 9 products per page. The same catalog is read on two surfaces: the storefront (`web`) and the catalog API behind it (`api`).

Run every command from the repo root with `pnpm mole`. The loop in the [verify-mole skill](../SKILL.md) applies.

## Contract

These hold on every surface. `pnpm mole prove --feature catalog` checks each one per surface.

1. A page lists up to 9 products, each with a name and a price. The first page lists 9.
2. The total is the number of products that match, not the page size: 101 for the whole catalog.
3. Pages count from 1. Page 2 lists 9 products and shares none with page 1.
4. Filtering by brand narrows the total to that brand's products. Daybird has 10.
5. Filtering by brand and type together is an intersection. Daybird has no Climbing products, so the result is empty with a total of 0.
6. Each brand and type option has a count of the products it would give. The Daybird count equals the Daybird total, and the brand counts add up to the whole catalog.

## Driving it

```bash
pnpm mole doctor                                        # app up, API found, build fresh?
pnpm mole catalog list --surface web                    # page 1: total, page, items (id, name, price)
pnpm mole catalog list --page 2 --brand Daybird
pnpm mole catalog list --brand Daybird --type Climbing  # empty: total 0
pnpm mole catalog facets --brand Daybird                # option counts, evaluated within the filter
pnpm mole catalog list --page 2 --surface api           # the same call on the other surface
pnpm mole prove --feature catalog                       # every surface; add --surface api or web to run one
```

Both surfaces answer in the same shape, so compare them: the same call with `--surface web` and `--surface api` should print the same `total`, `page` and `items`. Default surface is `web`; the output says which ran.

Only on one surface:

- `web`: `pnpm mole page <n>`, `filter --brand NAME --type NAME --clear`, `snapshot`, `reload`, `reset`, `console --errors`, `network`, `screenshot`.
- `api`: `pnpm mole api get <path>` to look at the raw answer. It is for exploring; no proof depends on it.

## Web only

- The home page greets with a hero heading, and the grid fills in a moment after it.
- The page number lives in the address, and survives a reload with the same 9 products.
- Choosing a filter from a later page lands on page 1, and the choice is in the address.
- A filter with no matches shows an empty state that says so and offers to clear the filters. Clearing restores all 101 products.
- Sort reorders the cards on the current page only (name or price, either way), and the visitor's choice outlives a reload. Not proved: drive it yourself.

## Gotchas

- `[web]` The grid streams in after the first paint, and the first load after a cold start is slow. A total of 0 straight after `open` is not a finding: ask again.
- `[web]` The saved sort changes which card is first. If the order surprises you, run `pnpm mole reset`.
- `[web]` A PASS does not fail on `pageErrors`. After the user path, check `pnpm mole console --errors` is empty. The `product` proof opens an unknown id, so its 404 shows there too: expected.
- `[api]` The API is reached through the mobile-bff proxy, whose port Aspire picks at random. `up` finds it and `doctor` shows it. Set `ESHOP_API_URL` to the proxy URL if mole cannot find it.
- `[api]` The API is not at the same page numbers as the contract: it counts pages from 0 and defaults to 10 per page. mole hides that, so use `--page` from 1 on both surfaces. A raw `api get` does not hide it.
- `[api]` Filters are ids on the wire. mole takes names and looks the ids up.
- `[both]` The proof does not check Type filters alone, option counts under a filter, or sort: drive those yourself.
- `[both]` After editing `src/WebApp`, `src/WebAppComponents` or `src/Catalog.API`, restart the app (`pnpm mole down`, then `up`). Blazor does not hot-reload under mole, and `doctor` reports the build STALE until you do.
- `[both]` Anonymous visitor only. Signed-in behavior needs the `e2e/` credentials and is out of scope.
