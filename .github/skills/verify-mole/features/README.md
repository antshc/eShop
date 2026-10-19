# Feature map

The features an agent can exercise on the storefront, and how to prove each one. Every row has a map file (named like its feature) and a proof in `proof/features/<feature>.ts`. `pnpm mole features --changed` lists the features your uncommitted changes touch. The loop is in [../SKILL.md](../SKILL.md).

| Feature | Launch / reach it | User path | Tool + proof | Stop / ask for help |
| --- | --- | --- | --- | --- |
| [Catalog browsing](catalog.md) (grid, pagination, brand/type filters, sort) | `pnpm mole up --start` (or `pnpm mole up` if the AppHost runs on :5045) → Chrome on `/` | Open `/` → page 2 or a filter → reload | `pnpm mole prove --feature catalog` → revision-bound receipt (Type filters and sort by hand with `filter`, `snapshot`) | STALE build or exit 2: restart the app and re-prove, or ask; same failure after two fixes: a human |
| [Product detail page](product.md) (name, price, description, login action, Back, not found) | Same app → click a card, or `pnpm mole product "Adventurer GPS Watch"` | Card → detail → reload → Back to catalog | `pnpm mole prove --feature product` (picture and zoom by hand); optional `pnpm mole judge` (card matches page, honest copy) | `judge` says ASK A HUMAN or exits 2: show a human the screenshot and the contract; same failure after two fixes: a human |

Before you report, run `pnpm mole prove` with no `--feature`. A fix in one feature can break another, and a receipt for one feature says so and is not a full proof.

Out of scope: the signed-in cart and checkout (they need the `e2e/` credentials).

## Add a feature

1. Write `features/<name>.md` with the frontmatter `feature`, `touches` (path prefixes) and `prove`.
2. Write `proof/features/<name>.ts` and register it with the same `touches` in `proof/features/index.ts`.
3. Add a row above. `pnpm test:proof` fails if the map, the registry and this table disagree.
