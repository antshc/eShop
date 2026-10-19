import type { Page } from "@playwright/test";
import {
  PAGE_SIZE, SurfaceError, priceOf,
  type CatalogFacets, type CatalogItem, type CatalogList, type CatalogQuery, type FacetCount, type ProductShow, type SurfaceAdapter,
} from "./types";

// A freshly started app renders its first catalog pages slowly; waits for the catalog use this.
export const COLD = 15_000;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const textOf = async (locator: ReturnType<Page["locator"]>) =>
  (await locator.count()) ? (await locator.first().innerText()).trim() : null;

const fail = (message: string, next: string) => new SurfaceError("web", message, next);

// Everything about the storefront's pages lives here: selectors, routes, the URL it keeps state in.
export function webSurface(page: Page) {
  const home = () => new URL("/", page.url()).href;
  const group = (name: "Brand" | "Type") =>
    page.locator(".catalog-search-group", { has: page.getByRole("heading", { name, exact: true }) });
  const tags = (name: "Brand" | "Type") => group(name).locator(".catalog-search-tag");

  // Blazor streams the catalog in after the first paint: wait for products, an empty result, or an item.
  async function settle() {
    await page.waitForLoadState("load");
    await page.locator(".catalog-product, .catalog-empty, .item-details, .item-notfound").first().waitFor({ timeout: COLD }).catch(() => {});
  }

  async function go(url: string) {
    const response = await page.goto(url, { waitUntil: "load", timeout: COLD }).catch(() => null);
    await settle();
    return response;
  }

  // Follow a filter tag as a bookmark would: a tag with no matches is disabled and cannot be clicked, but its link works.
  async function followTag(name: "Brand" | "Type", value: string) {
    const tag = tags(name).filter({ has: page.locator("span", { hasText: new RegExp(`^${escapeRegExp(value)}$`, "i") }) });
    if (!(await tag.count())) {
      const names = await tags(name).locator("> span:first-child").allInnerTexts();
      throw fail(`There is no ${name.toLowerCase()} filter called "${value}".`, `Use one of: ${names.filter(n => n !== "All").join(", ")}`);
    }
    const href = await tag.first().getAttribute("href");
    await go(new URL(href!, page.url()).href);
  }

  async function followPage(n: number) {
    const link = page.getByRole("link", { name: String(n), exact: true });
    if (!(await link.count())) throw fail(`The catalog has no page ${n}.`, "Use a page the pagination shows: pnpm mole catalog list --surface web");
    await link.first().click({ timeout: COLD });
    await page.waitForURL(new RegExp(`[?&]page=${n}(&|$)`), { timeout: COLD }).catch(() => {});
    await settle();
  }

  async function open(query: Pick<CatalogQuery, "brand" | "type">) {
    await go(home());
    if (query.brand) await followTag("Brand", query.brand);
    if (query.type) await followTag("Type", query.type);
  }

  async function readCatalog(): Promise<CatalogList> {
    const read = () => page.locator(".catalog-product").evaluateAll(cards => cards.map(card => ({
      href: card.getAttribute("href") ?? "",
      name: card.querySelector(".name")?.textContent?.trim() ?? "",
      price: card.querySelector(".price")?.textContent?.trim() ?? "",
    })));
    // The grid can still be filling in when the first card appears: read until it stops changing.
    let cards = await read();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150);
      const again = await read();
      const stable = again.length === cards.length;
      cards = again;
      if (stable) break;
    }
    const items: CatalogItem[] = cards.map(card => ({ id: Number(card.href.match(/(?:^|\/)item\/(\d+)/)?.[1] ?? NaN), name: card.name, price: priceOf(card.price) }));
    const count = await textOf(page.locator(".catalog-count"));
    return {
      surface: "web",
      page: Number(new URL(page.url()).searchParams.get("page") ?? 1),
      pageSize: PAGE_SIZE,
      total: Number(count?.match(/\d+/)?.[0] ?? 0),
      items,
    };
  }

  async function readProduct(): Promise<ProductShow> {
    const id = Number(new URL(page.url()).pathname.match(/\/item\/(\d+)/)?.[1] ?? NaN);
    if (!(await page.locator(".item-details").count())) return { found: false, surface: "web", status: 0 };
    return {
      found: true, surface: "web", id,
      name: (await textOf(page.getByRole("heading", { level: 1 }))) ?? "",
      brand: await textOf(page.locator(".item-meta dd")),
      price: priceOf((await textOf(page.locator(".item-buy .price"))) ?? ""),
      description: (await textOf(page.locator(".item-desc"))) ?? "",
    };
  }

  const adapter: SurfaceAdapter = {
    surface: "web",
    catalog: {
      async list(query) {
        await open(query);
        if ((query.page ?? 1) > 1) await followPage(query.page!);
        return readCatalog();
      },
      async facets(query) {
        await open(query);
        const read = async (name: "Brand" | "Type"): Promise<FacetCount[]> =>
          (await tags(name).evaluateAll(all => all.map(tag => ({
            name: tag.querySelector("span:first-child")?.textContent?.trim() ?? "",
            count: Number(tag.querySelector(".catalog-search-tag-count")?.textContent?.trim() ?? 0),
          })))).filter(facet => facet.name !== "All");
        return { surface: "web", brands: await read("Brand"), types: await read("Type") } satisfies CatalogFacets;
      },
    },
    product: {
      async show(target) {
        if (typeof target === "number" || /^\d+$/.test(String(target))) {
          const response = await go(new URL(`/item/${target}`, page.url()).href);
          const shown = await readProduct();
          return shown.found ? shown : { found: false, surface: "web", status: response?.status() ?? 0 };
        }
        await go(home());
        const card = page.locator(".catalog-product", { has: page.locator(".name", { hasText: new RegExp(`^${escapeRegExp(target)}$`, "i") }) });
        if (!(await card.count())) throw fail(`No product called "${target}" on the first page of the catalog.`, "Use its id: pnpm mole product show <id> --surface web");
        await card.first().click({ timeout: COLD });
        await page.locator(".item-details").waitFor({ timeout: COLD }).catch(() => {});
        return readProduct();
      },
    },
  };

  // What only a browser visitor has: the page chrome, URL state, navigation. No other surface has these.
  return {
    ...adapter,
    readCatalog,
    readProduct,
    url: () => page.url(),
    heroHeadingShown: async () => page.getByRole("heading", { name: "Ready for a new adventure?" }).isVisible(),
    async reload() { await page.reload({ waitUntil: "load", timeout: COLD }); await settle(); },
    emptyState: async () => textOf(page.locator(".catalog-empty").getByRole("heading")),
    async clearAllFilters() {
      await page.locator(".catalog-empty").getByRole("link", { name: "Clear all filters" }).click({ timeout: COLD });
      await settle();
      return readCatalog();
    },
    // From a later page, choose a brand: the filter's link must land on page 1.
    async filterFromPage(n: number, brand: string) {
      await adapter.catalog.list({ page: n });
      await followTag("Brand", brand);
      return { url: page.url(), list: await readCatalog() };
    },
    purchaseAction: async () => textOf(page.locator(".add-to-cart button")),
    notFoundMessage: async () => textOf(page.locator(".item-notfound")),
    // Back to catalog is read from the Referer, so reach the page by clicking through a filtered catalog.
    async backToCatalog(brand: string) {
      await open({ brand });
      const filteredUrl = page.url();
      await page.locator(".catalog-product").first().click({ timeout: COLD });
      await page.locator(".item-details").waitFor({ timeout: COLD }).catch(() => {});
      await page.locator("a.item-back").click({ timeout: COLD }).catch(() => {});
      await page.waitForURL(/brand=\d+/, { timeout: COLD }).catch(() => {});
      return { filteredUrl, backUrl: page.url() };
    },
  };
}

export type WebSurface = ReturnType<typeof webSurface>;
