import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["visual-capture.spec.ts", "landing-media-capture.spec.ts"],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    deviceScaleFactor: 2,
  },
  webServer: {
    command: "pnpm build:renderer && pnpm vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  reporter: [["list"]],
});
