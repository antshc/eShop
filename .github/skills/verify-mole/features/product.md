---
feature: product
touches:
  - src/WebApp/Components/Pages/Item/
  - src/WebApp/wwwroot/js/image-zoom.js
  - src/WebAppComponents/Item/
  - src/Catalog.API/
surfaces:
  - web
  - api
prove: pnpm mole prove --feature product
---

# Product details (eShop)

Opening a product from the catalog shows its name, brand, description and price. A visitor who is not signed in cannot buy. The same product is read on two surfaces: its page on the storefront (`web`) and the catalog API behind it (`api`).

Run every command from the repo root with `pnpm mole`. The loop in the [verify-mole skill](../SKILL.md) applies.

## Contract

These hold on every surface. `pnpm mole prove --feature product` checks each one per surface.

1. A product in the catalog opens by its name and shows that same name.
2. The product is the one the catalog entry points to: same id.
3. The product shows the same price as its catalog entry. Compare the exact numbers.
4. The product has a description. It is about the named product and claims nothing a storefront could not support, such as guaranteed delivery dates or medical effects (the contract in `proof/judge.ts`).
5. An id that does not exist is reported as not found with status 404.

## Driving it

```bash
pnpm mole doctor
pnpm mole product show "Adventurer GPS Watch"            # by catalog name (first catalog page on web), default surface web
pnpm mole product show 99 --surface api                  # by catalog id, on the other surface
pnpm mole product show 99999                             # unknown id: found false, status 404
pnpm mole prove --feature product                        # every surface; add --surface api or web to run one
pnpm mole judge                                          # optional LLM check of the web copy, needs TYPESAFE_API_KEY
```

Both surfaces answer in the same shape (`found`, `id`, `name`, `brand`, `price`, `description`), so compare them. Default surface is `web`; the output says which ran. `--raw` adds the page snapshot on `web`.

Only on one surface:

- `web`: `snapshot`, `reload`, `console --errors`, `screenshot`.
- `api`: `pnpm mole api get <path>` to look at the raw answer. It is for exploring; no proof depends on it.

## Web only

- The page is headed with the product's name and the brand is its subtitle. The picture opens a zoom dialog (opens from the picture, closes with its button, the backdrop or Escape). Not proved.
- A visitor who is not signed in sees **Log in to purchase**, not an add-to-bag button. Signed in, the action is **Add to shopping bag**.
- The page survives a reload with the same name and price.
- An unknown id tells the visitor, in words, that no such product exists.
- **Back to catalog** returns to the filtered or paged list the visitor came from. A deep link falls back to the home page.

## Gotchas

- `[web]` **Known failure** (seen on `127ac61` and `5da3651`): an unknown id answers 404 with an empty body, so the not-found text never reaches the visitor and `product/web: an unknown id says so` fails. The check is right and the page is wrong; do not weaken it. Fix the app, or record it as accepted before you call a full `prove` green. The 404 itself passes on both surfaces.
- `[web]` Back to catalog is read from where the visitor came from. `product show <id>` is a deep link, so Back goes home. To test it, click through from a filtered catalog (`filter --brand Daybird`, then open a card).
- `[web]` `judge` compares the first card in the current sort order. It needs `TYPESAFE_API_KEY` and `@typesafe-ai/sdk`. Exit 2 means "can't tell" or "ASK A HUMAN": take `pnpm mole screenshot` and the contract to a human. It never means pass.
- `[web]` A PASS does not fail on `pageErrors`. Check `pnpm mole console --errors` is empty.
- `[api]` By name, the API matches names that start with what you typed, and mole picks the exact one. Names are not unique in the catalog, so use the id when it matters.
- `[api]` A missing product answers 404 with a small problem document, not an empty body.
- `[both]` The price is formatted separately for each surface. mole compares numbers (199.99), not strings.
- `[both]` The proof does not check the picture or zoom, or the description's honesty (that is `judge`): drive those yourself.
- `[both]` After editing `src/WebApp`, `src/WebAppComponents` or `src/Catalog.API`, restart the app (`pnpm mole down`, then `up`) so the build is fresh.
- `[both]` Signed-in actions (add to bag, the in-cart note) need the `e2e/` credentials and are out of scope.
