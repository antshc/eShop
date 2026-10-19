// Usage: pnpm prove [--url http://localhost:5045] [--feature catalog] [--surface web|api]
// Exit 0 PASS, 1 FAIL, 2 can't tell. Receipts and screenshots go to proof/.runs/.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { apiUrlFromAspire, sourceRevision } from "./app";
import { runProof } from "./proof";
import { proveFeatures, selectFeatures, surfacesFor } from "./prove";

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string", default: process.env.ESHOP_URL ?? "http://localhost:5045" },
    feature: { type: "string", multiple: true },
    surface: { type: "string", multiple: true },
  } });
  const selected = selectFeatures(values.feature);
  const surfaces = surfacesFor(selected, values.surface);
  const apiUrl = surfaces.includes("api") ? apiUrlFromAspire() : null;
  if (surfaces.includes("api") && !apiUrl) throw new Error("The catalog API (mobile-bff) was not found. Run the AppHost, or set ESHOP_API_URL, or prove the web surface only: --surface web");
  const dir = join(__dirname, ".runs");
  await mkdir(dir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const receipt = await runProof(browser, values.url!, proveFeatures(selected), join(dir, `proof-${Date.now()}.png`), sourceRevision, { surfaces, apiUrl });
    receipt.features = selected;
    receipt.surfaces = surfaces;
    await writeFile(join(dir, "last-receipt.json"), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.verdict === "PASS" ? 0 : receipt.verdict === "FAIL" ? 1 : 2;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 2;
});
