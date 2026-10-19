import { expect } from "@playwright/test";
import type { ProofKit } from "../proof";
import { COLD, attempt, filterTag, homeUrl, textOf } from "./shared";

const WATCH = "Adventurer GPS Watch";

// Map: .github/skills/verify-mole/features/product.md
export async function proveProduct({ page, check }: ProofKit) {
  const home = homeUrl(page);
  const products = page.locator(".catalog-product");
  const detail = page.locator(".item-details");

  // Features share one page: start from a known place.
  await attempt(() => page.goto(home));
  const card = products.filter({ has: page.locator(".name", { hasText: new RegExp(`^${WATCH}$`) }) });
  await expect(card.first()).toBeVisible({ timeout: COLD }).catch(() => {});
  const cardPrice = await textOf(card.locator(".price"));

  await attempt(() => card.first().click());
  const heading = page.getByRole("heading", { name: WATCH });
  await expect(heading).toBeVisible({ timeout: COLD }).catch(() => {});
  check("product: the card opens a page headed with its name", await heading.isVisible(), true,
    "Clicking the product did not open a detail page with its name as a heading.");
  check("product: the page shows the card's price", await textOf(page.locator(".item-buy .price")), cardPrice,
    "The detail page price differs from the catalog card. Compare the exact strings.");
  check("product: the page has a description", ((await textOf(page.locator(".item-desc"))) ?? "").length > 0, true,
    "The detail page shows no description.");
  check("product: an anonymous visitor is asked to log in", await textOf(page.locator(".add-to-cart button")), "Log in to purchase",
    "A visitor who is not signed in must not see an add-to-bag button.");

  await page.reload();
  await expect(detail).toBeVisible({ timeout: COLD }).catch(() => {});
  check("product: the page survives a reload", await textOf(page.locator(".item-buy .price")), cardPrice,
    "After a reload the product page lost its name or price.");

  const missing = await page.goto(new URL("/item/99999", home).href);
  check("product: an unknown id answers 404", missing?.status(), 404,
    "A product that does not exist must return 404, not an empty page.");
  check("product: an unknown id says so", await textOf(page.locator(".item-notfound")), "Sorry, we couldn't find any such product.",
    "The not-found page should tell the visitor the product does not exist.");

  // Back to catalog is read from the Referer, so reach the page by clicking through a filtered catalog.
  await attempt(() => page.goto(home));
  await attempt(() => filterTag(page, "Brand", "Daybird").first().click({ timeout: COLD }));
  await expect(page).toHaveURL(/brand=\d+/).catch(() => {});
  const filteredUrl = page.url();
  await expect(products.first()).toBeVisible({ timeout: COLD }).catch(() => {});
  await attempt(() => products.first().click());
  await expect(detail).toBeVisible({ timeout: COLD }).catch(() => {});
  await attempt(() => page.locator("a.item-back").click());
  await expect(page).toHaveURL(/brand=\d+/).catch(() => {});
  check("product: Back to catalog keeps the filter", page.url(), filteredUrl,
    "Back to catalog should return to the filtered list the visitor came from.");
}
