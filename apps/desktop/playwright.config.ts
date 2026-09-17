import { defineConfig } from "@playwright/test";

// The preview port is overridable so a local service squatting on the
// default (e.g. a manual `python -m http.server` previewing apps/landing)
// cannot silently win reuseExistingServer and serve the wrong app.
const port = Number(process.env.ASTER_SMOKE_PORT || 4173);

export default defineConfig({
  testDir: "./tests",
  testMatch: "renderer-smoke.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  expect: {
    toHaveScreenshot: {
      pathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
    },
  },
  webServer: {
    command: `pnpm build:renderer && pnpm vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: [["list"]],
});
