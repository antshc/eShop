# Proof kit and mole

Drives the running eShop WebApp in a real Chromium like a visitor, records facts, and writes a receipt with a verdict and a screenshot. It complements the Playwright tests in `e2e/`: those assert and stop at the first failure, while a proof records every fact and tells you what to fix.

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

    `ESHOP_URL` sets the default URL.

## mole: drive the storefront like a user

`pnpm mole` is a remote control for agents and humans. It keeps one Chrome open on the storefront, lets you drive and inspect it command by command (JSON out, every error says what to do next), and runs the same proof as `pnpm prove` against that browser. Ported from the beyond-done lab.

```bash
pnpm mole up --start     # own terminal: runs the AppHost, waits for the storefront, opens Chrome
pnpm mole up             # or attach to an AppHost you already run on :5045 (--url for another)
pnpm mole doctor         # is this instance worth driving?
pnpm mole open /item/3   # also: page 2, product "Adventurer GPS Watch", filter --brand Daybird, reload, reset
pnpm mole snapshot       # what a user sees; also: storage, console --errors, network, screenshot, eval
pnpm mole prove          # exit 0 PASS, 1 FAIL, 2 can't tell
pnpm mole down           # stop what up started
```

`pnpm mole help` lists every command; the agent loop is in [.github/skills/verify-mole/SKILL.md](../.github/skills/verify-mole/SKILL.md).

- `--start` runs `dotnet run --project src/eShop.AppHost/eShop.AppHost.csproj` with `ESHOP_USE_HTTP_ENDPOINTS=1`, so the WebApp is on `http://localhost:5045`. It needs a container runtime and the .NET SDK from `global.json`; mole finds it on `PATH`, in `DOTNET_ROOT`, or in `~/.dotnet`, so a user-level install needs no setup. The AppHost output goes to `proof/.runs/mole/apphost.log`. `down` stops the services; the AppHost keeps its persistent containers (RabbitMQ, Postgres) by design.
- Driving is anonymous: the catalog, pagination, brand/type filters (eShop has no text search) and product pages.
- **Revision.** eShop serves none, so mole derives one: `git HEAD` plus a hash of uncommitted changes under `src/WebApp` and `src/WebAppComponents` (for example `2bd2b7b+b6530753`). It is recorded when `up` starts the app. When the source moves past it, `doctor` reports the build STALE and `prove` refuses to run (exit 2): restart the app and `up` again. A receipt for an older revision is reported STALE too. `pnpm prove` records the current source revision but cannot know which build is running, so it only detects edits made during the proof.
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

[prove.ts](prove.ts) runs every feature in [features/](features/) as a fresh anonymous visitor, in one browser context and one receipt. Check names start with the feature (`catalog:`, `product:`). Each feature has a map in [.github/skills/verify-mole/features/](../.github/skills/verify-mole/features/README.md).

- **catalog:** the hero heading, the product list and its count (101), page 2 (9 products) and a reload, the Daybird filter (10 products, page dropped), the empty state, and Clear all filters.
- **product:** the card opens a page headed with its name, the page shows the card's price and a description, an anonymous visitor sees "Log in to purchase", a reload, an unknown id (404 and not-found text), and Back to catalog keeping a filter.

Run one feature with `pnpm mole prove --feature catalog` (or `pnpm prove --feature catalog`). A receipt lists the features it proved, and `doctor` says so when that is a subset. `pnpm mole features --changed` lists the features your uncommitted changes touch. `pnpm test:proof` checks that the maps, the registry in `features/index.ts` and the feature map index agree.

## Add a check

Edit the feature's file in `features/`. It receives `{ page, email, check, storage }`:

```ts
check("name", actual, expected, "hint that tells an agent what to fix");
```

- `check` never throws. A failed check is evidence, not a crash. Wait for the page with `expect(...)` or locators, never a timer.
- `page` is a fresh browser context (no cookies or storage) on the app's home page. Navigate with `new URL("/", page.url()).href`, because there is no `baseURL`. Features run one after another on the same page, so start each one with a navigation to a known place and prefix check names with the feature.
- `storage()` returns the app's localStorage. The eShop cart is server-side, so it is unused here.
- A signed-in proof (for example, the cart survives a reload) needs the credentials used by `e2e/login.setup.ts` (`USERNAME1` and `PASSWORD`).

## Files

| File | Purpose |
|---|---|
| `proof.ts` | The kit: `runProof()` launches a fresh context, runs `prove()`, collects checks and page errors, and builds the receipt. Copied from the beyond-done lab. |
| `mole.ts` | The `pnpm mole` CLI. |
| `app.ts` | Starts the AppHost for `up --start`, and derives the source revision. |
| `judge.ts` | The optional LLM judge. |
| `prove.ts` | Runs every feature's proof, or the ones `--feature` names. |
| `features/` | One proof per feature (`catalog.ts`, `product.ts`), the registry (`index.ts`) and shared helpers. |
| `features.test.ts` | `pnpm test:proof`: keeps the maps, the registry and the index in step. |
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