import type { Prove } from "../proof";
import { proveCatalog } from "./catalog";
import { proveProduct } from "./product";

export type Feature = {
  prove: Prove;
  /** Repo-relative path prefixes whose changes this feature must be re-proved for. */
  touches: string[];
};

// Each key has a map at .github/skills/verify-mole/features/<key>.md. features.test.ts keeps the two in step.
export const FEATURES: Record<string, Feature> = {
  catalog: {
    prove: proveCatalog,
    touches: ["src/WebApp/Components/Pages/Catalog/", "src/WebAppComponents/Catalog/", "src/WebApp/wwwroot/js/catalog-sort.js", "src/Catalog.API/"],
  },
  product: {
    prove: proveProduct,
    touches: ["src/WebApp/Components/Pages/Item/", "src/WebApp/wwwroot/js/image-zoom.js", "src/WebAppComponents/Item/", "src/Catalog.API/"],
  },
};

export const featureNames = () => Object.keys(FEATURES);

// No names means every feature. An unknown name is the caller's mistake, so say what exists.
export function selectFeatures(names: string[] = []): string[] {
  const unknown = names.filter(name => !(name in FEATURES));
  if (unknown.length) throw new Error(`Unknown feature "${unknown.join('", "')}". Features: ${featureNames().join(", ")}`);
  return names.length ? [...new Set(names)] : featureNames();
}

export function proveFeatures(names: string[] = []): Prove {
  const selected = selectFeatures(names);
  return async kit => {
    for (const name of selected) await FEATURES[name].prove(kit);
  };
}

// The features a set of changed files belongs to.
export function featuresFor(files: string[]): string[] {
  return featureNames().filter(name => FEATURES[name].touches.some(prefix => files.some(file => file.startsWith(prefix))));
}
