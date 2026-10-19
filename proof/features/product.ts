import type { ProofKit } from "../proof";
import { adapterFor, observe, type Surface } from "./surfaces";

const WATCH = "Adventurer GPS Watch";

// Map: .github/skills/verify-mole/features/product.md
// The contract is checked through each surface's adapter; only what a browser visitor alone has sits in the web block.
export async function proveProduct(kit: ProofKit) {
  for (const surface of kit.surfaces) await proveContract(kit, surface);
  if (kit.surfaces.includes("web")) await proveWebOnly(kit);
}

async function proveContract(kit: ProofKit, surface: Surface) {
  const { check } = kit;
  const name = (rule: string) => `product/${surface}: ${rule}`;
  const adapter = adapterFor(surface, { page: kit.page, apiUrl: kit.apiUrl });

  const list = await observe(kit, name("lists the first page"), () => adapter.catalog.list({}));
  const card = list?.items.find(item => item.name === WATCH);
  check(name(`the catalog lists ${WATCH}`), Boolean(card), true, `${WATCH} should be on the first catalog page.`);
  if (!card) return;

  const shown = await observe(kit, name("shows the product"), () => adapter.product.show(card.name));
  if (shown) {
    check(name("a catalog entry opens its product"), shown.found && shown.name === card.name, true, "Opening the product did not show a product with its name.");
    check(name("the product is the entry's id"), shown.found ? shown.id : null, card.id, "The product shown is not the one the catalog entry points to.");
    check(name("the product shows the entry's price"), shown.found ? shown.price : null, card.price,
      "The product price differs from the catalog entry. Compare the exact numbers.");
    check(name("the product has a description"), shown.found && shown.description.length > 0, true, "The product shows no description.");
  }

  const missing = await observe(kit, name("asks for an unknown id"), () => adapter.product.show(99999));
  if (missing) {
    check(name("an unknown id is not found"), missing.found ? "found" : missing.status, 404, "A product that does not exist must answer 404.");
  }
}

// Behavior that exists only in the storefront's pages: the login action, reload, the not-found text, Back to catalog.
async function proveWebOnly(kit: ProofKit) {
  const { check } = kit;
  const web = adapterFor("web", { page: kit.page, apiUrl: kit.apiUrl });

  const shown = await observe(kit, "product/web: opens the product", () => web.product.show(WATCH));
  check("product/web: the page is headed with the product's name", shown?.found ? shown.name : null, WATCH,
    "Clicking the product did not open a detail page with its name as a heading.");
  check("product/web: an anonymous visitor is asked to log in", await web.purchaseAction(), "Log in to purchase",
    "A visitor who is not signed in must not see an add-to-bag button.");

  await observe(kit, "product/web: reloads the product", () => web.reload());
  const reloaded = await observe(kit, "product/web: reads the product after reload", () => web.readProduct());
  check("product/web: the page survives a reload", reloaded?.found ? { name: reloaded.name, price: reloaded.price } : null,
    shown?.found ? { name: shown.name, price: shown.price } : "the product before the reload",
    "After a reload the product page lost its name or price.");

  await observe(kit, "product/web: opens an unknown id", () => web.product.show(99999));
  check("product/web: an unknown id says so", await web.notFoundMessage(), "Sorry, we couldn't find any such product.",
    "The not-found page should tell the visitor the product does not exist.");

  const back = await observe(kit, "product/web: goes back to the catalog", () => web.backToCatalog("Daybird"));
  check("product/web: Back to catalog keeps the filter", back?.backUrl, back?.filteredUrl,
    "Back to catalog should return to the filtered list the visitor came from.");
}
