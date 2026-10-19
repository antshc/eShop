// The eShop proof: every feature's checks, run in order against one fresh visitor.
// Each feature lives in proof/features/ and has a map in .github/skills/verify-mole/features/.
// `pnpm mole prove --feature catalog` runs one feature; with no flag it runs them all.
import type { Prove } from "./proof";
import { proveFeatures } from "./features";

export { FEATURES, featureNames, featuresFor, proveFeatures, selectFeatures } from "./features";

export const prove: Prove = proveFeatures();
