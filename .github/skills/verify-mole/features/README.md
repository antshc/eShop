# Feature map

The features an agent can exercise, and how to prove each one. A map states a feature's behavior contract once, and one "Driving it" block runs the same commands on each surface: `web` (the storefront) or `api` (the catalog API behind it), chosen with `--surface`. Every row has a map file (named like its feature) and a proof in `proof/features/<feature>.ts` that checks the contract on every surface. `pnpm mole features --changed` lists the features your uncommitted changes touch. The loop is in [../SKILL.md](../SKILL.md).

| Feature | Surfaces | Launch / reach it | User path | Tool + proof | Stop / ask for help |
| --- | --- | --- | --- | --- | --- |
| [Catalog browsing](catalog.md) (list, pages, brand/type filters, counts; sort on web) | web, api | `pnpm mole up --start` (or `pnpm mole up` if the AppHost runs on :5045) → Chrome on `/` | Open `/` → page 2 or a filter → reload | `pnpm mole prove --feature catalog` (add `--surface web` or `--surface api` for one) → revision-bound receipt (Type filters and sort by hand) | STALE build or exit 2: restart the app and re-prove, or ask; same failure after two fixes: a human |
| [Product details](product.md) (name, price, description, not found; login action and Back on web) | web, api | Same app → click a card, or `pnpm mole product show "Adventurer GPS Watch"` | Card → detail → reload → Back to catalog | `pnpm mole prove --feature product` (add `--surface` for one; picture and zoom by hand); optional `pnpm mole judge` (card matches page, honest copy) | `judge` says ASK A HUMAN or exits 2: show a human the screenshot and the contract; same failure after two fixes: a human |

Before you report, run `pnpm mole prove` with no `--feature` and no `--surface`. A fix in one feature can break another, and a surface that did not run is not proved: the receipt lists `surfaces` and says when one was skipped.

Out of scope: the signed-in cart and checkout (they need the `e2e/` credentials).

## Add a feature

1. Write `features/<name>.md` with the frontmatter `feature`, `touches` (path prefixes), `surfaces` and `prove`. State the contract in prose, with no selectors, routes or storage keys.
2. Write `proof/features/<name>.ts`: contract checks through each surface's adapter in `proof/features/surfaces/`, and anything only one surface has in a clearly named block. Register it with the same `touches` and `surfaces` in `proof/features/index.ts`.
3. Add a row above. `pnpm test:proof` fails if the map, the registry and this table disagree.
