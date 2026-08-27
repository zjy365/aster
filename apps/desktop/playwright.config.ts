import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "renderer-smoke.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  expect: {
    toHaveScreenshot: {
      pathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
    },
  },
  webServer: {
    command: "pnpm build:renderer && pnpm vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: [["list"]],
});
