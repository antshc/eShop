// Usage: pnpm prove [--url http://localhost:5045] [--feature catalog]
// Exit 0 PASS, 1 FAIL, 2 can't tell. Receipts and screenshots go to proof/.runs/.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { sourceRevision } from "./app";
import { runProof } from "./proof";
import { proveFeatures, selectFeatures } from "./prove";

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string", default: process.env.ESHOP_URL ?? "http://localhost:5045" },
    feature: { type: "string", multiple: true },
  } });
  const selected = selectFeatures(values.feature);
  const dir = join(__dirname, ".runs");
  await mkdir(dir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const receipt = await runProof(browser, values.url!, proveFeatures(selected), join(dir, `proof-${Date.now()}.png`), sourceRevision);
    receipt.features = selected;
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
