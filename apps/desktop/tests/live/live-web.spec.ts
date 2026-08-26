/**
 * Live web verification: the real renderer (Vite dev server) driven by
 * Playwright in Chromium, backed by the real running sidecar and cluster via
 * the shim/proxy pair in support.ts. Covers the three GUI checks that were
 * too slow under computer-use automation:
 *   1. namespace scope picked on one view carries over to the Helm view;
 *   2. an open Helm release detail closes when the namespace scope switches;
 *   3. the upgrade dialog's chart-defaults pane renders real chart values.
 * Read-only against the cluster: no mutation endpoints are exercised.
 */
import { expect, test, type Page } from "@playwright/test";
import { installLiveCore } from "./support";

const CONTEXT_ID = process.env.ASTER_LIVE_CONTEXT ?? "staging-test-admin@staging-usw";
const NAMESPACE = process.env.ASTER_LIVE_NAMESPACE ?? "brain-system-skills";
const RELEASE = process.env.ASTER_LIVE_RELEASE ?? "brain-system-skills";

async function connect(page: Page): Promise<void> {
  await page.goto("/");
  const option = page.getByTestId(`context-option-${CONTEXT_ID}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await option.dblclick();
  await expect(page.getByTestId("workbench-shell")).toBeVisible({ timeout: 30_000 });
}

async function pickNamespace(page: Page, name: string): Promise<void> {
  await page.getByTestId("namespace-select").click();
  const filter = page.getByTestId("namespace-filter");
  await filter.fill(name);
  await page.locator(".namespace-combobox-item", { hasText: name }).first().click();
}

async function openHelmRelease(page: Page): Promise<void> {
  await page.getByTestId("tool-nav-helm").click();
  const row = page.getByTestId(`helm-release-${RELEASE}`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("helm-detail")).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await installLiveCore(page);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("namespace scope carries over from another view to Helm", async ({ page }) => {
  await connect(page);
  await pickNamespace(page, NAMESPACE);
  await expect(page.getByTestId("namespace-select")).toContainText(NAMESPACE);

  await page.getByTestId("tool-nav-helm").click();
  const view = page.getByTestId("helm-view");
  await expect(view).toBeVisible();
  // The picker must still say the carried-over namespace, and the list must
  // contain the release that lives in it.
  await expect(page.getByTestId("namespace-select")).toContainText(NAMESPACE);
  await expect(view.getByTestId(`helm-release-${RELEASE}`)).toBeVisible({ timeout: 30_000 });
});

test("helm release detail closes when the namespace scope switches", async ({ page }) => {
  await connect(page);
  await pickNamespace(page, NAMESPACE);
  await openHelmRelease(page);

  await pickNamespace(page, "All namespaces");
  await expect(page.getByTestId("helm-detail")).toHaveCount(0);
  const view = page.getByTestId("helm-view");
  await expect(view.getByTestId("helm-table")).toBeVisible();
  // The release is still reachable from the all-namespaces list.
  await expect(view.getByTestId(`helm-release-${RELEASE}`)).toBeVisible({ timeout: 30_000 });
});

test("upgrade dialog renders chart defaults in the left pane", async ({ page }) => {
  await connect(page);
  await pickNamespace(page, NAMESPACE);
  await openHelmRelease(page);

  await page.getByTestId("helm-upgrade").click();
  const dialog = page.getByTestId("helm-upgrade-dialog");
  await expect(dialog).toBeVisible();
  const defaults = page.getByTestId("helm-upgrade-defaults");
  await expect(defaults).toBeVisible();
  await expect(defaults).not.toContainText("ships no default values");
  await expect(defaults).toContainText("replicas");
  // Read-only check: close without submitting.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
