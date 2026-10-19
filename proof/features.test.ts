import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FEATURES, featuresFor, selectFeatures } from "./features";

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
