---
feature: product
touches:
  - src/WebApp/Components/Pages/Item/
  - src/WebApp/wwwroot/js/image-zoom.js
  - src/WebAppComponents/Item/
  - src/Catalog.API/
prove: pnpm mole prove --feature product
---

# Product detail page (eShop)

Opening a product from the catalog shows its page at `/item/{id}`: name, brand, picture, description, price and a purchase action. An anonymous visitor cannot buy; the action sends them to log in. Server-rendered Blazor.

Run every command below from the repo root with `pnpm mole`. The loop in the [verify-mole skill](../SKILL.md) applies.

## Sub-features

- **Header:** the product name as the `h1`, with the brand as the subtitle.
- **Picture:** the image, and a zoom dialog (opens from the picture, closes with the button, the backdrop or Escape).
- **Description and price:** `.item-desc` and `.item-buy .price` (for example `$199.99`).
- **Action:** `.add-to-cart button`. Anonymous: **Log in to purchase**. Signed in: **Add to shopping bag**, and an "in your shopping bag" note once something is in the basket.
- **Back to catalog:** returns to the filtered or paged catalog the visitor came from. A deep link falls back to `/`.
- **Not found:** an unknown id returns 404 with "Sorry, we couldn't find any such product."

## How to get to it (user POV)

Open the storefront and click a product card, for example **Adventurer GPS Watch**. Its page opens. Click **Back to catalog**: the same filters and page are back.

## Driving it with mole

```bash
pnpm mole doctor
pnpm mole product "Adventurer GPS Watch"  # by card name (first page), or: pnpm mole product 99
pnpm mole snapshot                        # product: name, price, description, action
pnpm mole reload
pnpm mole open /item/99999                # the not-found page
pnpm mole console --errors
pnpm mole prove --feature product         # this feature only; run pnpm mole prove (all) before you report
pnpm mole judge                           # optional LLM check, needs TYPESAFE_API_KEY
```

Handles: `h1` with the product name, `.item-details`, `.item-desc`, `.item-buy .price`, `.add-to-cart button`, `a.item-back`.

## What done means

1. The product link opens a page whose heading is the product's name (`prove`).
2. The page shows the same name and the same price as its catalog card.
3. The description is about the named product and makes no claim a storefront could not support, such as guaranteed delivery dates or medical effects. This is the contract in `proof/judge.ts`.
4. An anonymous visitor sees **Log in to purchase**, not an add-to-bag button.
5. The page survives a reload, and an unknown id shows the not-found text with a 404.
6. **Back to catalog** returns to the same filtered or paged list.

## Gotchas

- The price is formatted separately on the card and on the page. Compare the exact strings from `snapshot`, not "a price is shown".
- **Known failure** (seen on `127ac61`): `/item/99999` answers 404 with an empty body (`Content-Length: 0`), so the not-found text in `ItemPage.razor` never reaches the visitor and `product: an unknown id says so` fails. The check is right and the page is wrong; do not weaken the check. Fix the app, or record it as accepted before you call a full `prove` green.
- `prove --feature product` covers the heading, the card's price on the page, a description, "Log in to purchase", a reload, the 404 and not-found text, and Back to catalog keeping a brand filter. It does not check the picture or zoom, the description's honesty (that is `judge`), or Back from a paged list: drive those yourself.
- Back to catalog is read from the Referer. Reaching the page with `product <id>` or `open /item/N` is a deep link, so Back goes to `/`. To test it, click through from a filtered catalog (`filter --brand Daybird`, then `product "<name>"`).
- `judge` compares the first card in the current sort order. It needs `TYPESAFE_API_KEY` and `@typesafe-ai/sdk`. Exit 2 means "can't tell" or "ASK A HUMAN": take `pnpm mole screenshot` and the contract to a human. It never means pass.
- The picture and zoom dialog are not covered by any check. Look at the screenshot.
- A PASS does not fail on `pageErrors`. Check `pnpm mole console --errors` is empty.
- After editing `src/WebApp` or `src/WebAppComponents`, restart the app (`pnpm mole down`, then `up`) so the build is fresh.
- Signed-in actions (add to bag, the in-cart note) need the `e2e/` credentials and are out of scope.
