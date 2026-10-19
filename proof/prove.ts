import { expect } from "@playwright/test";
import type { ProofKit } from "./proof";

// A freshly started app renders its first catalog pages slowly; waits for the catalog use this.
const COLD = 15_000;

// A fresh anonymous visitor with the storefront already loaded.
// Record facts with check(); a missing element is a finding, not a crash.
export async function prove({ page, check }: ProofKit) {
  const home = new URL("/", page.url()).href;
  const heading = page.getByRole("heading", { name: "Ready for a new adventure?" });
  check("home page shows the hero heading", await heading.isVisible(), true,
    "The storefront did not render its hero heading. Is the WebApp up at the given --url?");

  const products = page.locator(".catalog-product");
  // The catalog streams in after the first paint: wait for it, then record what is there.
  await expect(products.first()).toBeVisible({ timeout: COLD }).catch(() => {});
  check("home page lists catalog products", (await products.count()) > 0, true,
    "No products rendered. Check that Catalog.API is healthy and seeded.");

  await page.getByRole("link", { name: "Adventurer GPS Watch" }).click();
  const detail = page.getByRole("heading", { name: "Adventurer GPS Watch" });
  await expect(detail).toBeVisible().catch(() => {});
  check("product link opens its detail page", await detail.isVisible(), true,
    "Clicking the product did not open a detail page with its name as a heading.");

  await page.goto(home);
  await page.getByRole("link", { name: "2", exact: true }).click();
  await expect(page).toHaveURL(/\?page=2$/).catch(() => {});
  check("pagination goes to page 2", new URL(page.url()).search, "?page=2",
    "The page 2 link did not navigate to ?page=2.");
  await expect(products).toHaveCount(9, { timeout: COLD }).catch(() => {});
  check("page 2 shows 9 products", await products.count(), 9,
    "Page 2 should list 9 products (see e2e/BrowseItemTest.spec.ts).");

  await page.reload();
  check("page 2 survives reload", new URL(page.url()).search, "?page=2",
    "Reloading page 2 lost the page number.");
  await expect(products).toHaveCount(9, { timeout: COLD }).catch(() => {});
  check("page 2 still shows 9 products after reload", await products.count(), 9,
    "After a reload the catalog list changed.");
}
