# Proof kit and mole

Drives the running eShop WebApp in a real Chromium like a visitor, reads the catalog API behind it, records facts, and writes a receipt with a verdict and a screenshot. It complements the Playwright tests in `e2e/`: those assert and stop at the first failure, while a proof records every fact and tells you what to fix.

## Run it

1. Install dependencies once from the repository root, and a browser if you have none: `pnpm install`, then `pnpm exec playwright install chromium`.
2. Start the app. It needs the .NET SDK from `global.json` and a container runtime.

    ```bash
    dotnet run --project src/eShop.AppHost/eShop.AppHost.csproj
    ```

3. Run the proof from the repository root.

    ```bash
    pnpm prove                                  # http://localhost:5045
    pnpm prove --url http://localhost:5045      # another WebApp URL
    ```

    `ESHOP_URL` sets the default URL. The API surface also needs the mobile-bff URL (see Surfaces); `pnpm prove` finds it with `aspire describe`, or set `ESHOP_API_URL`. `--surface web` proves the storefront alone.

## mole: drive the storefront like a user

`pnpm mole` is a remote control for agents and humans. It keeps one Chrome open on the storefront, lets you drive and inspect it command by command (JSON out, every error says what to do next), and runs the same proof as `pnpm prove` against that browser. Ported from the beyond-done lab.

```bash
pnpm mole up --start     # own terminal: runs the AppHost, waits for the storefront, opens Chrome
pnpm mole up             # or attach to an AppHost you already run on :5045 (--url for another)
pnpm mole doctor         # is this instance worth driving?
pnpm mole catalog list --page 2 --surface api   # shared feature commands: catalog list|facets, product show; --surface web|api
pnpm mole open /item/3   # web only: also page 2, filter --brand Daybird, reload, reset
pnpm mole snapshot       # what a user sees; also: storage, console --errors, network, screenshot, eval
pnpm mole prove          # every feature on every surface; --feature, --surface narrow it. Exit 0 PASS, 1 FAIL, 2 can't tell
pnpm mole down           # stop what up started
```

`pnpm mole help` lists every command; the agent loop is in [.github/skills/verify-mole/SKILL.md](../.github/skills/verify-mole/SKILL.md).

- `--start` runs `dotnet run --project src/eShop.AppHost/eShop.AppHost.csproj` with `ESHOP_USE_HTTP_ENDPOINTS=1`, so the WebApp is on `http://localhost:5045`. It needs a container runtime and the .NET SDK from `global.json`; mole finds it on `PATH`, in `DOTNET_ROOT`, or in `~/.dotnet`, so a user-level install needs no setup. The AppHost output goes to `proof/.runs/mole/apphost.log`. `down` stops the services; the AppHost keeps its persistent containers (RabbitMQ, Postgres) by design.
- **Surfaces.** A feature is a behavior contract that runs on a `--surface`: `web` (the storefront, in Chrome) or `api` (Catalog.API, over HTTP). Drive commands default to `web` and print which surface ran; `prove` with no `--surface` runs every one, and the receipt's `surfaces` lists what ran (a surface that did not run is not proved). `snapshot`, `console`, `network`, `screenshot`, `reset`, `filter` and `page` are web-only. `api get <path>` is for exploring and no proof uses it. Catalog.API is not exposed directly: it is reached through the `mobile-bff` proxy, whose port Aspire picks. `up` finds it with `aspire describe` (override with `ESHOP_API_URL`), records it in the session, and `doctor` checks it. The API counts pages from 0 and defaults to 10 per page; the API adapter hides that (pages from 1, 9 per page, names for ids).
- Driving is anonymous: the catalog, pagination, brand/type filters (eShop has no text search) and product pages.
- **Revision.** eShop serves none, so mole derives one: `git HEAD` plus a hash of uncommitted changes under `src/WebApp`, `src/WebAppComponents` and `src/Catalog.API` (for example `2bd2b7b+b6530753`). It is recorded when `up` starts the app. When the source moves past it, `doctor` reports the build STALE and `prove` refuses to run (exit 2): restart the app and `up` again. A receipt for an older revision is reported STALE too. `pnpm prove` records the current source revision but cannot know which build is running, so it only detects edits made during the proof.
- **judge** (optional) asks an LLM whether a product page agrees with its catalog card and makes no unsupported claims. It needs `TYPESAFE_API_KEY` (also read from `.env`) and `pnpm add -D @typesafe-ai/sdk`; without them it exits 2 with a human fallback. Nothing else depends on it.
- State (session, event log, receipts, screenshots) lives in `proof/.runs/mole/`, overridable with `MOLE_DIR`.

## Read the receipt

The receipt prints as JSON and is saved with a screenshot in `proof/.runs/` (git-ignored; `last-receipt.json` is the latest).

| Exit code | Verdict | Meaning |
|---|---|---|
| 0 | `PASS` | Every check passed. Read the screenshot too: the checks cover only what they check. |
| 1 | `FAIL` | At least one check failed. `next` lists the hint for each failed check. |
| 2 | `ERROR` | No evidence, such as the app not running or `prove()` throwing. This means "can't tell", not "broken". |

`pageErrors` lists console errors and uncaught exceptions. A `PASS` does not fail on them, so check that it is empty.

## What it checks

[prove.ts](prove.ts) runs every feature in [features/](features/) as a fresh anonymous visitor, in one browser context and one receipt. Check names start with the feature and the surface (`catalog/web:`, `product/api:`). Each feature has a map in [.github/skills/verify-mole/features/](../.github/skills/verify-mole/features/README.md).

- **catalog**, on web and api: the product list, 9 per page, the count (101), page 2 sharing nothing with page 1, the Daybird filter (10), a filter with no matches, and option counts. Web only: the hero heading, the page in the address and a reload, a filter dropping the page, the empty state, and Clear all filters.
- **product**, on web and api: the catalog entry opens its product with the same id and price, a description, and an unknown id is 404. Web only: the page's heading, "Log in to purchase", a reload, the not-found text, and Back to catalog keeping a filter.

Run one feature with `pnpm mole prove --feature catalog` and one surface with `--surface api` (also on `pnpm prove`). A receipt lists the features and surfaces it proved, `next` warns when one was skipped, and `doctor` says so when the last receipt is a subset. `pnpm mole features --changed` lists the features your uncommitted changes touch. `pnpm test:proof` checks that the maps, the registry in `features/index.ts` and the feature map index agree.

## Add a check

Edit the feature's file in `features/`. It receives `{ page, email, surfaces, apiUrl, check, storage }`:

```ts
check("name", actual, expected, "hint that tells an agent what to fix");
```

- Write a contract rule once, through the surface adapters in `features/surfaces/` (`adapterFor(surface, kit)`), and loop over `kit.surfaces`; name the check `feature/<surface>: ...`. Selectors, routes and wire details stay in the adapter. Put what only one surface has in a clearly named block for it. Wrap adapter calls in `observe()` so an unreachable surface is a failed check, not a crash.
- `check` never throws. A failed check is evidence, not a crash. Wait for the page with `expect(...)` or locators, never a timer.
- `page` is a fresh browser context (no cookies or storage) on the app's home page. Navigate with `new URL("/", page.url()).href`, because there is no `baseURL`. Features run one after another on the same page, so start each one with a navigation to a known place and prefix check names with the feature.
- `storage()` returns the app's localStorage. The eShop cart is server-side, so it is unused here.
- A signed-in proof (for example, the cart survives a reload) needs the credentials used by `e2e/login.setup.ts` (`USERNAME1` and `PASSWORD`).

## Files

| File | Purpose |
|---|---|
| `proof.ts` | The kit: `runProof()` launches a fresh context, runs `prove()`, collects checks and page errors, and builds the receipt. Copied from the beyond-done lab. |
| `mole.ts` | The `pnpm mole` CLI. |
| `app.ts` | Starts the AppHost for `up --start`, finds the API proxy URL, and derives the source revision. |
| `judge.ts` | The optional LLM judge. |
| `prove.ts` | Runs every feature's proof, or the ones `--feature` names. |
| `features/` | One proof per feature (`catalog.ts`, `product.ts`) and the registry (`index.ts`). |
| `features/surfaces/` | The surface adapters: `types.ts` (the shared shapes), `web.ts` (selectors and routes), `api.ts` (paging, ids, versions), `index.ts`. |
| `features.test.ts` | `pnpm test:proof`: keeps the maps, the registry and the index in step, and checks the adapters against fixture payloads. |
| `run.ts` | The command behind `pnpm prove`. |


# About the mole
## Product Purpose

Teach agents to verify their own work in 60 minutes, led jointly by Nick Nisi and Zack Proser. Attendees use an app-specific verification CLI (`pnpm snack`), write the proof that defines “done,” hand both to their own agent, and leave with a plan for the same lever in their own app.

## Brand Personality

Practical, playful, precise. Use WorkOS logo and branding, explicitly requested by Nick Nisi. The workshop site is reference material, not a marketing campaign.

## Anti-references

Do not retain Typed Void as the workshop identity. No fake model measurements or dashboards that obscure the one editable proof. The projected deck should be playful and visually expressive, with meaningful motion—not documentation pasted onto slides. See DESIGN.md.

## Design Principles

- One shared task throughout: a browser-local waitlist for a sold-out workshop.
- Distinguish observed facts (`prove`), semantic judgment (`judge`), and the stop rule.
- Evidence belongs to one revision; “can't tell” is never a pass.
- Show a useful next action, including checkpoints for attendees who fall behind.
- Make recorded runs and live calls unmistakable.

## Accessibility & Inclusion

Use semantic links, labelled form controls, visible keyboard focus, readable contrast, responsive text, and no motion-dependent content. Keep preflight outside the teaching hour, support pair work and a no-key path. No specific certification is claimed.

## User-facing checks

- Attendee can find the preflight, sequential lessons, glossary, slides and take-home worksheet.
- A new visitor can submit a test email in the local lab; the reference app preserves the email, status, and confirmation across reload.
- The shipped attendee app visibly loses the record on reload.
- Every `snack` error tells the reader what to run next.