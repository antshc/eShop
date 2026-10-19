import { expect } from "@playwright/test";
import type { ProofKit } from "../proof";
import { COLD, attempt, filterTag, homeUrl, textOf } from "./shared";

// Map: .github/skills/verify-mole/features/catalog.md
export async function proveCatalog({ page, check }: ProofKit) {
  const home = homeUrl(page);
  const products = page.locator(".catalog-product");
  const count = page.locator(".catalog-count");

  await attempt(() => page.goto(home));
  const heading = page.getByRole("heading", { name: "Ready for a new adventure?" });
  check("catalog: home page shows the hero heading", await heading.isVisible(), true,
    "The storefront did not render its hero heading. Is the WebApp up at the given --url?");

  // The catalog streams in after the first paint: wait for it, then record what is there.
  await expect(products.first()).toBeVisible({ timeout: COLD }).catch(() => {});
  check("catalog: home page lists catalog products", (await products.count()) > 0, true,
    "No products rendered. Check that Catalog.API is healthy and seeded.");
  check("catalog: the count covers the whole seed", await textOf(count), "101 products",
    "The catalog count is not the seeded 101 products. Is Catalog.API seeded from src/Catalog.API/Setup/catalog.json?");

  await attempt(() => page.getByRole("link", { name: "2", exact: true }).click());
  await expect(page).toHaveURL(/\?page=2$/).catch(() => {});
  check("catalog: pagination goes to page 2", new URL(page.url()).search, "?page=2",
    "The page 2 link did not navigate to ?page=2.");
  await expect(products).toHaveCount(9, { timeout: COLD }).catch(() => {});
  check("catalog: page 2 shows 9 products", await products.count(), 9,
    "Page 2 should list 9 products (see e2e/BrowseItemTest.spec.ts).");

  await page.reload();
  check("catalog: page 2 survives reload", new URL(page.url()).search, "?page=2",
    "Reloading page 2 lost the page number.");
  await expect(products).toHaveCount(9, { timeout: COLD }).catch(() => {});
  check("catalog: page 2 still shows 9 products after reload", await products.count(), 9,
    "After a reload the catalog list changed.");

  // Filtering from page 2 must land on page 1 of the filtered list.
  await attempt(() => filterTag(page, "Brand", "Daybird").first().click({ timeout: COLD }));
  await expect(page).toHaveURL(/brand=\d+/).catch(() => {});
  const filtered = new URL(page.url());
  check("catalog: a brand filter drops the page number", filtered.searchParams.has("page"), false,
    "Choosing a filter must reset to page 1: the filter links should clear `page`.");
  check("catalog: the brand filter is in the URL", filtered.searchParams.has("brand"), true,
    "The Daybird tag did not put ?brand=ID in the URL.");
  await expect(count).toHaveText("10 products", { timeout: COLD }).catch(() => {});
  check("catalog: Daybird shows 10 products", await textOf(count), "10 products",
    "The count after the Daybird filter should be 10 (see src/Catalog.API/Setup/catalog.json).");

  // A tag with no matches is disabled, so follow its link the way a bookmark would.
  const emptyHref = await filterTag(page, "Type", "Climbing").first().getAttribute("href").catch(() => null);
  await attempt(() => page.goto(emptyHref!));
  const empty = page.locator(".catalog-empty");
  await expect(empty).toBeVisible({ timeout: COLD }).catch(() => {});
  check("catalog: a filter with no matches shows the empty state", await textOf(empty.getByRole("heading")), "No products match these filters",
    "Daybird has no Climbing products: the page should say so, not render blank.");

  await attempt(() => empty.getByRole("link", { name: "Clear all filters" }).click());
  await expect(count).toHaveText("101 products", { timeout: COLD }).catch(() => {});
  check("catalog: Clear all filters restores the full catalog", await textOf(count), "101 products",
    "Clear all filters should remove brand and type and show every product again.");
}
