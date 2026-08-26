import { defineConfig } from "@playwright/test";

/**
 * Live web harness: drives the renderer served by the already-running
 * `pnpm dev` Vite server (127.0.0.1:5173) against the real sidecar. No
 * webServer block — the dev session must already be up; scripts/test-live-web.sh
 * verifies that and injects the sidecar coordinates.
 */
export default defineConfig({
  testDir: "./tests/live",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: process.env.ASTER_LIVE_BASE_URL ?? "http://127.0.0.1:5173",
  },
  reporter: [["list"]],
});
