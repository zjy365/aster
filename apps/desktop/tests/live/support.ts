/**
 * Node-side support for the live web harness: bundles tests/live/shim.ts into
 * an init script and installs a same-origin /__core__ proxy that forwards to
 * the real running sidecar with its bearer token. The token comes from
 * ASTER_LIVE_TOKEN (populated by scripts/test-live-web.sh from the sidecar
 * process environment) and stays in the Playwright Node process — page
 * JavaScript only ever sees same-origin requests.
 */
import { buildSync } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

let cachedShim: string | undefined;

export function shimScript(): string {
  if (!cachedShim) {
    const result = buildSync({
      entryPoints: [path.join(here, "shim.ts")],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    });
    cachedShim = result.outputFiles[0].text;
  }
  return cachedShim;
}

function liveCoreCredentials(): { base: string; token: string } {
  const base = process.env.ASTER_LIVE_CORE_URL;
  const token = process.env.ASTER_LIVE_TOKEN;
  if (!base || !token) {
    throw new Error("live web tests need ASTER_LIVE_CORE_URL and ASTER_LIVE_TOKEN; run via scripts/test-live-web.sh");
  }
  return { base, token };
}

/**
 * Mutation endpoints the live harness refuses to proxy by default. The live
 * suite is read-only against the cluster; a future test that genuinely needs
 * a mutation must opt in with ASTER_LIVE_ALLOW_MUTATIONS=1.
 */
const MUTATION_PATHS = new Set([
  "/v1/resources/mutate",
  "/v1/helm/releases/uninstall",
  "/v1/helm/releases/rollback",
  "/v1/helm/releases/upgrade",
  "/v1/sources/rename",
  "/v1/pods/exec",
  "/v1/pods/portforward",
  "/v1/pods/portforward/stop",
]);

export async function installLiveCore(page: Page): Promise<void> {
  const { base, token } = liveCoreCredentials();
  const allowMutations = process.env.ASTER_LIVE_ALLOW_MUTATIONS === "1";
  await page.addInitScript(shimScript());
  await page.route("**/__core__/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/__core__/, "");
    if (!allowMutations && MUTATION_PATHS.has(path)) {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "live_read_only", message: `live web harness is read-only; ${path} requires ASTER_LIVE_ALLOW_MUTATIONS=1` } }),
      });
      return;
    }
    const target = `${base}${path}${url.search}`;
    const response = await fetch(target, {
      method: request.method(),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: request.method() === "POST" ? request.postData() ?? "{}" : undefined,
    });
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: await response.text(),
    });
  });
}
