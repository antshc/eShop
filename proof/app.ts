import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = join(__dirname, "..");
export const DEFAULT_URL = process.env.ESHOP_URL ?? "http://localhost:5045";
const APP_HOST = "src/eShop.AppHost/eShop.AppHost.csproj";
// What a change to the storefront or to the catalog API it reads would touch.
const SOURCE_PATHS = ["src/WebApp", "src/WebAppComponents", "src/Catalog.API"];

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// eShop serves no revision, so derive one from the source: HEAD plus a hash of uncommitted storefront and catalog API changes.
export async function sourceRevision(): Promise<string | null> {
  try {
    const head = git("rev-parse", "--short", "HEAD").trim();
    const diff = git("diff", "HEAD", "--", ...SOURCE_PATHS);
    const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...SOURCE_PATHS).split("\n").filter(Boolean).sort();
    const hash = createHash("sha256").update(diff);
    for (const file of untracked) hash.update(file).update(await readFile(join(ROOT, file)).catch(() => ""));
    return diff || untracked.length ? `${head}+${hash.digest("hex").slice(0, 8)}` : head;
  } catch { return null; }
}

// The catalog API is reached through the mobile-bff proxy, whose port Aspire picks at random. ESHOP_API_URL overrides it.
export function apiUrlFromAspire(): string | null {
  if (process.env.ESHOP_API_URL) return process.env.ESHOP_API_URL;
  try {
    const text = execFileSync("aspire", ["describe", "--format", "Json", "--non-interactive", "--nologo"], {
      cwd: ROOT, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"],
    });
    const described = JSON.parse(text.slice(text.indexOf("{"))) as { resources: { displayName: string; urls?: { name: string; url: string }[] }[] };
    const bff = described.resources.find(resource => resource.displayName === "mobile-bff");
    return bff?.urls?.find(url => url.name === "http")?.url ?? null;
  } catch { return null; }
}

export async function reachable(url: string, timeoutMs = 2000) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" })).status < 500; } catch { return false; }
}

// An SDK that satisfies global.json may exist without being on PATH (a user-level install in ~/.dotnet is common).
// Returns the extra environment to run dotnet with, or throws when no SDK matches.
export function dotnetEnv(): NodeJS.ProcessEnv {
  const roots = [undefined, process.env.DOTNET_ROOT, join(homedir(), ".dotnet")];
  for (const root of roots) {
    const env = root ? { ...process.env, DOTNET_ROOT: root, PATH: `${root}:${process.env.PATH ?? ""}` } : process.env;
    try {
      execFileSync("dotnet", ["--version"], { cwd: ROOT, env, stdio: "ignore" }); // Resolves the SDK global.json asks for.
      return root ? { DOTNET_ROOT: root, PATH: env.PATH } : {};
    } catch { /* try the next place */ }
  }
  throw new Error("No .NET SDK that satisfies global.json was found on PATH, in DOTNET_ROOT, or in ~/.dotnet. Install the SDK version listed in global.json (https://dotnet.microsoft.com/download).");
}

export type StartedApp = { url: string; pid: number; log: string; close(): Promise<void> };

// Runs the Aspire AppHost and waits until the storefront answers. HTTP endpoints keep WebApp on :5045.
export async function startApp(options: { url?: string; log: string; timeoutMs?: number }): Promise<StartedApp> {
  const url = options.url ?? DEFAULT_URL;
  const dotnet = dotnetEnv();
  const child = spawn("dotnet", ["run", "--project", APP_HOST], {
    cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...dotnet, ESHOP_USE_HTTP_ENDPOINTS: "1", ASPIRE_ALLOW_UNSECURED_TRANSPORT: "true" },
  });
  const log = createWriteStream(options.log);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let exited: number | null = null;
  child.once("close", code => { exited = code ?? 1; });

  const close = async () => {
    if (exited === null && child.pid) {
      try { process.kill(-child.pid, "SIGINT"); } catch { /* already gone */ }
      for (let i = 0; i < 150 && exited === null; i++) await new Promise(resolve => setTimeout(resolve, 100));
      if (exited === null) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }
    }
    log.end();
  };

  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`The AppHost exited with code ${exited} before the storefront answered: ${await tail(options.log)} (log: ${options.log})`);
    if (await reachable(url) && await storefrontReady(url)) return { url, pid: child.pid!, log: options.log, close };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await close();
  throw new Error(`The storefront did not answer at ${url} in time. See ${options.log}`);
}

const tail = async (file: string) => (await readFile(file, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).slice(0, 3).join(" ").slice(0, 300) || "no output";

// The home page streams its catalog, so a 200 alone can mean the catalog is not up yet.
async function storefrontReady(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.ok && (await response.text()).includes("catalog-product");
  } catch { return false; }
}
