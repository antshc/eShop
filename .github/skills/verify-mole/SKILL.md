---
name: verify-mole
description: Drive and prove the eShop storefront (src/WebApp) in a real Chrome over CDP with the mole CLI. Use to reproduce a storefront bug, verify a change to src/WebApp or src/WebAppComponents, or show proof that it works.
---

# Verify the storefront

`pnpm mole` drives the running WebApp in a real Chrome through the DevTools protocol. Commands print JSON on stdout; errors say what to do next. `pnpm mole help` lists every command. Details: [proof/README.md](../../../proof/README.md).

## The loop

1. **Doctor.** Run `pnpm mole doctor`. Done when `ok` is true. Nothing running: start it and leave it running with `pnpm mole up --start` (the AppHost needs the .NET SDK from `global.json` and a container runtime; in the background if no human is watching). If the AppHost already runs on :5045, attach with `pnpm mole up`. Build STALE: the source moved past the running build, so `pnpm mole down` and `up` again.
2. **Reproduce.** Drive the user path (`open`, `page`, `product`, `filter`, `reload`) and look (`snapshot`, `console`, `network`). Done when you can name the observation that is wrong, such as "page 2 lists 8 products after reload".
3. **Fix** `src/WebApp` or `src/WebAppComponents`, then restart the app (Blazor does not hot-reload under mole) so the build is fresh.
4. **Prove.** Run `pnpm mole prove`. Done when the verdict is PASS for the current revision. FAIL lists what to fix. Exit 2 means the evidence is missing, so fix the environment, not the app.
5. **Read the screenshot** named in the receipt, and check `pageErrors` is empty: a PASS does not fail on them. For product-page copy, `pnpm mole judge` is optional (needs `TYPESAFE_API_KEY` and `@typesafe-ai/sdk`).
6. **Report** the receipt: verdict, revision, checks, screenshot path, and judge result if any.

## Proof bar

- Exercise the user path in the browser. Use `eval` only to read state after the path ran.
- The revision is `git HEAD` plus a hash of uncommitted changes under `src/WebApp` and `src/WebAppComponents`. Evidence belongs to one revision; after any edit the old receipt proves nothing, and `doctor` reports it as STALE.
- `proof/prove.ts` and `proof/proof.ts` define done. If one looks wrong, report it and stop.
- Anonymous visitor only. The signed-in cart needs the `e2e/` credentials and is out of scope here.

## When to stop

- PASS for the current revision and the screenshot read: done.
- The same check still fails after two fixes: stop and hand a human the receipt and what you tried.
- `doctor` red or `prove` exit 2: fix the environment or ask. Missing evidence is "can't tell", never "probably fine".

Stop only what you started: `pnpm mole down` (it also stops an AppHost that `--start` ran). Receipts and screenshots stay in `proof/.runs/mole/`.
