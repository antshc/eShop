import type { Page } from "@playwright/test";

// A freshly started app renders its first catalog pages slowly; waits for the catalog use this.
export const COLD = 15_000;

// A missing element is a finding, not a crash: a throw would turn the whole run into "can't tell".
export async function attempt(step: () => Promise<unknown>) {
  try { await step(); } catch { /* the check that follows records what is wrong */ }
}

export const homeUrl = (page: Page) => new URL("/", page.url()).href;

// A filter tag by its group (Brand or Type) and visible name, as a visitor sees it.
export const filterTag = (page: Page, group: "Brand" | "Type", name: string) =>
  page.locator(".catalog-search-group", { has: page.getByRole("heading", { name: group, exact: true }) })
    .locator(".catalog-search-tag", { has: page.locator("span", { hasText: new RegExp(`^${name}$`) }) });

export const textOf = async (locator: ReturnType<Page["locator"]>) =>
  (await locator.count()) ? (await locator.first().innerText()).trim() : null;
