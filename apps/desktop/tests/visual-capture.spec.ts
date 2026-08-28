import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * One-off visual capture for the UI redesign: boots the same mock DesktopApi
 * as renderer-smoke.spec.ts (extracted from its source so the fixture never
 * drifts), then photographs key surfaces in dark and light themes.
 * Not part of smoke:visual — run manually with playwright.capture.config.ts.
 */

const specSource = fs.readFileSync(path.resolve("tests/renderer-smoke.spec.ts"), "utf8");
const match = specSource.match(/const MOCK_DESKTOP_API = `([\s\S]*?)`;\n/);
if (!match) throw new Error("MOCK_DESKTOP_API not found in renderer-smoke.spec.ts");
const MOCK_DESKTOP_API = new Function("TOTAL_DEPLOYMENTS", "PAGE_SIZE", `return \`${match[1]}\``)(10_000, 100) as string;

const OUT = path.join(process.cwd(), "..", "..", "output", "playwright");

async function connectToDev(page: Page): Promise<void> {
  const option = page.getByTestId("context-option-dev");
  await option.click();
  await option.dblclick();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `capture-${name}.png`), animations: "disabled" });
}

async function goDark(page: Page): Promise<void> {
  await page.getByTestId("theme-menu").click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(MOCK_DESKTOP_API);
});

test("capture workbench surfaces in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await connectToDev(page);
  await expect(page.getByRole("grid", { name: "Resources" })).toBeVisible();
  await shot(page, "workbench-light-1440");

  await goDark(page);
  await shot(page, "workbench-dark-1440");

  // Command palette
  await page.keyboard.press("Meta+k");
  const palette = page.locator(".command-palette-content");
  await expect(palette).toBeVisible();
  await shot(page, "palette-dark-1440");
  await page.keyboard.press("Escape");

  // Detail + YAML
  await page.getByRole("row", { name: /deployments-0/ }).first().click();
  await expect(page.getByRole("tab", { name: "YAML" })).toBeVisible();
  await shot(page, "detail-dark-1440");
  await page.getByRole("tab", { name: "YAML" }).click();
  await expect(page.locator(".resource-yaml-view, .shiki-host").first()).toBeVisible();
  await shot(page, "yaml-dark-1440");

  // Mutation review (YAML edit flow shows the dry-run dialog)
  await page.getByTestId("resource-action-edit").click();
  const editor = page.getByTestId("resource-yaml-editor");
  await expect(editor).toBeVisible();
  await shot(page, "yaml-editor-dark-1440");
  await editor.fill((await editor.inputValue()).replace("  replicas: 2", "  replicas: 5"));
  await page.getByTestId("yaml-prepare-dry-run").click();
  const review = page.getByTestId("mutation-review-dialog");
  await expect(review).toBeVisible();
  await expect(review.locator(".mutation-review-diff")).toContainText("replicas: 5");
  await shot(page, "mutation-review-dark-1440");
});

test("capture logs surface dark", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await connectToDev(page);
  await page.getByRole("row", { name: /deployments-0/ }).first().click();
  await goDark(page);
  await page.getByRole("tab", { name: "Logs" }).click();
  await expect(page.locator(".log-viewer").first()).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, "logs-dark-1440");
});
