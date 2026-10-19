import type { Page } from "@playwright/test";
import type { ProofKit } from "../../proof";
import { apiSurface } from "./api";
import { SurfaceError, type Surface, type SurfaceAdapter } from "./types";
import { webSurface, type WebSurface } from "./web";

export * from "./types";
export { COLD, webSurface, type WebSurface } from "./web";
export { CATALOG_PATH, apiSurface } from "./api";

// A surface's adapter for one run. The API has no browser and needs the proxy URL that `up` recorded; without it every call says so.
export function adapterFor(surface: "web", target: { page: Page; apiUrl: string | null }): WebSurface;
export function adapterFor(surface: Surface, target: { page: Page; apiUrl: string | null }): SurfaceAdapter;
export function adapterFor(surface: Surface, target: { page: Page; apiUrl: string | null }): SurfaceAdapter {
  if (surface === "web") return webSurface(target.page);
  return apiSurface(target.apiUrl);
}

// A surface that cannot be observed is a finding, not a crash: a throw would turn the whole run into "can't tell".
export async function observe<T>(kit: ProofKit, label: string, step: () => Promise<T>): Promise<T | null> {
  try { return await step(); } catch (error) {
    const known = error instanceof SurfaceError;
    kit.check(`${label}: observed`, error instanceof Error ? error.message.split("\n")[0] : String(error), "an observation",
      known ? error.next : "Is the app up and the build fresh? pnpm mole doctor");
    return null;
  }
}
