import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Captures the product screenshots shipped on the landing site
 * (apps/landing/public/media). Boots the same mock DesktopApi as
 * renderer-smoke.spec.ts (extracted from its source so the fixture never
 * drifts), switches to the dark theme, and photographs the workbench and
 * command palette at 1280×800 @2x (2560×1600) — the size lib/content.ts
 * declares. Run manually: pnpm playwright test -c playwright.capture.config.ts
 */

const specSource = fs.readFileSync(path.resolve("tests/renderer-smoke.spec.ts"), "utf8");
const match = specSource.match(/const MOCK_DESKTOP_API = `([\s\S]*?)`;\n/);
if (!match) throw new Error("MOCK_DESKTOP_API not found in renderer-smoke.spec.ts");
const MOCK_DESKTOP_API = new Function("TOTAL_DEPLOYMENTS", "PAGE_SIZE", `return \`${match[1]}\``)(10_000, 100) as string;

const MEDIA = path.join(process.cwd(), "..", "landing", "public", "media");

async function connectToDev(page: Page): Promise<void> {
  const option = page.getByTestId("context-option-dev");
  await option.click();
  await option.dblclick();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function goDark(page: Page): Promise<void> {
  await page.getByTestId("theme-menu").click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(MOCK_DESKTOP_API);
});

test("capture landing media in dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);
  await goDark(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  await expect(grid).toBeVisible();
  // Let the virtual table settle past its first page before shooting.
  await expect(grid.getByRole("row").nth(20)).toBeVisible();
  await page.screenshot({
    path: path.join(MEDIA, "aster-resources.png"),
    animations: "disabled",
  });

  await page.keyboard.press("Meta+k");
  const palette = page.locator(".command-palette-content");
  await expect(palette).toBeVisible();
  await page.screenshot({
    path: path.join(MEDIA, "aster-command-palette.png"),
    animations: "disabled",
  });
});
