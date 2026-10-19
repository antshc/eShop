import {
  PAGE_SIZE, SurfaceError,
  type CatalogFacets, type CatalogList, type FacetCount, type ProductShow, type SurfaceAdapter,
} from "./types";

// Catalog.API is reached through the mobile-bff proxy, the one door the AppHost opens to the outside.
// The proxy only matches a request that carries api-version.
export const CATALOG_PATH = "/catalog-api/api/catalog";
const VERSION = "2.0";

type Item = { id: number; name: string; description: string | null; price: number; catalogBrand: { brand: string } | null };
type Paged = { pageIndex: number; pageSize: number; count: number; data: Item[] };
type Facets = { brandCounts: { id: number; count: number }[]; typeCounts: { id: number; count: number }[] };

// A client for the catalog API, with the page and id translation a caller should not have to know.
export function apiSurface(baseUrl: string | null, fetcher: typeof fetch = fetch): SurfaceAdapter {
  const fail = (message: string, next = "Is the AppHost running? pnpm mole doctor") => new SurfaceError("api", message, next);

  async function request(path: string, params: Record<string, string | number | undefined> = {}) {
    if (!baseUrl) throw fail("No API URL is known for this run.", "Restart with the AppHost running: pnpm mole down; pnpm mole up. Or set ESHOP_API_URL to the mobile-bff URL.");
    const url = new URL(CATALOG_PATH + path, baseUrl);
    url.searchParams.set("api-version", VERSION);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    try { return await fetcher(url, { signal: AbortSignal.timeout(10_000) }); } catch (error) {
      throw fail(`Can't reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}.`,
        "Check the AppHost is running and the URL is right: pnpm mole doctor. To set it by hand: ESHOP_API_URL=<mobile-bff url>");
    }
  }

  async function json<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const response = await request(path, params);
    if (!response.ok) throw fail(`GET ${CATALOG_PATH}${path} answered ${response.status}.`, "Check the route and api-version in src/eShop.AppHost/Extensions.cs");
    return await response.json() as T;
  }

  // Filters are ids on the wire and names for everyone else.
  async function names(kind: "catalogBrands" | "catalogTypes") {
    const rows = await json<Record<string, string | number>[]>(`/${kind}`);
    return rows.map(row => ({ id: Number(row.id), name: String(row[kind === "catalogBrands" ? "brand" : "type"]) }));
  }

  async function idOf(kind: "catalogBrands" | "catalogTypes", name: string) {
    const all = await names(kind);
    const found = all.find(row => row.name.toLowerCase() === name.toLowerCase());
    if (!found) throw fail(`There is no ${kind === "catalogBrands" ? "brand" : "type"} called "${name}".`, `Use one of: ${all.map(row => row.name).join(", ")}`);
    return found.id;
  }

  async function filters(query: { brand?: string; type?: string }) {
    return {
      brand: query.brand ? await idOf("catalogBrands", query.brand) : undefined,
      type: query.type ? await idOf("catalogTypes", query.type) : undefined,
    };
  }

  const shown = (item: Item): ProductShow => ({
    found: true, surface: "api", id: item.id, name: item.name, brand: item.catalogBrand?.brand ?? null, price: item.price, description: item.description ?? "",
  });

  return {
    surface: "api",
    catalog: {
      async list(query) {
        const page = query.page ?? 1;
        const paged = await json<Paged>("/items", { pageIndex: page - 1, pageSize: PAGE_SIZE, ...await filters(query) });
        return {
          surface: "api", page: paged.pageIndex + 1, pageSize: paged.pageSize, total: paged.count,
          items: paged.data.map(item => ({ id: item.id, name: item.name, price: item.price })),
        } satisfies CatalogList;
      },
      async facets(query) {
        const [brands, types, counts] = await Promise.all([names("catalogBrands"), names("catalogTypes"), (async () => {
          const ids = await filters(query);
          return json<Facets>("/items/facets", ids);
        })()]);
        const named = (all: { id: number; name: string }[], found: { id: number; count: number }[]): FacetCount[] =>
          all.map(row => ({ name: row.name, count: found.find(f => f.id === row.id)?.count ?? 0 }));
        return { surface: "api", brands: named(brands, counts.brandCounts), types: named(types, counts.typeCounts) } satisfies CatalogFacets;
      },
    },
    product: {
      async show(target) {
        if (typeof target === "number" || /^\d+$/.test(String(target))) {
          const response = await request(`/items/${target}`);
          if (response.status === 404) return { found: false, surface: "api", status: 404 };
          if (!response.ok) throw fail(`GET ${CATALOG_PATH}/items/${target} answered ${response.status}.`, "Check the route and api-version in src/eShop.AppHost/Extensions.cs");
          return shown(await response.json() as Item);
        }
        const found = await json<Paged>("/items", { name: target, pageIndex: 0, pageSize: 50 });
        const item = found.data.find(row => row.name.toLowerCase() === target.toLowerCase());
        if (!item) throw fail(`No product called "${target}".`, "Use its id: pnpm mole product show <id> --surface api");
        return shown(item);
      },
    },
  };
}
