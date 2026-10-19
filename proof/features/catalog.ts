import type { ProofKit } from "../proof";
import { PAGE_SIZE, adapterFor, observe, type CatalogList, type Surface } from "./surfaces";

const SEED = 101;
const DAYBIRD = 10;

// Map: .github/skills/verify-mole/features/catalog.md
// The contract is checked through each surface's adapter; only what a browser visitor alone has sits in the web block.
export async function proveCatalog(kit: ProofKit) {
  for (const surface of kit.surfaces) await proveContract(kit, surface);
  if (kit.surfaces.includes("web")) await proveWebOnly(kit);
}

async function proveContract(kit: ProofKit, surface: Surface) {
  const { check } = kit;
  const name = (rule: string) => `catalog/${surface}: ${rule}`;
  const catalog = adapterFor(surface, { page: kit.page, apiUrl: kit.apiUrl }).catalog;

  const first = await observe(kit, name("lists the first page"), () => catalog.list({}));
  if (first) {
    check(name("lists products"), first.items.length > 0, true, "No products came back. Check that Catalog.API is healthy and seeded.");
    check(name("the first page holds 9 products"), first.items.length, PAGE_SIZE, "A page should list 9 products (see e2e/BrowseItemTest.spec.ts).");
    check(name("the count covers the whole seed"), first.total, SEED,
      "The total is not the seeded 101 products. Is Catalog.API seeded from src/Catalog.API/Setup/catalog.json?");
  }

  const second = await observe(kit, name("lists page 2"), () => catalog.list({ page: 2 }));
  if (second) {
    check(name("page 2 is page 2"), second.page, 2, "Asking for page 2 should answer with page 2.");
    check(name("page 2 shows 9 products"), second.items.length, PAGE_SIZE, "Page 2 should list 9 products (see e2e/BrowseItemTest.spec.ts).");
    check(name("page 2 shares no product with page 1"), overlap(first, second), [], "Paging returned the same product on two pages.");
  }

  const daybird = await observe(kit, name("filters by brand"), () => catalog.list({ brand: "Daybird" }));
  if (daybird) {
    check(name(`Daybird has ${DAYBIRD} products`), daybird.total, DAYBIRD,
      "The total after the Daybird filter should be 10 (see src/Catalog.API/Setup/catalog.json).");
    check(name("a brand filter fills its page from the matches"), daybird.items.length, Math.min(DAYBIRD, PAGE_SIZE),
      "The filtered page lists fewer products than the filter's total allows.");
  }

  const none = await observe(kit, name("filters to nothing"), () => catalog.list({ brand: "Daybird", type: "Climbing" }));
  if (none) {
    check(name("a filter with no matches lists no products"), { total: none.total, items: none.items.length }, { total: 0, items: 0 },
      "Daybird has no Climbing products: the result should be empty.");
  }

  const facets = await observe(kit, name("counts facets"), () => catalog.facets({}));
  if (facets) {
    check(name("the Daybird facet matches the Daybird filter"), facets.brands.find(brand => brand.name === "Daybird")?.count, DAYBIRD,
      "The count beside the Daybird option should equal the products the Daybird filter returns.");
    check(name("brand counts add up to the whole seed"), facets.brands.reduce((sum, brand) => sum + brand.count, 0), SEED,
      "Every product has one brand, so the brand counts should add up to the seed.");
  }
}

const overlap = (a: CatalogList | null, b: CatalogList) =>
  (a?.items ?? []).filter(item => b.items.some(other => other.id === item.id)).map(item => item.id);

// Behavior that exists only in the storefront's pages: the hero, URL state, navigation, the empty-state page.
async function proveWebOnly(kit: ProofKit) {
  const { check } = kit;
  const web = adapterFor("web", { page: kit.page, apiUrl: kit.apiUrl });

  await observe(kit, "catalog/web: opens the home page", () => web.catalog.list({}));
  check("catalog/web: the home page shows the hero heading", await web.heroHeadingShown(), true,
    "The storefront did not render its hero heading. Is the WebApp up at the given --url?");

  await observe(kit, "catalog/web: opens page 2", () => web.catalog.list({ page: 2 }));
  check("catalog/web: pagination puts the page in the URL", new URL(web.url()).search, "?page=2", "The page 2 link did not navigate to ?page=2.");
  await observe(kit, "catalog/web: reloads page 2", () => web.reload());
  const reloaded = await observe(kit, "catalog/web: reads page 2 after reload", () => web.readCatalog());
  check("catalog/web: page 2 survives reload", new URL(web.url()).search, "?page=2", "Reloading page 2 lost the page number.");
  check("catalog/web: page 2 still shows 9 products after reload", reloaded?.items.length, PAGE_SIZE, "After a reload the catalog list changed.");

  const filtered = await observe(kit, "catalog/web: filters from page 2", () => web.filterFromPage(2, "Daybird"));
  if (filtered) {
    const url = new URL(filtered.url);
    check("catalog/web: a brand filter drops the page number", url.searchParams.has("page"), false,
      "Choosing a filter must reset to page 1: the filter links should clear `page`.");
    check("catalog/web: the brand filter is in the URL", url.searchParams.has("brand"), true, "The Daybird tag did not put ?brand=ID in the URL.");
  }

  await observe(kit, "catalog/web: opens a filter with no matches", () => web.catalog.list({ brand: "Daybird", type: "Climbing" }));
  check("catalog/web: a filter with no matches shows the empty state", await web.emptyState(), "No products match these filters",
    "Daybird has no Climbing products: the page should say so, not render blank.");
  const cleared = await observe(kit, "catalog/web: clears the filters", () => web.clearAllFilters());
  check("catalog/web: Clear all filters restores the full catalog", cleared?.total, SEED,
    "Clear all filters should remove brand and type and show every product again.");
}
