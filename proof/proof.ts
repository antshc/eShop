import { isDeepStrictEqual } from "node:util";
import type { Browser, Page } from "@playwright/test";

export const EMAIL = "ada@example.test";

export type Check = { name: string; pass: boolean; expected: unknown; actual: unknown; hint?: string };
export type ProofKit = {
  /** A fresh visitor (no storage) with the app already loaded. */
  page: Page;
  email: string;
  /** Record one fact. Never throws: a failed check is evidence, not a crash. */
  check(name: string, actual: unknown, expected: unknown, hint?: string): void;
  /** localStorage for the app's origin, read through the DevTools protocol. */
  storage(): Promise<Record<string, unknown>>;
};
export type Prove = (kit: ProofKit) => Promise<void>;
export type Receipt = {
  verdict: "PASS" | "FAIL" | "ERROR";
  revision: string | null;
  app: string;
  at: string;
  checks: Check[];
  /** The features this run proved. A subset is not a full proof. */
  features?: string[];
  pageErrors: string[];
  screenshot?: string;
  error?: string;
  next: string[];
};

const parse = (value: string) => { try { return JSON.parse(value); } catch { return value; } };

export async function readStorage(page: Page): Promise<Record<string, unknown>> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOMStorage.enable");
    const { entries } = await cdp.send("DOMStorage.getDOMStorageItems", {
      storageId: { securityOrigin: new URL(page.url()).origin, isLocalStorage: true },
    });
    return Object.fromEntries(entries.map(([key, value]) => [key, parse(value)]));
  } finally { await cdp.detach(); }
}

// eShop serves no revision. The caller supplies one (see sourceRevision() in app.ts), or it stays null.
export type Revision = () => Promise<string | null>;

const show = (value: unknown) => JSON.stringify(value);

// Runs a `prove()` against a running app and returns a receipt. If the revision changes while
// proving, the evidence belongs to two builds and the verdict is "can't tell".
export async function runProof(browser: Browser, app: string, prove: Prove, screenshot?: string, revision: Revision = async () => null): Promise<Receipt> {
  const checks: Check[] = [];
  const pageErrors = new Set<string>();
  const receipt: Receipt = { verdict: "ERROR", revision: null, app, at: new Date().toISOString(), checks, pageErrors: [], next: [] };
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); // fresh visitor: no storage, no cookies
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(2500);
    page.on("pageerror", error => pageErrors.add(error.message));
    page.on("console", message => { if (message.type() === "error") pageErrors.add(message.text()); });
    receipt.revision = await revision();
    await page.goto(app, { waitUntil: "load", timeout: 5000 });
    await prove({
      page, email: EMAIL, storage: () => readStorage(page),
      check: (name, actual, expected, hint) =>
        checks.push({ name, pass: isDeepStrictEqual(actual, expected), expected, actual, ...(hint ? { hint } : {}) }),
    });
    const now = await revision();
    if (now !== receipt.revision) {
      receipt.error = `The source changed while proving (started on ${receipt.revision}, now ${now}). Evidence from two builds proves neither.`;
    } else if (!checks.length) {
      receipt.error = "prove() recorded no checks. Call check(name, actual, expected) for each fact you observe.";
    } else {
      receipt.verdict = checks.every(check => check.pass) ? "PASS" : "FAIL";
    }
    if (screenshot) {
      try {
        await page.screenshot({ path: screenshot, fullPage: true });
        receipt.screenshot = screenshot;
      } catch (error) {
        // The receipt tells the agent to read the screenshot, so a missing one can't pass.
        receipt.verdict = "ERROR";
        receipt.error = `Couldn't save the screenshot (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). A receipt without its screenshot can't be read.`;
      }
    }
  } catch (error) {
    receipt.error = "prove() threw: " + (error instanceof Error ? error.message.split("\n")[0] : String(error)) +
      ". If something is missing, that is a finding: record it with check() instead of throwing.";
  } finally {
    await context.close();
  }
  receipt.pageErrors = [...pageErrors];
  if (receipt.verdict === "PASS") {
    receipt.next = ["These checks passed on this revision. They cover nothing else: read the screenshot for anything they missed."];
  } else if (receipt.verdict === "FAIL") {
    receipt.next = [...checks.filter(check => !check.pass).map(check =>
      check.hint ?? `Fix "${check.name}": expected ${show(check.expected)}, got ${show(check.actual)}.`),
      "Then re-run: pnpm mole prove (or pnpm prove)"];
  } else {
    receipt.next = [receipt.error ?? "Unknown error.", "Can't tell is not the same as broken. Run pnpm mole doctor (or check the app is running at --url), then prove again."];
  }
  return receipt;
}
