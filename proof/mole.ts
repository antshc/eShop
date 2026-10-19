// mole: a remote control for the eShop storefront, built for agents.
// One small CLI that launches, drives, inspects, and proves the app over the
// Chrome DevTools Protocol. JSON out; every error says what to do next.
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { DEFAULT_URL, ROOT, apiUrlFromAspire, dotnetEnv, reachable, sourceRevision, startApp, type StartedApp } from "./app";
import { JudgeUnavailable, judge } from "./judge";
import { readStorage, runProof, type Receipt } from "./proof";
import { FEATURES, featureNames, featuresFor, proveFeatures, selectFeatures, surfacesFor } from "./prove";
import { CATALOG_PATH, SURFACES, SurfaceError, apiSurface, isSurface, webSurface, type Surface, type SurfaceAdapter } from "./features/surfaces";

// MOLE_DIR isolates a second instance (tests, a parallel checkout) from the default one.
const DIR = process.env.MOLE_DIR ?? join(__dirname, ".runs", "mole");
const SESSION = join(DIR, "session.json");
const EVENTS = join(DIR, "events.jsonl");
const RECEIPT = join(DIR, "receipt.json");
const PROFILE = join(DIR, "profile");
const LOCK = join(DIR, "up.lock");
const APPHOST_LOG = join(DIR, "apphost.log");

const COMMANDS = {
  up: ["Health", "up [--url URL] [--start] [--headless]", "Open a Chrome you can drive on the storefront and find the catalog API. --start also runs the Aspire AppHost. Leave it running in its own terminal."],
  down: ["Health", "down", "Stop what up started (Chrome, and the AppHost if --start)."],
  doctor: ["Health", "doctor", "Is this instance worth driving? Tools, session, storefront, catalog API, loaded build, last proof."],
  catalog: ["Drive", "catalog list|facets [--page N] [--brand NAME] [--type NAME] [--surface web|api] [--raw]", "The catalog on a surface: products with total and page, or option counts. Default surface: web. Pages count from 1."],
  open: ["Drive", "open [path]", "Go to a storefront path, like /item/1. Default: the home page."],
  page: ["Drive", "page <n>", "Click page n in the catalog pagination."],
  product: ["Drive", "product [show] <name|id> [--surface web|api] [--raw]", "A product by its catalog name or id, on a surface. Default surface: web, where it opens the page."],
  api: ["Look", "api get <path>", "Exploration only: GET a path on the API proxy (mobile-bff) and show the answer. No proof depends on it."],
  filter: ["Drive", "filter [--brand NAME] [--type NAME] [--clear]", "Click catalog filter tags (eShop has no text search)."],
  reload: ["Drive", "reload", "Reload the page, like a user."],
  reset: ["Drive", "reset [--dry-run]", "Clear cookies and the app's storage and reload: a fresh visitor."],
  snapshot: ["Look", "snapshot", "What a user sees: heading, catalog or product details, accessibility tree."],
  storage: ["Look", "storage", "The app's localStorage and cookie names, read through the DevTools protocol."],
  console: ["Look", "console [--errors]", "Console messages and uncaught errors since up."],
  network: ["Look", "network", "Responses and failed requests since up."],
  screenshot: ["Look", "screenshot [path]", "Save a full-page screenshot."],
  eval: ["Look", "eval <expression>", "Read page state after the user path ran. Not for calling app internals."],
  features: ["Prove", "features [--changed]", "List the features and their maps. --changed: only those your uncommitted changes touch."],
  prove: ["Prove", "prove [--feature NAME] [--surface web|api]", "Fresh visitor, proof/features/, a receipt. Exit 0 PASS, 1 FAIL, 2 can't tell. No flag runs every feature on every surface."],
  judge: ["Prove", "judge", "Optional: ask an LLM whether a product page is consistent and honest. Needs TYPESAFE_API_KEY."],
} as const;
type Command = keyof typeof COMMANDS;

class MoleError extends Error {
  constructor(message: string, readonly next: string, readonly code = 2) { super(message); }
}
const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Session = { pid: number; appUrl: string; apiUrl: string | null; cdpUrl: string; startedApp: boolean; builtRevision: string | null; headless: boolean; startedAt: string };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// A live pid alone could be a reused one: on Linux, check that it is a mole process.
const isMole = (pid: number) => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("mole"); } catch { return process.platform !== "linux"; }
};

async function readSession(): Promise<Session> {
  let session: Session;
  try { session = JSON.parse(await readFile(SESSION, "utf8")); } catch {
    throw new MoleError("Nothing is running.", "Start it in its own terminal and leave it running: pnpm mole up (add --start to run the AppHost)");
  }
  if (!alive(session.pid) || !isMole(session.pid)) {
    await rm(SESSION, { force: true });
    throw new MoleError("The browser from the last `up` is no longer running.", "Start it again: pnpm mole up");
  }
  return session;
}

// Attach to the browser that `up` launched, do one thing, and detach.
async function withPage<T>(fn: (page: Page, browser: Browser, session: Session) => Promise<T>): Promise<T> {
  const session = await readSession();
  const browser = await chromium.connectOverCDP(session.cdpUrl).catch(() => {
    throw new MoleError(`Can't reach Chrome at ${session.cdpUrl}.`, "Stop up (Ctrl+C or pnpm mole down), then start it again.");
  });
  try {
    const context = browser.contexts()[0];
    let page = context.pages().find(p => p.url().startsWith(session.appUrl)) ?? context.pages()[0];
    if (!page) page = await context.newPage();
    if (!page.url().startsWith(session.appUrl)) await page.goto(session.appUrl);
    page.setDefaultTimeout(5000);
    return await fn(page, browser, session);
  } finally {
    await browser.close(); // Over CDP this disconnects; up keeps the browser alive.
  }
}

async function textOf(locator: ReturnType<Page["locator"]>) {
  return (await locator.count()) ? (await locator.first().innerText()).trim() : null;
}

async function products(page: Page) {
  return page.locator(".catalog-product").evaluateAll(items => items.map(item => ({
    name: item.querySelector(".name")?.textContent?.trim() ?? "",
    price: item.querySelector(".price")?.textContent?.trim() ?? "",
    href: item.getAttribute("href"),
  })));
}

async function snapshot(page: Page) {
  const base = {
    url: page.url(),
    title: await page.title(),
    revision: await sourceRevision(),
    heading: await textOf(page.getByRole("heading", { level: 1 })),
  };
  const onItem = /\/item\/\d+/.test(new URL(page.url()).pathname);
  const view = onItem
    ? { product: {
        name: await textOf(page.getByRole("heading", { level: 1 })),
        price: await textOf(page.locator(".item-buy .price")),
        description: await textOf(page.locator(".item-desc")),
        action: await textOf(page.locator(".add-to-cart button")),
      } }
    : { count: await textOf(page.locator(".catalog-count")), page: Number(new URL(page.url()).searchParams.get("page") ?? 1), products: await products(page) };
  return { ...base, ...view, aria: await page.locator("main").ariaSnapshot({ timeout: 1500 }).catch(() => null) };
}

// Blazor streams the catalog in after the first paint, so wait for products, an empty result, or an item.
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.locator(".catalog-product, .catalog-empty, .item-details").first().waitFor({ timeout: 5000 }).catch(() => {});
}

async function readEvents(types: string[]) {
  const text = existsSync(EVENTS) ? await readFile(EVENTS, "utf8") : "";
  return text.split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => types.includes(event.type));
}

// Held from before up touches the profile and event log until it exits, so two ups can't share them.
async function claimUp() {
  await mkdir(DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await writeFile(LOCK, String(process.pid), { flag: "wx" }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = Number(await readFile(LOCK, "utf8").catch(() => ""));
    if (owner && alive(owner) && isMole(owner)) break;
    await rm(LOCK, { force: true }); // Left by an up that was killed.
  }
  throw new MoleError("Another up is already starting or running here.", "Use it, or stop it first: pnpm mole down");
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function apiAnswers(url: string) {
  try { await apiSurface(url).catalog.list({}); return true; } catch { return false; }
}

// The proxy comes up after the storefront, so when mole started the AppHost give it a minute. Not finding it is not fatal: web still works.
async function findApi(patient: boolean): Promise<string | null> {
  const deadline = Date.now() + (patient ? 60_000 : 0);
  for (;;) {
    const url = apiUrlFromAspire();
    if (url && await apiAnswers(url)) return url;
    if (!url && !patient) return null;
    if (Date.now() >= deadline) return null;
    await sleep(2000);
  }
}

// Where the catalog API answers: what `up` recorded, or look again (the AppHost may have been started after mole).
async function apiUrlOf(session: Session) {
  const url = session.apiUrl ?? await findApi(false);
  if (!url) throw new MoleError("The catalog API was not found. It is reached through the mobile-bff proxy, and Aspire picks its port.",
    "Run the AppHost, then: pnpm mole down; pnpm mole up. Or set ESHOP_API_URL to the mobile-bff URL (see pnpm mole doctor).");
  return url;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port")));
    });
  });
}

async function up(options: { url: string; start: boolean; headless: boolean }) {
  const existing = await readSession().catch(() => null);
  if (existing) throw new MoleError(`Already running at ${existing.appUrl} (pid ${existing.pid}).`, "Use it, or stop it first: pnpm mole down");
  const running = await reachable(options.url);
  if (options.start && running) throw new MoleError(`Something already answers at ${options.url}, so --start would collide with it.`,
    "Attach to it: pnpm mole up (without --start), or stop it first.");
  if (!options.start && !running) throw new MoleError(`No storefront answers at ${options.url}.`,
    "Run the AppHost yourself (dotnet run --project src/eShop.AppHost/eShop.AppHost.csproj), or let mole do it: pnpm mole up --start");
  if (options.start) {
    try { dotnetEnv(); } catch (error) {
      throw new MoleError((error as Error).message, "Install it, or point DOTNET_ROOT at the folder that has it, then: pnpm mole up --start");
    }
  }
  await claimUp();
  const opened: { close(): Promise<unknown> }[] = [];
  try {
    await rm(PROFILE, { recursive: true, force: true });
    await writeFile(EVENTS, "");
    let app: StartedApp | undefined;
    if (options.start) {
      console.error("Starting the AppHost; the first start restores packages and pulls containers, so it can take minutes...");
      app = await startApp({ url: options.url, log: APPHOST_LOG });
      opened.push(app);
    }
    const builtRevision = await sourceRevision();
    const apiUrl = await findApi(options.start);
    const port = await freePort();
    const headless = options.headless || Boolean(process.env.CI) || (process.platform === "linux" && !process.env.DISPLAY);
    const context = await chromium.launchPersistentContext(PROFILE, {
      headless, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, args: [`--remote-debugging-port=${port}`],
    });
    opened.unshift(context);
    const log = (event: Record<string, unknown>) =>
      appendFile(EVENTS, JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n").catch(() => {});
    const watch = (page: Page) => {
      page.on("console", message => log({ type: "console", level: message.type(), text: message.text() }));
      page.on("pageerror", error => log({ type: "pageerror", level: "error", text: error.message }));
      page.on("load", () => log({ type: "load", url: page.url() }));
      page.on("response", response => log({ type: "response", method: response.request().method(), status: response.status(), url: response.url() }));
      page.on("requestfailed", request => log({ type: "requestfailed", method: request.method(), url: request.url(), text: request.failure()?.errorText }));
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(options.url);
    const session: Session = { pid: process.pid, appUrl: options.url, apiUrl, cdpUrl: `http://127.0.0.1:${port}`, startedApp: Boolean(app), builtRevision, headless, startedAt: new Date().toISOString() };
    await writeFile(SESSION, JSON.stringify(session, null, 2));
    out({ ok: true, ...session, ...(app ? { appHostLog: APPHOST_LOG } : {}),
      next: apiUrl ? "Leave this running. In another terminal: pnpm mole doctor"
        : "Leave this running. The catalog API was not found, so only the web surface works: see pnpm mole doctor" });

    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await rm(SESSION, { force: true });
      await context.close().catch(() => {});
      await app?.close().catch(() => {});
      await rm(LOCK, { force: true });
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    context.on("close", stop); // Someone closed the browser window.
  } catch (error) {
    // A failed start must not leave the AppHost holding the process open.
    for (const resource of opened) await resource.close().catch(() => {});
    await rm(LOCK, { force: true });
    throw error;
  }
  await new Promise(() => {});
}

async function down() {
  const session = await readSession();
  process.kill(session.pid, "SIGTERM");
  // Stopping the AppHost shuts the services down gracefully, which takes a while.
  for (let i = 0; i < 400 && alive(session.pid); i++) await new Promise(resolve => setTimeout(resolve, 100));
  out({ ok: !alive(session.pid), stopped: session.pid, next: "Start again with: pnpm mole up" });
}

async function doctor() {
  const checks: { name: string; ok: boolean; detail: string; next?: string }[] = [];
  const node = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: node >= 20, detail: process.version, ...(node < 20 ? { next: "Install Node 20 or newer" } : {}) });
  const browserInstalled = existsSync(chromium.executablePath());
  checks.push({ name: "chromium", ok: browserInstalled, detail: browserInstalled ? "installed" : "missing", ...(!browserInstalled ? { next: "pnpm exec playwright install chromium" } : {}) });
  let proof: { status: string; next?: string } = { status: "unknown: nothing running" };
  const session = await readSession().catch((error: MoleError) => {
    checks.push({ name: "session", ok: false, detail: error.message, next: error.next });
    return null;
  });
  if (session) {
    checks.push({ name: "session", ok: true, detail: `${session.startedApp ? "AppHost started by mole" : "attached"} at ${session.appUrl}, pid ${session.pid}` });
    const answering = await reachable(session.appUrl);
    checks.push({ name: "storefront", ok: answering, detail: answering ? "answers" : `no answer at ${session.appUrl}`,
      ...(!answering ? { next: "Start the AppHost, then: pnpm mole down; pnpm mole up (or pnpm mole up --start)" } : {}) });
    const apiUrl = session.apiUrl ?? await findApi(false);
    const apiOk = apiUrl !== null && await apiAnswers(apiUrl);
    checks.push({ name: "api", ok: apiOk, detail: apiOk ? `the catalog API answers at ${apiUrl}${CATALOG_PATH}` : apiUrl ? `no answer from ${apiUrl}` : "the mobile-bff proxy was not found",
      ...(!apiOk ? { next: "Start the AppHost, then: pnpm mole down; pnpm mole up. Or set ESHOP_API_URL to the mobile-bff URL. Without it only --surface web can be proved." } : {}) });
    const source = await sourceRevision();
    const fresh = source !== null && source === session.builtRevision;
    checks.push({ name: "build", ok: fresh,
      detail: fresh ? `the running build matches the source (${source})` : `STALE: the app was started on ${session.builtRevision}, the source is now ${source}`,
      ...(!fresh ? { next: session.startedApp ? "pnpm mole down; pnpm mole up --start" : "Restart the AppHost, then: pnpm mole down; pnpm mole up" } : {}) });
    const receipt: Receipt | null = existsSync(RECEIPT) ? JSON.parse(await readFile(RECEIPT, "utf8")) : null;
    proof = !receipt ? { status: "none yet", next: "pnpm mole prove" }
      : receipt.revision !== source ? { status: `STALE: the last receipt says ${receipt.verdict} for ${receipt.revision}, but the source is now ${source}. That proof is for code that no longer exists.`, next: "pnpm mole prove" }
      : { status: `${receipt.verdict} for the current source (${source}) at ${receipt.at}${receipt.features && receipt.features.length < featureNames().length ? `, only ${receipt.features.join(", ")}: run pnpm mole prove for all` : ""}${receipt.surfaces && receipt.surfaces.length < SURFACES.length ? `, only the ${receipt.surfaces.join(", ")} surface: run pnpm mole prove with no --surface` : ""}`, ...(receipt.verdict !== "PASS" ? { next: receipt.next[0] } : {}) };
  }
  const ok = checks.every(check => check.ok);
  out({ ok, checks, proof });
  if (!ok) process.exitCode = 1;
}

async function prove(features: string[], surfaceNames: string[]) {
  let selected: string[];
  let surfaces: Surface[];
  try {
    selected = selectFeatures(features);
    surfaces = surfacesFor(selected, surfaceNames);
  } catch (error) {
    throw new MoleError((error as Error).message, "See the features: pnpm mole features. The surfaces are: " + SURFACES.join(", "));
  }
  const receipt = await withPage(async (_page, browser, session) => {
    const apiUrl = surfaces.includes("api") ? await apiUrlOf(session) : null;
    const source = await sourceRevision();
    if (source !== session.builtRevision) throw new MoleError(
      `The running build was started on ${session.builtRevision} but the source is now ${source}. A proof would describe code that is not running.`,
      session.startedApp ? "Restart it: pnpm mole down; pnpm mole up --start" : "Restart the AppHost, then: pnpm mole down; pnpm mole up");
    // One screenshot per run, so each saved receipt keeps the image it was proved with.
    return runProof(browser, session.appUrl, proveFeatures(selected), join(DIR, `proof-${source}-${Date.now()}.png`), sourceRevision, { surfaces, apiUrl });
  });
  receipt.features = selected;
  receipt.surfaces = surfaces;
  if (selected.length < featureNames().length) receipt.next.push(`Only ${selected.join(", ")} was proved. Run pnpm mole prove with no --feature before you report.`);
  const skipped = SURFACES.filter(surface => !surfaces.includes(surface) && selected.some(name => FEATURES[name].surfaces.includes(surface)));
  if (skipped.length) receipt.next.push(`The ${skipped.join(", ")} surface did not run, so it is not proved. Run pnpm mole prove with no --surface before you report.`);
  const json = JSON.stringify(receipt, null, 2);
  await writeFile(RECEIPT, json); // latest, for doctor
  // Append, never overwrite: failures stay in the history next to the final green.
  await mkdir(join(DIR, "receipts"), { recursive: true });
  await writeFile(join(DIR, "receipts", `${receipt.at.replace(/[:.]/g, "-")}-${receipt.revision ?? "unknown"}.json`), json);
  out(receipt);
  process.exitCode = receipt.verdict === "PASS" ? 0 : receipt.verdict === "FAIL" ? 1 : 2;
}

// Which features need proving: all of them, or those whose files your uncommitted changes touch.
function listFeatures(changed: boolean) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const files = changed ? [...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")] : [];
  const names = changed ? featuresFor(files) : featureNames();
  out({
    ...(changed ? { changedFiles: files.length } : {}),
    features: names.map(name => ({ name, surfaces: FEATURES[name].surfaces, map: `.github/skills/verify-mole/features/${name}.md`, prove: `pnpm mole prove --feature ${name}` })),
    next: !changed ? "Open the map of the feature you are touching, then: pnpm mole prove --feature <name>"
      : names.length ? `Prove each, then run pnpm mole prove with no --feature once before you report.` : "No feature's files changed. Run pnpm mole prove if you still need proof.",
  });
}

async function judgeProduct() {
  const human = "judge it as a human: pnpm mole screenshot, then compare the product page to the contract in proof/judge.ts";
  if (!process.env.TYPESAFE_API_KEY) throw new MoleError("No TYPESAFE_API_KEY, so there is no judge. Judging is optional.", `Or ${human}`);
  const gathered = await withPage(async (_page, browser, session) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(session.appUrl);
      await settle(page);
      const [card] = await products(page);
      if (!card?.href) throw new MoleError("The catalog shows no products to judge.", "See what is there: pnpm mole snapshot");
      await page.locator(".catalog-product").first().click();
      await page.locator(".item-details").waitFor();
      return {
        revision: await sourceRevision(),
        evidence: {
          card: { name: card.name, price: card.price },
          page: {
            name: (await textOf(page.getByRole("heading", { level: 1 }))) ?? "",
            price: (await textOf(page.locator(".item-buy .price"))) ?? "",
            description: (await textOf(page.locator(".item-desc"))) ?? "",
          },
        },
      };
    } finally { await context.close(); }
  });
  if (await sourceRevision() !== gathered.revision) throw new MoleError(
    `The source changed while judging (started on ${gathered.revision}). Copy from two builds proves neither: that's "can't tell".`,
    "Run it again once the files stop changing: pnpm mole judge");
  let judgment;
  try { judgment = await judge(gathered.evidence); } catch (error) {
    if (error instanceof JudgeUnavailable) throw new MoleError(`${error.message}, so there is no judge. Judging is optional.`,
      (error.message.includes("sdk") ? "pnpm add -D @typesafe-ai/sdk, or " : "Or ") + human);
    throw new MoleError(`The judge didn't answer (${error instanceof Error ? error.message : "unknown error"}). That's "can't tell", not a pass or a fail.`,
      `Check the key, quota and network, or ${human}`);
  }
  out({ revision: gathered.revision, evidence: gathered.evidence, ...judgment });
  process.exitCode = judgment.verdict === "PASS" ? 0 : judgment.verdict === "FAIL" ? 1 : 2;
}

// The surface a drive command runs on: web unless told otherwise, and the answer says which.
function oneSurface(names: string[] | undefined): Surface {
  if ((names?.length ?? 0) > 1) throw new MoleError("Give one --surface.", `One of: ${SURFACES.join(", ")}. To run all of them: pnpm mole prove`);
  const name = names?.[0] ?? "web";
  if (!isSurface(name)) throw new MoleError(`Unknown surface "${name}".`, `Use one of: ${SURFACES.join(", ")}`);
  return name;
}

async function driveOn<T extends object>(values: { surface?: string[] }, fn: (adapter: SurfaceAdapter, page?: Page) => Promise<T>) {
  const surface = oneSurface(values.surface);
  try {
    const result = surface === "api"
      ? await fn(apiSurface(await apiUrlOf(await readSession())))
      : await withPage(page => fn(webSurface(page), page));
    const other = SURFACES.find(name => name !== surface);
    return { ...result, next: `The same call on the ${other} surface: add --surface ${other}` };
  } catch (error) {
    if (error instanceof SurfaceError) throw new MoleError(error.message, error.next);
    throw error;
  }
}

async function rawFor(surface: Surface, page?: Page) {
  if (surface === "web" && page) return snapshot(page);
  throw new MoleError("--raw is only for the web surface, where it adds the page snapshot.", `For the API's own answer: pnpm mole api get "${CATALOG_PATH}/items?api-version=2.0&pageIndex=0&pageSize=9"`);
}

const filterGroup = (page: Page, group: string) =>
  page.locator(".catalog-search-group", { has: page.getByRole("heading", { name: group, exact: true }) });

async function clickTag(page: Page, group: string, name: string) {
  const tag = filterGroup(page, group).locator(".catalog-search-tag", { has: page.locator("span", { hasText: new RegExp(`^${escapeRegExp(name)}$`, "i") }) });
  if (!(await tag.count())) {
    const names = await filterGroup(page, group).locator(".catalog-search-tag > span:first-child").allInnerTexts();
    throw new MoleError(`There is no ${group.toLowerCase()} filter called "${name}".`, `Use one of: ${names.join(", ")}`);
  }
  await tag.first().click();
  await settle(page);
}

function help(command?: string) {
  if (command && command in COMMANDS) {
    const [group, usage, summary] = COMMANDS[command as Command];
    return out({ command, group, usage: `pnpm mole ${usage}`, summary });
  }
  const groups: Record<string, string[]> = {};
  for (const [, [group, usage, summary]] of Object.entries(COMMANDS)) (groups[group] ??= []).push(`${usage.padEnd(52)} ${summary}`);
  console.log("mole: drive and prove the eShop storefront.\n\nUsage: pnpm mole <command>\n");
  for (const [group, lines] of Object.entries(groups)) console.log(`${group}\n${lines.map(line => "  " + line).join("\n")}\n`);
  console.log("Start with: pnpm mole up --start   (own terminal)   then: pnpm mole doctor\nGuide for agents: .github/skills/verify-mole/SKILL.md");
}

async function main() {
  try { loadEnvFile(join(ROOT, ".env")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: {
      url: { type: "string", default: DEFAULT_URL }, start: { type: "boolean", default: false }, headless: { type: "boolean", default: false },
      feature: { type: "string", multiple: true }, surface: { type: "string", multiple: true }, raw: { type: "boolean", default: false },
      page: { type: "string" }, changed: { type: "boolean", default: false },
      brand: { type: "string" }, type: { type: "string" }, clear: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false }, errors: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false },
    } });
  } catch (error) {
    throw new MoleError(error instanceof Error ? error.message : "Bad arguments", "See the options: pnpm mole help");
  }
  const { values, positionals: [command, ...args] } = parsed;
  if (!command || command === "help") return help(args[0]);
  if (!(command in COMMANDS)) throw new MoleError(`Unknown command "${command}".`, "See the commands: pnpm mole help");
  if (values.help) return help(command);
  switch (command as Command) {
    case "up": return up({ url: values.url!, start: values.start, headless: values.headless });
    case "down": return down();
    case "doctor": return doctor();
    case "open": return out(await withPage(async (page, _browser, session) => {
      await page.goto(new URL(args[0] ?? "/", session.appUrl).href, { waitUntil: "load" });
      await settle(page);
      return snapshot(page);
    }));
    case "page": {
      const n = args[0];
      if (!n || !/^\d+$/.test(n)) throw new MoleError("page needs a page number.", "pnpm mole page 2");
      return out(await withPage(async page => {
        const link = page.getByRole("link", { name: n, exact: true });
        if (!(await link.count())) throw new MoleError(`There is no pagination link "${n}" on this page.`, "Go to the catalog first (pnpm mole open /), and see what is there: pnpm mole snapshot");
        await link.first().click();
        await expect(page).toHaveURL(n === "1" ? /^[^?]*$/ : new RegExp(`[?&]page=${n}(&|$)`)).catch(() => {});
        await settle(page);
        return snapshot(page);
      }));
    }
    case "product": {
      const target = (args[0] === "show" ? args.slice(1) : args).join(" ");
      if (!target) throw new MoleError("product needs a name or an id.", `pnpm mole product show 1   or   pnpm mole product show "Adventurer GPS Watch" --surface api`);
      return out(await driveOn(values, async (adapter, page) => ({
        ...await adapter.product.show(/^\d+$/.test(target) ? Number(target) : target),
        ...(values.raw ? { raw: await rawFor(adapter.surface, page) } : {}),
      })));
    }
    case "catalog": {
      const verb = args[0];
      if (verb !== "list" && verb !== "facets") throw new MoleError("catalog needs list or facets.", "pnpm mole catalog list --page 2   or   pnpm mole catalog facets --brand Daybird --surface api");
      const pageNumber = values.page === undefined ? 1 : Number(values.page);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new MoleError(`--page must be a whole number from 1, not "${values.page}".`, "pnpm mole catalog list --page 2");
      if (verb === "facets" && values.page !== undefined) throw new MoleError("facets has no pages.", "Drop --page, or use: pnpm mole catalog list --page 2");
      const query = { brand: values.brand, type: values.type };
      return out(await driveOn(values, async (adapter, page) => ({
        ...(verb === "list" ? await adapter.catalog.list({ ...query, page: pageNumber }) : await adapter.catalog.facets(query)),
        ...(values.raw ? { raw: await rawFor(adapter.surface, page) } : {}),
      })));
    }
    case "api": {
      if (args[0] !== "get" || !args[1]) throw new MoleError("api needs get <path>.", `pnpm mole api get "${CATALOG_PATH}/items/1?api-version=2.0"`);
      const base = await apiUrlOf(await readSession());
      const url = new URL(args[1], base);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(error => {
        throw new MoleError(`Can't reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}.`, "Check the AppHost: pnpm mole doctor");
      });
      const text = await response.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* not JSON: show the text */ }
      return out({ url: url.href, status: response.status, body: typeof body === "string" ? body.slice(0, 4000) : body,
        note: "For looking around. A proof goes through a surface adapter, not through this." });
    }
    case "filter": {
      if (!values.brand && !values.type && !values.clear) throw new MoleError("filter needs --brand, --type or --clear.", "pnpm mole filter --brand Daybird");
      return out(await withPage(async page => {
        if (values.clear) {
          const clear = page.getByRole("link", { name: "Clear all filters" }).first();
          if (await clear.count()) { await clear.click(); await settle(page); }
        }
        if (values.brand) await clickTag(page, "Brand", values.brand);
        if (values.type) await clickTag(page, "Type", values.type);
        return snapshot(page);
      }));
    }
    case "reload": return out(await withPage(async page => { await page.reload({ waitUntil: "load" }); await settle(page); return snapshot(page); }));
    case "reset": return out(await withPage(async page => {
      const storage = await readStorage(page);
      const cookies = (await page.context().cookies()).map(cookie => cookie.name);
      if (values["dry-run"]) return { dryRun: true, wouldClear: { localStorage: storage, cookies }, next: "Run without --dry-run to clear it." };
      const cdp = await page.context().newCDPSession(page);
      const origin = new URL(page.url()).origin;
      for (const isLocalStorage of [true, false]) await cdp.send("DOMStorage.clear", { storageId: { securityOrigin: origin, isLocalStorage } });
      await cdp.detach();
      await page.context().clearCookies();
      await page.goto(new URL("/", origin).href, { waitUntil: "load" });
      await settle(page);
      return { cleared: { localStorage: storage, cookies }, ...await snapshot(page) };
    }));
    case "snapshot": return out(await withPage(snapshot));
    case "storage": return out(await withPage(async page => ({
      origin: new URL(page.url()).origin,
      localStorage: await readStorage(page),
      cookies: (await page.context().cookies()).map(cookie => cookie.name),
    })));
    case "console": {
      await readSession();
      const entries = (await readEvents(["console", "pageerror", "load"])).filter(event => !values.errors || event.level === "error");
      return out({ entries: entries.slice(-30), note: "pageerror = an uncaught exception. load = the page (re)loaded." });
    }
    case "network": {
      await readSession();
      return out({ entries: (await readEvents(["response", "requestfailed", "load"])).slice(-40) });
    }
    case "screenshot": {
      const path = args[0] ?? join(DIR, `screenshot-${Date.now()}.png`);
      return out(await withPage(async page => { await page.screenshot({ path, fullPage: true }); return { path }; }));
    }
    case "eval": {
      if (!args[0]) throw new MoleError("eval needs an expression.", `pnpm mole eval "document.querySelectorAll('.catalog-product').length"`);
      return out(await withPage(async page => ({ result: await page.evaluate(args.join(" ")) })));
    }
    case "features": return listFeatures(values.changed);
    case "prove": return prove(values.feature ?? [], values.surface ?? []);
    case "judge": return judgeProduct();
  }
}

main().catch(error => {
  const known = error instanceof MoleError;
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    next: known ? error.next : "Run pnpm mole doctor" }, null, 2));
  process.exitCode = known ? error.code : 2;
});
