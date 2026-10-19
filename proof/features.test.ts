import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FEATURES, featuresFor, selectFeatures, surfacesFor } from "./features";
import { proveCatalog } from "./features/catalog";
import { PAGE_SIZE, apiSurface, selectSurfaces } from "./features/surfaces";
import type { ProofKit } from "./proof";

const MAPS = join(__dirname, "..", ".github", "skills", "verify-mole", "features");

// The frontmatter of a map: `key: value` lines, and `key:` followed by `  - item` lines.
function frontmatter(file: string) {
  const match = readFileSync(join(MAPS, file), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `${file} has no frontmatter`);
  const data: Record<string, string | string[]> = {};
  let list: string[] | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) { list.push(item[1].trim()); continue; }
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (!pair) continue;
    if (pair[2]) { data[pair[1]] = pair[2].trim(); list = null; } else { list = data[pair[1]] = []; }
  }
  return data;
}

const maps = readdirSync(MAPS).filter(file => file.endsWith(".md") && file !== "README.md");
const index = readFileSync(join(MAPS, "README.md"), "utf8");

test("every feature has a map, and every map has a feature", () => {
  assert.deepEqual(maps.map(file => file.replace(/\.md$/, "")).sort(), Object.keys(FEATURES).sort());
});

for (const [name, feature] of Object.entries(FEATURES)) {
  test(`${name}: the map names its feature, files and proof command`, () => {
    const data = frontmatter(`${name}.md`);
    assert.equal(data.feature, name);
    assert.equal(data.prove, `pnpm mole prove --feature ${name}`);
    assert.deepEqual(data.touches, feature.touches);
    assert.deepEqual(data.surfaces, feature.surfaces);
  });
  test(`${name}: the map states a contract, not selectors, routes or wire details`, () => {
    const text = readFileSync(join(MAPS, `${name}.md`), "utf8");
    for (const banned of [/\.catalog-/, /\.item-/, /\/api\//, /\/item\//, /pageIndex/, /localStorage/, /aw\.catalog/]) {
      assert.ok(!banned.test(text), `${name}.md mentions ${banned}: that belongs in the surface adapter`);
    }
    assert.ok(/^## Contract$/m.test(text), `${name}.md has no Contract section`);
    assert.equal((text.match(/^## Driving it$/gm) ?? []).length, 1, `${name}.md needs exactly one "Driving it" block`);
  });
  test(`${name}: the feature map index links its map and its proof command`, () => {
    assert.ok(index.includes(`(${name}.md)`), `features/README.md does not link ${name}.md`);
    assert.ok(index.includes(`pnpm mole prove --feature ${name}`), `features/README.md does not show the proof command for ${name}`);
  });
}

test("changed files select the features they touch", () => {
  assert.deepEqual(featuresFor(["src/WebApp/Components/Pages/Item/ItemPage.razor"]), ["product"]);
  assert.deepEqual(featuresFor(["src/WebAppComponents/Catalog/CatalogSearch.razor"]), ["catalog"]);
  assert.deepEqual(featuresFor(["README.md"]), []);
});

test("an unknown feature is refused and no names means all", () => {
  assert.throws(() => selectFeatures(["cart"]), /Unknown feature "cart"/);
  assert.deepEqual(selectFeatures(), Object.keys(FEATURES));
});

test("--surface is validated against the surfaces a feature has", () => {
  assert.deepEqual(surfacesFor(["catalog", "product"]), ["web", "api"]);
  assert.deepEqual(surfacesFor(["catalog"], ["api"]), ["api"]);
  assert.throws(() => surfacesFor(["catalog"], ["ftp"]), /Unknown surface "ftp"/);
  assert.throws(() => selectSurfaces(["api"], ["web"]), /no "api" surface/);
});

// A catalog API with 101 products, 0-based pages, ids on the wire: what the adapter must hide.
const BRANDS = [{ id: 1, brand: "Daybird" }, { id: 2, brand: "Gravitator" }];
const TYPES = [{ id: 1, type: "Footwear" }, { id: 2, type: "Climbing" }];
const products = Array.from({ length: 101 }, (_, i) => ({
  id: i + 1, name: `Product ${String(i + 1).padStart(3, "0")}`, description: `About ${i + 1}`, price: 10 + i, catalogBrand: BRANDS[i % 2], brandId: BRANDS[i % 2].id, typeId: 1,
}));

function fakeCatalog(total = 101) {
  const calls: URL[] = [];
  const fetcher = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const path = url.pathname.replace("/catalog-api/api/catalog", "");
    if (path === "/catalogBrands") return json(BRANDS);
    if (path === "/catalogTypes") return json(TYPES);
    if (path === "/items/facets") {
      const brand = url.searchParams.get("brand");
      const matching = products.filter(p => !brand || p.brandId === Number(brand));
      return json({ brandCounts: BRANDS.map(b => ({ id: b.id, count: products.filter(p => p.brandId === b.id).length })), typeCounts: [{ id: 1, count: matching.length }] });
    }
    const one = path.match(/^\/items\/(\d+)$/);
    if (one) { const found = products.find(p => p.id === Number(one[1])); return found ? json(found) : json({}, 404); }
    if (path === "/items") {
      const index = Number(url.searchParams.get("pageIndex") ?? 0), size = Number(url.searchParams.get("pageSize") ?? 10);
      const brand = url.searchParams.get("brand"), type = url.searchParams.get("type"), name = url.searchParams.get("name");
      const matching = products.filter(p => (!brand || p.brandId === Number(brand)) && (!type || p.typeId === Number(type)) && (!name || p.name.startsWith(name)));
      return json({ pageIndex: index, pageSize: size, count: matching.length === products.length ? total : matching.length, data: matching.slice(index * size, (index + 1) * size) });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetcher, calls };
}

test("api adapter: pages count from 1 for the caller and from 0 on the wire, 9 to a page", async () => {
  const { fetcher, calls } = fakeCatalog();
  const list = await apiSurface("http://bff.test", fetcher).catalog.list({ page: 2 });
  const url = calls.find(call => call.pathname.endsWith("/items"))!;
  assert.equal(url.searchParams.get("pageIndex"), "1");
  assert.equal(url.searchParams.get("pageSize"), String(PAGE_SIZE));
  assert.equal(url.searchParams.get("api-version"), "2.0");
  assert.deepEqual({ surface: list.surface, page: list.page, total: list.total, size: list.items.length }, { surface: "api", page: 2, total: 101, size: 9 });
  assert.equal(list.items[0].id, 10);
});

test("api adapter: filter names become ids, case-insensitively, and an unknown name says what exists", async () => {
  const { fetcher, calls } = fakeCatalog();
  const api = apiSurface("http://bff.test", fetcher);
  const list = await api.catalog.list({ brand: "daybird", type: "Footwear" });
  const url = calls.find(call => call.pathname.endsWith("/items"))!;
  assert.equal(url.searchParams.get("brand"), "1");
  assert.equal(url.searchParams.get("type"), "1");
  assert.equal(list.total, 51);
  await assert.rejects(api.catalog.list({ brand: "Nope" }), (error: Error & { next?: string }) =>
    error.message.startsWith("api:") && /Daybird, Gravitator/.test(error.next ?? ""));
});

test("api adapter: facets are named and every option is listed", async () => {
  const facets = await apiSurface("http://bff.test", fakeCatalog().fetcher).catalog.facets({});
  assert.deepEqual(facets.brands, [{ name: "Daybird", count: 51 }, { name: "Gravitator", count: 50 }]);
  assert.deepEqual(facets.types, [{ name: "Footwear", count: 101 }, { name: "Climbing", count: 0 }]);
});

test("api adapter: a product by id or by name, and an unknown id is a 404", async () => {
  const api = apiSurface("http://bff.test", fakeCatalog().fetcher);
  const byId = await api.product.show(7);
  const byName = await api.product.show("Product 007");
  assert.deepEqual(byName, byId);
  assert.deepEqual(byId.found && { id: byId.id, name: byId.name, brand: byId.brand, price: byId.price }, { id: 7, name: "Product 007", brand: "Daybird", price: 16 });
  assert.deepEqual(await api.product.show(99999), { found: false, surface: "api", status: 404 });
});

test("a failing check names its surface", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeCatalog(100).fetcher; // the API claims 100 products, not the seeded 101
  try {
    const checks: { name: string; pass: boolean }[] = [];
    const kit = { surfaces: ["api"], apiUrl: "http://bff.test", page: undefined, check: (name: string, actual: unknown, expected: unknown) => checks.push({ name, pass: Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected) }) };
    await proveCatalog(kit as unknown as ProofKit);
    const failed = checks.filter(check => !check.pass).map(check => check.name);
    assert.ok(failed.includes("catalog/api: the count covers the whole seed"), `failed: ${failed.join("; ")}`);
    assert.ok(failed.every(name => name.startsWith("catalog/api:")), failed.join("; "));
  } finally { globalThis.fetch = realFetch; }
});

test("an unreachable surface is a finding that names the surface and what to do", async () => {
  const checks: { name: string; actual: unknown; hint?: string }[] = [];
  const kit = { surfaces: ["api"], apiUrl: null, page: undefined, check: (name: string, actual: unknown, _expected: unknown, hint?: string) => checks.push({ name, actual, hint }) };
  await proveCatalog(kit as unknown as ProofKit);
  assert.ok(checks.length > 0);
  assert.ok(checks.every(check => check.name.startsWith("catalog/api:") && String(check.actual).startsWith("api:") && check.hint), JSON.stringify(checks[0]));
});
