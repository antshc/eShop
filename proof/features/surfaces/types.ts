// What a feature does, said once. Each surface (web, api) turns the same call into its own way of driving the app
// and returns the same shape, so a contract rule is written once and checked on every surface.
export type Surface = "web" | "api";
export const SURFACES: readonly Surface[] = ["web", "api"];

// Both surfaces list this many products per page, and pages count from 1.
export const PAGE_SIZE = 9;

export class SurfaceError extends Error {
  constructor(readonly surface: Surface, message: string, readonly next: string) { super(`${surface}: ${message}`); }
}

export type CatalogQuery = { page?: number; brand?: string; type?: string };
export type CatalogItem = { id: number; name: string; price: number };
export type CatalogList = { surface: Surface; page: number; pageSize: number; total: number; items: CatalogItem[] };

export type FacetCount = { name: string; count: number };
export type CatalogFacets = { surface: Surface; brands: FacetCount[]; types: FacetCount[] };

export type ProductShown = { found: true; surface: Surface; id: number; name: string; brand: string | null; price: number; description: string };
export type ProductMissing = { found: false; surface: Surface; status: number };
export type ProductShow = ProductShown | ProductMissing;

export interface SurfaceAdapter {
  readonly surface: Surface;
  catalog: {
    list(query: CatalogQuery): Promise<CatalogList>;
    facets(query: Pick<CatalogQuery, "brand" | "type">): Promise<CatalogFacets>;
  };
  product: {
    /** A catalog id, or a product name as it appears in the catalog. */
    show(target: string | number): Promise<ProductShow>;
  };
}

export const isSurface = (value: string): value is Surface => (SURFACES as readonly string[]).includes(value);

// No names means every surface. An unknown name is the caller's mistake, so say what exists.
export function selectSurfaces(names: string[] = [], available: readonly Surface[] = SURFACES): Surface[] {
  const unknown = names.filter(name => !isSurface(name));
  if (unknown.length) throw new Error(`Unknown surface "${unknown.join('", "')}". Surfaces: ${SURFACES.join(", ")}`);
  const chosen = names as Surface[];
  const missing = chosen.filter(name => !available.includes(name));
  if (missing.length) throw new Error(`This feature has no "${missing.join('", "')}" surface. It has: ${available.join(", ")}`);
  return chosen.length ? [...new Set(chosen)] : [...available];
}

export const priceOf = (text: string) => Number(text.replace(/[^0-9.]/g, ""));
