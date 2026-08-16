import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "playwright";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDir = path.join(repoRoot, "output", "playwright");
const mode = process.env.ASTER_E2E_MODE === "real" ? "real" : "fixture";
const pickerOnly = process.env.ASTER_E2E_SCOPE === "context-picker";
const workbenchTheme = process.env.ASTER_E2E_THEME === "dark" ? "dark" : "light";
const themeSuffix = workbenchTheme === "dark" ? "-dark" : "";
const execFileAsync = promisify(execFile);
const executable = findPackagedExecutable();
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aster-playwright-"));
const userData = path.join(temporaryRoot, "desktop-data");
await fs.mkdir(outputDir, { recursive: true });

const fixture = mode === "fixture" ? await startKubernetesFixture(temporaryRoot) : undefined;
// Serves an update feed with a newer version so the update notice can be
// captured end-to-end (check → available → dismiss) against the real
// electron-updater client in the packaged app.
const updaterFixture = mode === "fixture" ? await startUpdaterFixture() : undefined;
const consoleErrors = [];
const launchStartedAt = performance.now();
const app = await electron.launch({
  executablePath: executable,
  env: {
    ...process.env,
    ASTER_DESKTOP_USER_DATA: userData,
    ...(fixture ? {
      KUBECONFIG: fixture.kubeconfig,
      // A second source file: proves multi-source merging end to end.
      ASTER_KUBECONFIG_SOURCES: fixture.extraKubeconfig,
    } : {}),
    ...(updaterFixture ? { ASTER_UPDATER_FEED: updaterFixture.url } : {}),
  },
});

const result = {
  mode,
  executable,
  clusterScreenshot: path.join(outputDir, `aster-${mode}-clusters-900x640.png`),
  focusedClusterScreenshot: path.join(outputDir, `aster-${mode}-clusters-focused-900x640.png`),
  darkClusterScreenshot: path.join(outputDir, `aster-${mode}-clusters-dark-900x640.png`),
  nativeClusterScreenshot: path.join(outputDir, `aster-${mode}-clusters-native-900x640.png`),
  nativeDarkClusterScreenshot: path.join(outputDir, `aster-${mode}-clusters-native-dark-900x640.png`),
  compactScreenshot: path.join(outputDir, `aster-${mode}-resources-900x640${themeSuffix}.png`),
  namespacePopupScreenshot: path.join(outputDir, `aster-${mode}-namespace-popup-900x640${themeSuffix}.png`),
  screenshot: path.join(outputDir, `aster-${mode}-resources-1280x800${themeSuffix}.png`),
  paletteScreenshot: path.join(outputDir, `aster-${mode}-command-palette-900x640${themeSuffix}.png`),
  paletteWideScreenshot: path.join(outputDir, `aster-${mode}-command-palette-1280x800${themeSuffix}.png`),
  yamlScreenshot: path.join(outputDir, `aster-${mode}-yaml-900x640${themeSuffix}.png`),
  yamlWideScreenshot: path.join(outputDir, `aster-${mode}-yaml-1280x800${themeSuffix}.png`),
  createScreenshot: path.join(outputDir, `aster-${mode}-create-resource-1280x800${themeSuffix}.png`),
  createCompactScreenshot: path.join(outputDir, `aster-${mode}-create-resource-900x640${themeSuffix}.png`),
  customResourceScreenshot: path.join(outputDir, `aster-${mode}-custom-resource-1280x800${themeSuffix}.png`),
  customResourceCompactScreenshot: path.join(outputDir, `aster-${mode}-custom-resource-900x640${themeSuffix}.png`),
  paletteSearchScreenshot: path.join(outputDir, `aster-${mode}-palette-search-900x640${themeSuffix}.png`),
  settingsScreenshot: path.join(outputDir, `aster-${mode}-settings-900x640${themeSuffix}.png`),
  sidebarRailScreenshot: path.join(outputDir, `aster-${mode}-sidebar-rail-1280x800${themeSuffix}.png`),
  compactDetailScreenshot: path.join(outputDir, `aster-${mode}-deployment-900x640${themeSuffix}.png`),
  detailScreenshot: path.join(outputDir, `aster-${mode}-deployment-1280x800${themeSuffix}.png`),
  ...(updaterFixture ? {
    updateNoticeScreenshot: path.join(outputDir, `aster-${mode}-update-notice-900x640${themeSuffix}.png`),
  } : {}),
  ...(fixture ? {
    diffScreenshot: path.join(outputDir, `aster-fixture-dry-run-diff${themeSuffix}.png`),
    diagnosticsScreenshot: path.join(outputDir, `aster-fixture-pod-diagnostics${themeSuffix}.png`),
  } : {}),
  performance: {},
  viewportEvidence: [],
  warnings: [],
};

try {
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(15_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("crash", () => consoleErrors.push("renderer process crashed"));

  await page.getByTestId("context-picker").waitFor();
  await page.locator('.context-picker-core-status[data-state="ready"]').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-context-option]").length > 0, undefined, { timeout: 20_000 });
  result.performance.launchToClusterPickerMs = roundedElapsed(launchStartedAt);

  const launchThemeSource = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
  assert.equal(launchThemeSource, "system", `launch nativeTheme.themeSource was ${launchThemeSource} instead of system`);
  const systemAppearance = await page.evaluate(() => ({
    applied: document.documentElement.dataset.theme,
    osDark: matchMedia("(prefers-color-scheme: dark)").matches,
  }));
  assert.equal(systemAppearance.applied, systemAppearance.osDark ? "dark" : "light", "system theme did not resolve to the OS appearance");

  result.viewportEvidence.push(await setElectronViewport(app, page, 900, 640, "cluster-picker"));

  if (updaterFixture) {
    const notice = page.getByTestId("update-notice");
    await notice.waitFor({ timeout: 20_000 });
    await notice.filter({ hasText: "9.9.9" }).waitFor({ timeout: 5_000 });
    assert.equal(
      await page.getByTestId("update-link").getAttribute("href"),
      "https://github.com/zjy365/aster/releases/tag/v9.9.9",
      "update notice changelog link points at the wrong release",
    );
    const noticeText = await notice.innerText();
    assert.ok(noticeText.includes("Fixture release notes"), `update notice lost its release notes: ${noticeText}`);
    assert.ok(!/[<>]|&amp;/.test(noticeText), `update notes were not stripped to plain text: ${noticeText}`);
    const noticeBox = await notice.boundingBox();
    assert.ok(
      noticeBox && noticeBox.x >= 0 && noticeBox.y >= 0
        && noticeBox.x + noticeBox.width <= 901 && noticeBox.y + noticeBox.height <= 641,
      `update notice overflows the 900x640 viewport: ${JSON.stringify(noticeBox)}`,
    );
    await page.screenshot({ path: result.updateNoticeScreenshot, animations: "disabled" });
    result.updateNotice = { version: "9.9.9", dismissed: false };
    await page.getByTestId("update-dismiss").click();
    await notice.waitFor({ state: "detached", timeout: 5_000 });
    result.updateNotice.dismissed = true;
    progress("update notice verified and dismissed");
  }

  const contextCount = await page.getByRole("option").count();
  assert.ok(contextCount > 0, `${mode} kubeconfig exposes no contexts`);
  result.clusterPicker = { search: false, layoutToggle: false, connect: false, roundTrip: false, ...(fixture ? { requestsBeforeConnect: fixture.requests.length } : {}) };
  const pickerLayout = await readLayout(page);
  assert.ok(pickerLayout.contextPicker, `cluster picker is missing: ${JSON.stringify(pickerLayout)}`);
  assertNoViewportOverflow(pickerLayout, "cluster picker at 900x640");
  assertPickerRegionsVisible(pickerLayout, "cluster picker at 900x640");
  if (fixture) {
    // Multi-source: the extra kubeconfig file contributes its own context
    // under a labeled group, without touching the primary chain.
    await page.getByTestId("context-option-fixture-extra").waitFor({ state: "visible", timeout: 10_000 });
    const groupLabels = await page.locator(".context-source-label").allTextContents();
    assert.ok(groupLabels.some((label) => label.includes("extra-cluster.yaml")), `source group label missing: ${JSON.stringify(groupLabels)}`);
    // Settings dialog: default chain entry is present and not removable.
    await page.getByTestId("context-picker-settings").click();
    await page.getByTestId("settings-dialog").waitFor();
    await page.locator(".settings-source-item").filter({ hasText: "~/.kube/config" }).waitFor();
    await page.screenshot({ path: result.settingsScreenshot, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-dialog").waitFor({ state: "detached" });
    result.clusterPicker.multiSource = true;
  }
  if (fixture) assert.equal(fixture.requests.length, 0, "cluster APIs were called before the user connected a context");
  const contextSearch = page.getByTestId("context-picker-search");
  await contextSearch.fill("__missing_context__");
  assert.equal(await page.getByRole("option").count(), 0, "context search did not filter the picker");
  await contextSearch.fill("");
  result.clusterPicker.search = true;
  await page.getByTestId("context-layout-list").click();
  await page.getByTestId("context-picker-list").filter({ has: page.locator('[data-context-option]') }).waitFor();
  assert.equal(await page.getByTestId("context-picker-list").getAttribute("data-layout"), "list", "context list did not enter list layout");
  await page.getByTestId("context-layout-grid").click();
  assert.equal(await page.getByTestId("context-picker-list").getAttribute("data-layout"), "grid", "context list did not return to grid layout");
  result.clusterPicker.layoutToggle = true;
  assert.equal(await page.locator(".context-picker-core-status").innerText(), "Core ready", "context picker mislabels local core readiness as cluster connectivity");
  const pickerRegressions = [];
  await contextSearch.focus();
  const searchFocusAppearance = await contextSearch.evaluate((input) => {
    const field = input.closest(".context-search");
    const inputStyle = getComputedStyle(input);
    const fieldStyle = field ? getComputedStyle(field) : undefined;
    return {
      inputOutlineStyle: inputStyle.outlineStyle,
      inputOutlineWidth: inputStyle.outlineWidth,
      inputBoxShadow: inputStyle.boxShadow,
      fieldBorderColor: fieldStyle?.borderColor,
      fieldBoxShadow: fieldStyle?.boxShadow,
    };
  });
  if (searchFocusAppearance.inputOutlineStyle !== "none" && searchFocusAppearance.inputOutlineWidth !== "0px") {
    pickerRegressions.push(`search input draws a second inner focus outline: ${JSON.stringify(searchFocusAppearance)}`);
  }
  if (!searchFocusAppearance.fieldBoxShadow || searchFocusAppearance.fieldBoxShadow === "none") {
    pickerRegressions.push(`search composite field lost its outer focus ring: ${JSON.stringify(searchFocusAppearance)}`);
  }
  result.clusterPicker.searchFocus = searchFocusAppearance;
  if (await page.locator(".context-picker-titlebar .context-picker-wordmark").count()) {
    pickerRegressions.push("Aster branding is rendered in the macOS titlebar beside the traffic lights");
  }
  const pickerThemeToggle = page.getByTestId("context-picker-theme-toggle");
  // The toggle cycles system → light → dark → system, so reaching a target
  // effective theme can take up to three clicks.
  const cyclePickerTheme = async (target) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) === target) return;
      await pickerThemeToggle.click();
      await page.waitForTimeout(150);
    }
    await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, target);
  };
  await cyclePickerTheme("light");
  const lightAppearance = await readAppearance(page);
  await cyclePickerTheme("dark");
  const darkAppearance = await readAppearance(page);
  if (lightAppearance.windowBackground === darkAppearance.windowBackground || lightAppearance.textColor === darkAppearance.textColor) {
    pickerRegressions.push(`dark theme does not change computed renderer colors: ${JSON.stringify({ lightAppearance, darkAppearance })}`);
  }
  const nativeThemeSource = await waitForNativeTheme(app, "dark");
  if (nativeThemeSource !== "dark") pickerRegressions.push(`Electron nativeTheme stayed ${nativeThemeSource} after selecting dark`);
  await page.screenshot({ path: result.darkClusterScreenshot, animations: "disabled" });
  await captureNativeWindow(app, result.nativeDarkClusterScreenshot);
  await cyclePickerTheme("light");
  result.clusterPicker.appearance = true;
  await contextSearch.focus();
  await page.screenshot({ path: result.focusedClusterScreenshot, animations: "disabled" });
  await page.screenshot({ path: result.clusterScreenshot, animations: "disabled" });
  await captureNativeWindow(app, result.nativeClusterScreenshot);
  assert.deepEqual(pickerRegressions, [], `context picker visual regressions:\n${pickerRegressions.join("\n")}`);

  if (pickerOnly) {
    const pickerEvidence = {
      ...result,
      contextCount,
      pickerLayout: withoutBodyText(await readLayout(page)),
      lightAppearance,
      darkAppearance,
      nativeThemeSource,
      consoleErrors,
    };
    await fs.writeFile(path.join(outputDir, `aster-${mode}-context-picker.json`), `${JSON.stringify(pickerEvidence, null, 2)}\n`);
    console.log(JSON.stringify(pickerEvidence, null, 2));
  } else {
  const preferredContext = fixture
    ? page.getByTestId("context-option-fixture-fast")
    : page.locator('[data-context-option][data-current="true"]').or(page.getByRole("option").first()).first();
  const connectedContextId = await preferredContext.getAttribute("data-context-id");
  assert.ok(connectedContextId, "selected context does not expose a stable context id");
  await preferredContext.click();
  const connect = page.getByTestId("context-picker-connect");
  assert.equal(await connect.isDisabled(), false, "Connect stayed disabled after selecting a context");
  await connect.click();
  result.clusterPicker.connect = true;

  await page.getByTestId("workbench-shell").waitFor();
  await waitForResourceLoad(page);
  result.performance.launchToFirstPageMs = roundedElapsed(launchStartedAt);

  // Namespace combobox: opens with a search input, filters the list, and
  // Escape closes it without disturbing the current selection.
  await page.getByTestId("namespace-select").click();
  const namespaceFilter = page.getByTestId("namespace-filter");
  await namespaceFilter.waitFor({ state: "visible" });
  const namespaceItems = () => [...document.querySelectorAll(".namespace-combobox-item")].map((el) => el.textContent?.trim() ?? "");
  await page.waitForFunction(() => document.querySelectorAll(".namespace-combobox-item").length === 2);
  assert.deepEqual(await page.evaluate(namespaceItems), ["All namespaces", "fast-ns"], "namespace popup did not list all namespaces initially");
  await namespaceFilter.fill("fast");
  await page.waitForFunction(() => document.querySelectorAll(".namespace-combobox-item").length === 1);
  assert.deepEqual(await page.evaluate(namespaceItems), ["fast-ns"], "namespace filter did not narrow the list");
  await page.screenshot({ path: result.namespacePopupScreenshot, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".namespace-combobox-item").length === 0);
  assert.equal((await page.getByTestId("namespace-select").innerText()).trim(), "fast-ns", "namespace selection changed after closing the filter popup");

  if (workbenchTheme === "dark") {
    await selectWorkbenchTheme(page, app, "Dark");
  }

  const layout = await readLayout(page);
  assert.equal(layout.title, "Aster", `unexpected title: ${layout.title}`);
  assert.ok(layout.sourceList && layout.mainWorkspace && layout.resourcePane, `primary workbench regions are missing: ${JSON.stringify({ layout, body: layout.bodyText.slice(0, 500) })}`);
  assert.equal(layout.resourceDetail, undefined, "resource detail rendered before selecting a row");
  assertNoViewportOverflow(layout, "resource list at 900x640");
  assert.doesNotMatch(layout.bodyText, /object could not be cloned|unsupported resource|core is not ready/i, "an integration error is visible");

  result.clusterPicker.roundTrip = await assertClusterPickerRoundTrip(page, connectedContextId);
  await page.screenshot({ path: result.compactScreenshot, animations: "disabled" });

  // Command palette: open, filter, and execute two commands at 900x640.
  await page.keyboard.press("Meta+K");
  await page.getByTestId("command-palette").waitFor();
  await page.getByTestId("command-palette-input").fill("configmap");
  await page.getByTestId("command-item-kind:configmaps").waitFor();
  await assertPaletteWithinViewport(page, "command palette at 900x640");
  await page.screenshot({ path: result.paletteScreenshot, animations: "disabled" });
  await page.getByTestId("command-item-kind:configmaps").click();
  await page.waitForFunction(() => document.querySelector(".pane-heading h1")?.textContent === "ConfigMaps", undefined, { timeout: 10_000 });
  await page.keyboard.press("Meta+K");
  await page.getByTestId("command-palette").waitFor();
  await page.getByTestId("command-palette-input").fill("deployments");
  await page.getByTestId("command-item-kind:deployments").click();
  await page.waitForFunction(() => document.querySelector(".pane-heading h1")?.textContent === "Deployments", undefined, { timeout: 10_000 });
  await waitForResourceLoad(page);

  // Server-backed search through the palette: query, pick a result, land on its detail.
  await page.keyboard.press("Meta+K");
  await page.getByTestId("command-palette").waitFor();
  await page.getByTestId("command-palette-input").fill("fixture-set");
  await page.getByTestId("command-item-search:/v1/configmaps:fast-ns/fixture-settings").waitFor({ timeout: 15_000 });
  await page.screenshot({ path: result.paletteSearchScreenshot, animations: "disabled" });
  await page.getByTestId("command-item-search:/v1/configmaps:fast-ns/fixture-settings").click();
  await page.getByTestId("resource-detail-view").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".resource-detail-breadcrumb")?.textContent?.includes("ConfigMap"), undefined, { timeout: 15_000 });
  await page.getByTestId("resource-detail-back").click();
  await page.locator(".resource-pane").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("resource-nav-deployments").click();
  await waitForResourceLoad(page);
  result.commandPalette = { openFilterExecute: true, serverSearch: true };

  result.viewportEvidence.push(await setElectronViewport(app, page, 1280, 800, "resource-list"));
  assertNoViewportOverflow(await readLayout(page), "resource list at 1280x800");
  await page.keyboard.press("Meta+K");
  await page.getByTestId("command-palette").waitFor();
  await assertPaletteWithinViewport(page, "command palette at 1280x800");
  await page.screenshot({ path: result.paletteWideScreenshot, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByTestId("command-palette").waitFor({ state: "detached" });

  if (mode === "fixture") {
    progress("10k fixture start");
    Object.assign(result.performance, await assertVirtualizedTenThousandRows(page));
    progress("10k fixture complete");
    result.performance.contextRaceMs = await assertControlledContextRace(page, fixture);
    progress("context race complete");
  } else {
    await assertRealContextSwitch(page, connectedContextId);
  }

  await page.screenshot({ path: result.screenshot, animations: "disabled" });
  result.sidebar = await assertSidebarCollapseAndRail(page, result);
  result.performance.detailLoadMs = await clickDeploymentAndAssertSanitizedYaml(page, fixture);
  progress("detail, Events and Related complete");
  result.viewportEvidence.push(await setElectronViewport(app, page, 900, 640, "resource-detail"));
  const compactDetailLayout = await readLayout(page);
  assert.ok(compactDetailLayout.resourceDetail, "full resource detail view is missing at 900x640");
  assertNoViewportOverflow(compactDetailLayout, "resource detail at 900x640");
  await page.screenshot({ path: result.compactDetailScreenshot, animations: "disabled" });
  await captureHighlightedYaml(page, result.yamlScreenshot);
  result.viewportEvidence.push(await setElectronViewport(app, page, 1280, 800, "resource-detail"));
  assertNoViewportOverflow(await readLayout(page), "resource detail at 1280x800");
  await page.screenshot({ path: result.detailScreenshot, animations: "disabled" });
  await captureHighlightedYaml(page, result.yamlWideScreenshot);
  let workflows;
  if (mode === "fixture") {
    const workflowResult = await assertFixtureWorkflows(page, fixture, result.diffScreenshot, result.diagnosticsScreenshot);
    progress("mutation and diagnostics workflows complete");
    result.performance.workflowsMs = workflowResult.elapsedMs;
    workflows = workflowResult.workflows;
  } else {
    await goBackToResourceList(page);
  }
  assert.deepEqual(consoleErrors, [], `renderer errors:\n${consoleErrors.join("\n")}`);

  await waitForResourceLoad(page);
  const finalMetrics = await readLayout(page);
  const evidence = {
    ...result,
    contextCount,
    selectedContext: mode === "fixture" ? connectedContextId : "redacted-real-context",
    selectedNamespace: mode === "fixture" ? await page.getByTestId("namespace-select").textContent() : "redacted-real-namespace",
    renderedResourceRows: await page.locator(".table-row").count(),
    loadedSummary: await page.locator(".resource-summary span").first().textContent(),
    ...(fixture ? { workflows, fixtureRequestSummary: summarizeFixtureRequests(fixture.requests) } : {}),
    layout: withoutBodyText(finalMetrics),
    consoleErrors,
  };
  await fs.writeFile(path.join(outputDir, `aster-${mode}${themeSuffix}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  }
} catch (error) {
  if (fixture) console.error("Fixture requests before failure:", JSON.stringify(fixture.requests.slice(-20), null, 2));
  try {
    await page.screenshot({ path: path.join(outputDir, `aster-${mode}${themeSuffix}-failure.png`) });
    const state = await page.evaluate(() => ({
      picker: Boolean(document.querySelector('[data-testid="context-picker"]')),
      shell: Boolean(document.querySelector('[data-testid="workbench-shell"]')),
      heading: document.querySelector(".pane-heading h1")?.textContent || "",
      body: document.body.innerText.slice(0, 400),
    }));
    console.error("Failure UI state:", JSON.stringify(state, null, 2));
  } catch { /* page may already be gone */ }
  throw error;
} finally {
  await app.close();
  await fixture?.close();
  await updaterFixture?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

async function readAppearance(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      theme: document.documentElement.dataset.theme,
      windowToken: root.getPropertyValue("--window").trim(),
      textToken: root.getPropertyValue("--text").trim(),
      windowBackground: body.backgroundColor,
      textColor: body.color,
    };
  });
}

async function waitForNativeTheme(electronApp, expected) {
  const deadline = Date.now() + 2_000;
  let actual = "";
  while (Date.now() < deadline) {
    actual = await electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
    if (actual === expected) return actual;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return actual;
}

async function captureNativeWindow(electronApp, screenshotPath) {
  if (process.platform !== "darwin") return;
  const mediaSourceId = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Electron BrowserWindow is unavailable");
    return window.getMediaSourceId();
  });
  const windowId = mediaSourceId.split(":")[1];
  assert.match(windowId || "", /^\d+$/, `invalid Electron media source id: ${mediaSourceId}`);
  try {
    await execFileAsync("/usr/sbin/screencapture", ["-x", "-l", windowId, screenshotPath]);
  } catch (error) {
    // macOS screen recording permission is unavailable in some automation
    // environments; page-level screenshots still capture the full surface.
    result.warnings.push(`native window capture skipped: ${error.message}`);
  }
}

async function waitForResourceLoad(page) {
  await page.waitForFunction(() => {
    const state = document.querySelector(".table-state strong")?.textContent || "";
    return !state.includes("Loading resources");
  }, undefined, { timeout: 40_000 });
  const error = await page.locator(".table-state.error").textContent().catch(() => "");
  assert.equal(error, "", `resource list failed: ${error}`);
}

async function assertClusterPickerRoundTrip(page, connectedContext) {
  await page.getByTestId("change-context").click();
  await page.getByTestId("context-picker").waitFor();
  const selectedCard = page.locator('[data-context-option][data-selected="true"]');
  assert.equal(await selectedCard.count(), 1, "returning to the picker did not preserve the connected context");
  assert.equal(await selectedCard.getAttribute("data-context-id"), connectedContext, "picker selected a different context on return");
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await waitForResourceLoad(page);
  return true;
}

async function captureHighlightedYaml(page, screenshotPath) {
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  const view = page.getByTestId("resource-yaml-view");
  await view.locator(".shiki").first().waitFor({ state: "attached", timeout: 15_000 });
  const box = await view.boundingBox();
  assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= (await page.evaluate(() => innerWidth)), "highlighted YAML overflows the viewport");
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
}

async function clickDeploymentAndAssertSanitizedYaml(page, fixture) {
  const startedAt = performance.now();
  const firstRow = page.locator(".table-row").first();
  await firstRow.waitFor({ state: "visible", timeout: 30_000 });
  const deploymentName = (await firstRow.locator(".primary-cell").textContent())?.trim();
  assert.ok(deploymentName, "no Deployment row was available for the detail check");
  await firstRow.click();
  await page.getByTestId("resource-detail-view").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  const yaml = page.getByTestId("resource-yaml-view").locator("code");
  await yaml.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("resource-yaml-view").locator(".shiki").first().waitFor({ state: "attached", timeout: 15_000 });
  const value = await yaml.textContent();
  assert.ok(value?.includes("kind: Deployment"), `resource detail did not return Deployment YAML for ${deploymentName}`);
  assert.doesNotMatch(value || "", /managedFields\s*:/, "resource detail YAML exposes metadata.managedFields");
  assert.doesNotMatch(value || "", /kubectl\.kubernetes\.io\/last-applied-configuration/, "resource detail YAML exposes last-applied configuration");
  if (fixture) {
    await waitUntil(() => fixture.requests.some((request) => request.resource === "events"), 5_000, "selected resource Events request did not start");
    await page.getByRole("tab", { name: /^Events/ }).click();
    assert.match(await page.getByTestId("resource-events").innerText(), /Fixture image pulled/, "Events tab did not render fixture event");
    await page.getByRole("tab", { name: /^Related/ }).click();
    const relatedText = await page.getByTestId("resource-related").innerText();
    assert.match(relatedText, /ReplicaSet\/fast-deploy-00000-rs/, "Related tab did not render the owner/owned ReplicaSet");
    assert.match(relatedText, /ConfigMap\/fixture-settings/, "Related tab did not render the pod-template ConfigMap reference");
    assert.match(relatedText, /Service\/fast-svc/, "Related tab did not render the selecting Service");
    // Click-through: a related ConfigMap navigates to its kind and selects it.
    await page.getByTestId("related-ConfigMap-fixture-settings").click();
    await page.getByTestId("resource-detail-view").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector(".resource-detail-breadcrumb")?.textContent?.includes("ConfigMap"), undefined, { timeout: 15_000 });
    await page.getByTestId("resource-detail-back").click();
    await page.locator(".resource-pane").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("resource-nav-deployments").click();
    await waitForResourceLoad(page);
    await selectFirstResource(page);
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
  }
  return roundedElapsed(startedAt);
}

async function assertFixtureWorkflows(page, fixture, diffScreenshot, diagnosticsScreenshot) {
  const startedAt = performance.now();
  const scale = page.getByRole("button", { name: "Scale" });
  assert.equal(await scale.isDisabled(), true, "mutation controls were enabled while the context was read-only");
  await page.getByRole("button", { name: "Read-only" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Writes on"));
  assert.equal(await scale.isDisabled(), false, "scale stayed disabled after explicitly enabling writes");

  await scale.click();
  await page.getByLabel("Desired replicas").fill("2");
  await page.getByTestId("operation-prepare-dry-run").click();
  await waitUntil(() => fixture.requests.filter((request) => request.method === "PUT" && request.resource === "deployment").length >= 1, 10_000, `fixture did not receive dry-run update: ${JSON.stringify({ requests: fixture.requests.slice(-12), body: await page.getByTestId("resource-detail-view").innerText().catch(() => "") })}`);
  const diff = page.getByLabel("Dry-run Diff");
  await diff.waitFor({ state: "visible" });
  assert.match(await diff.textContent(), /replicas: 2/, "dry-run Diff does not show the requested replica count");
  await diff.locator(".shiki").first().waitFor({ state: "attached", timeout: 15_000 });
  await page.screenshot({ path: diffScreenshot, animations: "disabled" });
  await page.getByTestId("mutation-apply").click();
  await waitUntil(() => fixture.requests.filter((request) => request.method === "PUT" && request.resource === "deployment").length >= 2, 10_000, `fixture did not receive confirmed apply update: ${JSON.stringify(fixture.requests.slice(-12))}`);
  await page.waitForFunction(() => {
    const journal = JSON.parse(localStorage.getItem("aster.operationJournal") || "{}");
    return Array.isArray(journal["fixture-fast"]) && journal["fixture-fast"].some((entry) => entry.includes("scale fast-deploy-00000"));
  });

  const updates = fixture.requests.filter((request) => request.method === "PUT" && request.resource === "deployment");
  assert.equal(updates.some((request) => request.dryRun === true && request.replicas === 2), true, "server-side dry-run update was not observed");
  assert.equal(updates.some((request) => request.dryRun === false && request.replicas === 2), true, "confirmed update was not observed");
  await goBackToResourceList(page);
  await page.locator(".table-row").first().getByText("1/2", { exact: true }).waitFor({ state: "visible" });
  progress("scale complete");

  await waitForResourceLoad(page);
  await selectFirstResource(page);
  const imageStart = fixture.requests.length;
  await page.getByRole("button", { name: "Update image" }).click();
  await page.getByRole("textbox", { name: "Container image" }).fill("registry.example/fixture:2");
  await page.getByTestId("operation-prepare-dry-run").click();
  await assertAndApplyDryRun(page, /registry\.example\/fixture:2/);
  await waitUntil(() => fixture.requests.slice(imageStart).some((request) => request.resource === "deployment" && request.method === "PUT" && request.dryRun === false && request.image === "registry.example/fixture:2"), 10_000, "confirmed image update was not observed");
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  await page.getByTestId("resource-yaml-view").locator("code").filter({ hasText: "registry.example/fixture:2" }).waitFor({ state: "visible" });
  await goBackToResourceList(page);
  progress("image update complete");

  await waitForResourceLoad(page);
  await selectFirstResource(page);
  const restartStart = fixture.requests.length;
  await page.getByRole("button", { name: "Restart" }).click();
  await assertAndApplyDryRun(page, /kubectl\.kubernetes\.io\/restartedAt/);
  await waitUntil(() => fixture.requests.slice(restartStart).some((request) => request.resource === "deployment" && request.method === "PUT" && request.dryRun === false && request.restartedAt), 10_000, "confirmed restart update was not observed");
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  await page.getByTestId("resource-yaml-view").locator("code").filter({ hasText: "kubectl.kubernetes.io/restartedAt" }).waitFor({ state: "visible" });
  await goBackToResourceList(page);
  progress("restart complete");

  // Full-document YAML edit on a workload kind (not just ConfigMap).
  await waitForResourceLoad(page);
  await selectFirstResource(page);
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  const workloadYamlStart = fixture.requests.length;
  await page.getByTestId("yaml-edit").click();
  const workloadEditor = page.getByTestId("resource-yaml-editor");
  await workloadEditor.waitFor({ state: "visible" });
  const liveYaml = await workloadEditor.inputValue();
  const editedYaml = liveYaml.replace(/replicas: \d+/, "replicas: 3");
  assert.notEqual(editedYaml, liveYaml, "deployment YAML did not contain a replicas field to edit");
  await workloadEditor.fill(editedYaml);
  await page.getByTestId("yaml-prepare-dry-run").click();
  await assertAndApplyDryRun(page, /replicas: 3/);
  await waitUntil(() => fixture.requests.slice(workloadYamlStart).some((request) => request.resource === "deployment" && request.method === "PUT" && request.dryRun === false && request.replicas === 3), 10_000, "confirmed full-YAML deployment update was not observed");
  await goBackToResourceList(page);
  progress("full YAML edit complete");

  await waitForResourceLoad(page);
  await clickSidebarKind(page, fixture, "resource-nav-configmaps", "ConfigMaps", "/configmaps");
  await waitForResourceLoad(page);
  await selectFirstResource(page);
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  const configStart = fixture.requests.length;
  await page.getByTestId("yaml-edit").click();
  const editor = page.getByTestId("resource-yaml-editor");
  await editor.fill("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture-settings\n  namespace: fast-ns\ndata:\n  mode: updated\n  feature: enabled\n");
  await page.getByTestId("yaml-prepare-dry-run").click();
  await waitUntil(() => fixture.requests.slice(configStart).some((request) => request.resource === "configmap" && request.method === "PUT" && request.dryRun === true && request.data?.feature === "enabled"), 10_000, "ConfigMap dry-run update was not observed");
  await assertAndApplyDryRun(page, /feature: enabled/);
  await waitUntil(() => fixture.requests.slice(configStart).some((request) => request.resource === "configmap" && request.method === "PUT" && request.dryRun === false && request.data?.feature === "enabled"), 10_000, "confirmed ConfigMap YAML update was not observed");
  await goBackToResourceList(page);
  progress("ConfigMap YAML complete");

  // Create from YAML through the review gate, then delete through it.
  await waitForResourceLoad(page);
  await page.getByTestId("new-resource").click();
  await page.getByTestId("create-yaml-editor").waitFor({ state: "visible" });
  await page.getByTestId("create-yaml-editor").fill("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture-created\n  namespace: fast-ns\ndata:\n  created: \"yes\"\n");
  const createStart = fixture.requests.length;
  await page.getByTestId("create-prepare-dry-run").click();
  await waitUntil(() => fixture.requests.slice(createStart).some((request) => request.method === "POST" && request.dryRun === true && request.created === "fixture-created"), 10_000, "create dry-run was not observed");
  await page.getByLabel("Create dry-run review").waitFor({ state: "visible" });
  await page.screenshot({ path: result.createScreenshot, animations: "disabled" });
  result.viewportEvidence.push(await setElectronViewport(app, page, 900, 640, "create-resource"));
  const createDialogBox = await page.getByTestId("create-resource-dialog").boundingBox();
  const createViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(createDialogBox && createDialogBox.x >= 0 && createDialogBox.y >= 0 && createDialogBox.x + createDialogBox.width <= createViewport.width && createDialogBox.y + createDialogBox.height <= createViewport.height, `create dialog overflows at 900x640: ${JSON.stringify({ createDialogBox, createViewport })}`);
  await page.screenshot({ path: result.createCompactScreenshot, animations: "disabled" });
  result.viewportEvidence.push(await setElectronViewport(app, page, 1280, 800, "create-resource"));
  await page.getByTestId("create-apply").click();
  await waitUntil(() => fixture.requests.slice(createStart).some((request) => request.method === "POST" && request.dryRun === false && request.created === "fixture-created"), 10_000, "confirmed create was not observed");
  await page.getByTestId("create-resource-dialog").waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".table-row .primary-cell")].some((cell) => cell.textContent?.includes("fixture-created")), undefined, { timeout: 15_000 });
  progress("create complete");

  await page.locator(".table-row", { hasText: "fixture-created" }).first().click();
  await page.getByTestId("resource-detail-view").waitFor({ state: "visible" });
  const deleteStart = fixture.requests.length;
  await page.getByTestId("delete-resource").click();
  await waitUntil(() => fixture.requests.slice(deleteStart).some((request) => request.method === "DELETE" && request.dryRun === true && request.deleted === "fixture-created"), 10_000, "delete dry-run was not observed");
  await page.getByLabel("Dry-run Diff").waitFor({ state: "visible" });
  await page.getByTestId("mutation-apply").click();
  await waitUntil(() => fixture.requests.slice(deleteStart).some((request) => request.method === "DELETE" && request.dryRun === false && request.deleted === "fixture-created"), 10_000, "confirmed delete was not observed");
  // The DELETED watch event clears the selection, which closes the detail view.
  await page.locator(".resource-pane").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => ![...document.querySelectorAll(".table-row .primary-cell")].some((cell) => cell.textContent?.includes("fixture-created")), undefined, { timeout: 15_000 });
  progress("delete complete");

  // CRD discovery: custom kinds nest under one "Custom Resources" umbrella
  // with a collapsible subgroup per API group; subgroups start collapsed.
  await waitForResourceLoad(page);
  const umbrellaToggle = page.getByTestId("group-toggle-custom-resources");
  await umbrellaToggle.waitFor({ state: "visible" });
  assert.equal(await umbrellaToggle.getAttribute("aria-expanded"), "true", "Custom Resources umbrella should start expanded");
  const subgroupToggle = page.getByTestId("group-toggle-custom-resources-example-com");
  assert.equal(await subgroupToggle.getAttribute("aria-expanded"), "false", "custom API subgroup should start collapsed");
  assert.equal(await page.getByTestId("resource-nav-crd-example-com-v1-widgets").count(), 0, "collapsed subgroup still rendered its items");
  await subgroupToggle.click();
  assert.equal(await subgroupToggle.getAttribute("aria-expanded"), "true", "custom API subgroup did not expand on toggle");
  await clickSidebarKind(page, fixture, "resource-nav-crd-example-com-v1-widgets", "Widgets", "/widgets");
  await waitForResourceLoad(page);
  await page.screenshot({ path: result.customResourceScreenshot, animations: "disabled" });
  result.viewportEvidence.push(await setElectronViewport(app, page, 900, 640, "custom-resource-list"));
  assertNoViewportOverflow(await readLayout(page), "custom resource list at 900x640");
  await page.screenshot({ path: result.customResourceCompactScreenshot, animations: "disabled" });
  result.viewportEvidence.push(await setElectronViewport(app, page, 1280, 800, "custom-resource-list"));
  await selectFirstResource(page);
  await page.getByRole("tab", { name: "YAML", exact: true }).click();
  await page.getByTestId("resource-yaml-view").locator("code").filter({ hasText: "kind: Widget" }).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("yaml-edit").click();
  const widgetEditor = page.getByTestId("resource-yaml-editor");
  const widgetYaml = await widgetEditor.inputValue();
  const editedWidgetYaml = widgetYaml.replace(/size: \d+/, "size: 3");
  assert.notEqual(editedWidgetYaml, widgetYaml, "widget YAML did not contain a size field to edit");
  const widgetStart = fixture.requests.length;
  await widgetEditor.fill(editedWidgetYaml);
  await page.getByTestId("yaml-prepare-dry-run").click();
  await assertAndApplyDryRun(page, /size: 3/);
  await waitUntil(() => fixture.requests.slice(widgetStart).some((request) => request.resource === "widget" && request.method === "PUT" && request.dryRun === false && request.size === 3), 10_000, "confirmed widget YAML update was not observed");
  await goBackToResourceList(page);
  progress("custom resource complete");

  await waitForResourceLoad(page);
  await clickSidebarKind(page, fixture, "resource-nav-pods", "Pods", "/pods");
  await waitForResourceLoad(page);
  await selectFirstResource(page);
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await page.getByText("fixture log line 3").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("pod-metrics").getByText(/42Mi/).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("logs-follow-toggle").click();
  await page.getByText("fixture log line 7").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("logs-follow-toggle").click();
  progress("log follow and metrics complete");

  // The fixture cannot serve SPDY port-forward; the failure must surface honestly.
  await page.getByTestId("portforward-start").click();
  await page.getByTestId("portforward-error").waitFor({ state: "visible", timeout: 10_000 });
  assert.match(await page.getByTestId("portforward-error").innerText(), /port forward|spdy|upgrade|405|404|not allowed|not found/i, "port-forward failure did not surface an error");
  progress("port-forward error surface complete");
  assert.equal(await page.getByRole("button", { name: "Run", exact: true }).isDisabled(), false, "Terminal exec stayed disabled after writes were enabled");
  await page.getByRole("button", { name: "Writes on" }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Read-only"));
  assert.equal(await page.getByRole("button", { name: "Run", exact: true }).isDisabled(), true, "Terminal exec was enabled while the context was read-only");
  assert.equal(fixture.requests.some((request) => request.resource === "pod-exec"), false, "read-only workflow unexpectedly sent a Pod exec request");
  const writeCountBeforeBoundaryProbe = fixture.requests.filter((request) => ["PUT", "POST", "DELETE"].includes(request.method)).length;
  const boundaryErrors = await page.evaluate(async () => {
    const capture = async (operation) => {
      try { await operation(); return "unexpected success"; } catch (error) { return error instanceof Error ? error.message : String(error); }
    };
    return Promise.all([
      capture(() => window.aster.resources.exec({ contextId: "fixture-fast", namespace: "fast-ns", name: "fixture-pod", command: ["/bin/echo", "blocked"] })),
      capture(() => window.aster.resources.mutate({
        contextId: "fixture-fast",
        resourceKind: { id: "deployments", group: "apps", version: "v1", resource: "deployments", kind: "Deployment", namespaced: true, category: "Workloads" },
        namespace: "fast-ns", name: "fast-deploy-00000", operation: "restart", dryRun: true, resourceVersion: "1",
      })),
      capture(() => window.aster.resources.mutate({
        contextId: "fixture-fast",
        resourceKind: { id: "configmaps", group: "", version: "v1", resource: "configmaps", kind: "ConfigMap", namespaced: true, category: "Config" },
        namespace: "fast-ns", operation: "create", dryRun: true, yaml: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: blocked\n",
      })),
      capture(() => window.aster.resources.mutate({
        contextId: "fixture-fast",
        resourceKind: { id: "configmaps", group: "", version: "v1", resource: "configmaps", kind: "ConfigMap", namespaced: true, category: "Config" },
        namespace: "fast-ns", name: "fixture-settings", operation: "delete", dryRun: true,
      })),
      capture(() => window.aster.resources.portForwardStart({ contextId: "fixture-fast", namespace: "fast-ns", name: "fixture-pod", podPort: 8080 })),
    ]);
  });
  assert.ok(boundaryErrors.every((message) => /blocked.*read-only/i.test(message)), `Electron main read-only boundary did not reject direct preload calls: ${boundaryErrors.join(" | ")}`);
  assert.equal(fixture.requests.filter((request) => ["PUT", "POST", "DELETE"].includes(request.method)).length, writeCountBeforeBoundaryProbe, "read-only direct mutation reached the Kubernetes fixture");
  assert.equal(fixture.requests.some((request) => request.resource === "pod-exec"), false, "read-only direct exec reached the Kubernetes fixture");
  await page.locator(".resource-detail-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: diagnosticsScreenshot, animations: "disabled" });
  progress("Pod Logs and read-only Terminal complete");

  const journal = await page.evaluate(() => JSON.parse(localStorage.getItem("aster.operationJournal") || "{}")?.["fixture-fast"] || []);
  for (const operation of ["scale", "image", "restart", "yaml", "create", "delete"]) {
    assert.equal(journal.some((entry) => entry.includes(`${operation} `)), true, `operation journal omitted ${operation}`);
  }
  await goBackToResourceList(page);

  return {
    elapsedMs: roundedElapsed(startedAt),
    workflows: {
      events: true,
      related: true,
      scale: true,
      imageUpdate: true,
      restart: true,
      configMapYaml: true,
      workloadYaml: true,
      createFromYaml: true,
      deleteResource: true,
      customResources: true,
      dryRunReview: true,
      operationJournal: true,
      podLogs: true,
      podMetrics: true,
      logFollow: true,
      portForwardErrorSurface: true,
      readOnlyTerminalBlock: true,
      mainReadOnlyBoundary: true,
    },
  };
}

async function assertSidebarCollapseAndRail(page, result) {
  // Group folding: collapse a group that does not contain the active kind
  // (the active kind's group auto-expands by design).
  const storageToggle = page.getByTestId("group-toggle-storage");
  assert.equal(await storageToggle.getAttribute("aria-expanded"), "true", "built-in groups should start expanded");
  await storageToggle.click();
  assert.equal(await storageToggle.getAttribute("aria-expanded"), "false", "Storage group did not collapse");
  assert.equal(await page.getByTestId("resource-nav-storageclasses").count(), 0, "collapsed group still rendered its items");
  const groupPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem("aster.sidebar.groupCollapsed") || "{}"));
  assert.equal(groupPrefs.Storage, true, "group collapse was not persisted to localStorage");
  await storageToggle.click();
  assert.equal(await storageToggle.getAttribute("aria-expanded"), "true", "Storage group did not re-expand");
  await page.getByTestId("resource-nav-storageclasses").waitFor();

  // Icon rail: the titlebar toggle collapses the sidebar, Meta+B restores it.
  const sourceList = page.getByTestId("source-list");
  const expandedWidth = (await sourceList.boundingBox())?.width || 0;
  await page.getByTestId("toggle-sidebar").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="workbench-shell"]')?.classList.contains("sidebar-rail"));
  const railWidth = (await sourceList.boundingBox())?.width || 0;
  assert.ok(railWidth > 0 && railWidth <= 56 && railWidth < expandedWidth, `rail width ${railWidth}px did not shrink from ${expandedWidth}px`);
  assert.equal(await page.evaluate(() => localStorage.getItem("aster.sidebar.collapsed")), "true", "rail state was not persisted");
  if (process.platform === "darwin") {
    const toggleBox = await page.getByTestId("toggle-sidebar").boundingBox();
    assert.ok(toggleBox && toggleBox.y >= 31, `rail toggle overlaps the macOS traffic lights (y 18-30): ${JSON.stringify(toggleBox)}`);
  }
  assert.equal(await page.getByTestId("group-toggle-workloads").count(), 0, "group labels should be hidden in rail mode");
  await page.getByTestId("resource-nav-deployments").waitFor({ state: "visible" });
  assertNoViewportOverflow(await readLayout(page), "sidebar rail at 1280x800");
  await page.screenshot({ path: result.sidebarRailScreenshot, animations: "disabled" });
  await page.keyboard.press("Meta+B");
  await page.waitForFunction(() => !document.querySelector('[data-testid="workbench-shell"]')?.classList.contains("sidebar-rail"));
  const restoredWidth = (await sourceList.boundingBox())?.width || 0;
  assert.ok(Math.abs(restoredWidth - expandedWidth) <= 1, `sidebar width ${restoredWidth}px did not restore to ${expandedWidth}px`);
  return { groupFold: true, iconRail: true };
}

async function assertAndApplyDryRun(page, expected) {
  const diff = page.getByLabel("Dry-run Diff");
  await diff.waitFor({ state: "visible", timeout: 10_000 });
  await diff.locator(".shiki").first().waitFor({ state: "attached", timeout: 15_000 });
  assert.match(await diff.textContent(), expected, `dry-run Diff did not match ${expected}`);
  await page.getByTestId("mutation-apply").click();
}

async function assertPaletteWithinViewport(page, label) {
  const metrics = await page.evaluate(() => {
    const palette = document.querySelector('[data-testid="command-palette"]')?.getBoundingClientRect();
    return palette ? { x: palette.x, y: palette.y, right: palette.right, bottom: palette.bottom, vw: innerWidth, vh: innerHeight } : undefined;
  });
  assert.ok(metrics, `${label}: palette is not rendered`);
  assert.ok(metrics.x >= 0 && metrics.y >= 0 && metrics.right <= metrics.vw && metrics.bottom <= metrics.vh, `${label}: palette overflows the viewport: ${JSON.stringify(metrics)}`);
}

async function selectFirstResource(page) {
  const row = page.locator(".table-row").first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  await row.click();
  await page.getByTestId("resource-detail-view").waitFor({ state: "visible", timeout: 30_000 });
}

// Retries guard against the occasional pointer event landing mid-layout-shift
// on macOS (window resizes in this suite trigger media-query layout changes).
async function clickSidebarKind(page, fixture, testId, heading, resourcePath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = fixture ? fixture.requests.length : 0;
    await page.getByTestId(testId).click();
    try {
      await page.waitForFunction((expected) => document.querySelector(".pane-heading h1")?.textContent === expected, heading, { timeout: 4_000 });
      if (fixture) {
        await waitUntil(() => fixture.requests.slice(before).some((request) => request.path.includes(resourcePath)), 4_000, `${heading} list request did not start`);
      }
      return;
    } catch {
      if (attempt === 2) throw new Error(`sidebar navigation to ${heading} failed after 3 attempts`);
    }
  }
}

async function selectWorkbenchTheme(page, electronApp, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByTestId("theme-menu").click();
    const item = page.getByRole("menuitem", { name });
    try {
      await item.waitFor({ state: "visible", timeout: 2_000 });
      await item.click();
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, name.toLowerCase(), { timeout: 4_000 });
      assert.equal(await waitForNativeTheme(electronApp, name.toLowerCase()), name.toLowerCase(), `nativeTheme did not follow the ${name} workbench theme`);
      return;
    } catch (error) {
      await page.keyboard.press("Escape");
      if (attempt === 2) throw error;
    }
  }
}

async function goBackToResourceList(page) {
  await page.getByTestId("resource-detail-back").click();
  await page.locator(".resource-pane").waitFor({ state: "visible", timeout: 30_000 });
}

async function assertVirtualizedTenThousandRows(page) {
  const fullFixtureStartedAt = performance.now();
  await page.waitForFunction(() => document.querySelector(".resource-summary span")?.textContent?.trim() === "100 loaded", undefined, { timeout: 40_000 });
  const before = await page.locator(".table-row").count();
  assert.ok(before > 0 && before <= 150, `virtual table rendered ${before} rows for the first fixture page`);
  const nextPage = page.getByRole("button", { name: /Load next 100/i });
  for (let expected = 200; expected <= 10_000; expected += 100) {
    await nextPage.click();
    await page.waitForFunction((count) => document.querySelector(".resource-summary span")?.textContent?.trim() === `${count} loaded`, expected, { timeout: 40_000 });
  }
  await page.locator(".table-viewport").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(150);
  const after = await page.locator(".table-row").count();
  assert.ok(after > 0 && after <= 150, `virtual table rendered ${after} rows after loading the 10k fixture`);
  const fullFixtureMs = roundedElapsed(fullFixtureStartedAt);
  assert.ok(fullFixtureMs < 30_000, `loading and scrolling the 10k fixture took ${fullFixtureMs}ms`);
  const rendererHeapBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize);
  await page.locator(".table-viewport").evaluate((element) => { element.scrollTop = 0; });
  return {
    fixtureResourceCount: 10_000,
    serverPageSize: 100,
    loadedPages: 100,
    renderedRowsFirstPage: before,
    renderedRowsAfterTenThousand: after,
    loadAndScrollTenThousandMs: fullFixtureMs,
    ...(rendererHeapBytes ? { rendererHeapBytes } : {}),
  };
}

async function assertControlledContextRace(page, fixture) {
  const startedAt = performance.now();
  await page.getByTestId("change-context").click();
  await page.getByTestId("context-picker").waitFor();
  await page.getByTestId("context-option-fixture-slow").click();
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await waitUntil(() => fixture.requests.some((request) => request.identity === "slow" && request.resource === "deployments"), 8_000, "slow fixture request did not start");
  await page.getByTestId("change-context").click();
  await page.getByTestId("context-option-fixture-fast").click();
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await page.waitForFunction(() => document.querySelector(".resource-summary span")?.textContent?.trim() === "100 loaded", undefined, { timeout: 40_000 });
  await page.waitForTimeout(1_100);

  assert.match(await page.getByTestId("change-context").innerText(), /fixture-fast/, "context selection reverted after a stale response");
  const rowNames = await page.locator(".table-row .primary-cell").allTextContents();
  assert.ok(rowNames.length > 0, "no fast-context rows remained after switching");
  assert.ok(rowNames.every((name) => name.includes("fast-deploy-")), `stale slow-context rows polluted the table: ${rowNames.join(", ")}`);
  const namespaceText = await page.getByTestId("namespace-select").innerText();
  assert.doesNotMatch(namespaceText, /slow-ns/, `stale namespace response polluted the selector: ${namespaceText}`);
  return roundedElapsed(startedAt);
}

function roundedElapsed(startedAt) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function progress(message) {
  console.log(`[e2e +${roundedElapsed(launchStartedAt)}ms] ${message}`);
}

function withoutBodyText(layout) {
  const { bodyText: _bodyText, ...safe } = layout;
  return safe;
}

async function assertRealContextSwitch(page, originalContext) {
  const originalNames = await page.locator(".table-row .primary-cell").allTextContents();
  assert.ok(originalNames.length > 0, `real context ${originalContext} has no visible Deployments; point ASTER_E2E_MODE=real at a staging context with at least one Deployment`);

  await page.getByTestId("change-context").click();
  await page.getByTestId("context-picker").waitFor();
  const contexts = await page.locator("[data-context-option]").evaluateAll((options) => options.map((option) => option.getAttribute("data-context-id")).filter(Boolean));
  const alternate = contexts.find((value) => value !== originalContext);
  if (!alternate) {
    console.warn("REAL_CONTEXT_RACE_SKIPPED: kubeconfig exposes only one context; fixture mode covers deterministic stale-response rejection.");
    await page.getByTestId("context-picker-connect").click();
    await page.getByTestId("workbench-shell").waitFor();
    await waitForResourceLoad(page);
    return;
  }

  await page.locator(`[data-context-option][data-context-id="${cssAttributeValue(alternate)}"]`).click();
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await page.waitForTimeout(20);
  await page.getByTestId("change-context").click();
  await page.locator(`[data-context-option][data-context-id="${cssAttributeValue(originalContext)}"]`).click();
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await waitForResourceLoad(page);
  await page.waitForTimeout(1_000);
  await page.getByTestId("change-context").click();
  assert.equal(await page.locator('[data-context-option][data-selected="true"]').getAttribute("data-context-id"), originalContext, "real context selection reverted after rapid switching");
  await page.getByTestId("context-picker-connect").click();
  await page.getByTestId("workbench-shell").waitFor();
  await waitForResourceLoad(page);
  const finalNames = await page.locator(".table-row .primary-cell").allTextContents();
  assert.ok(finalNames.length > 0, "rapid context switching left the real resource table empty");
  assert.ok(finalNames.every((name) => originalNames.includes(name)), `rows not present in the original context appeared after rapid switching: ${finalNames.join(", ")}`);
}

async function readLayout(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      contextPicker: rect(".context-picker"),
      contextPickerMain: rect(".context-picker-main"),
      contextPickerPanel: rect(".context-picker-panel"),
      contextPickerHeading: rect(".context-picker-heading"),
      contextPickerToolbar: rect(".context-picker-toolbar"),
      contextPickerList: rect('[data-testid="context-picker-list"]'),
      shell: rect('[data-testid="workbench-shell"]'),
      sourceList: rect('[data-testid="source-list"]'),
      mainWorkspace: rect('[data-testid="main-workspace"]'),
      resourcePane: rect(".resource-pane"),
      resourceDetail: rect('[data-testid="resource-detail-view"]'),
      coreState: document.querySelector(".context-picker-core-status")?.textContent?.trim(),
      bodyText: document.body.innerText,
    };
  });
}

function assertPickerRegionsVisible(layout, label) {
  for (const [name, region] of [
    ["heading", layout.contextPickerHeading],
    ["toolbar", layout.contextPickerToolbar],
    ["list", layout.contextPickerList],
  ]) {
    assert.ok(region, `${label} is missing its ${name}: ${JSON.stringify(layout)}`);
    assert.ok(region.top >= (layout.contextPickerMain?.top ?? 0) - 1, `${label} clips its ${name} above the viewport: ${JSON.stringify(layout)}`);
    assert.ok(region.bottom <= layout.viewport.height + 1, `${label} clips its ${name} below the viewport: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.contextPickerHeading.bottom <= layout.contextPickerToolbar.top + 1, `${label} overlaps its heading and toolbar: ${JSON.stringify(layout)}`);
  assert.ok(layout.contextPickerToolbar.bottom <= layout.contextPickerList.top + 1, `${label} overlaps its toolbar and list: ${JSON.stringify(layout)}`);
}

function assertNoViewportOverflow(layout, label) {
  assert.ok(layout.document.width <= layout.viewport.width + 1, `${label} has horizontal viewport overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.document.height <= layout.viewport.height + 1, `${label} has vertical viewport overflow: ${JSON.stringify(layout)}`);
}

async function setElectronViewport(electronApp, page, width, height, surface) {
  let strategy = "BrowserWindow.setContentSize";
  try {
    await electronApp.evaluate(({ BrowserWindow }, requested) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("Electron BrowserWindow is unavailable");
      window.setContentSize(requested.width, requested.height);
    }, { width, height });
    await page.waitForFunction(
      (requested) => Math.abs(innerWidth - requested.width) <= 1 && Math.abs(innerHeight - requested.height) <= 1,
      { width, height },
      { timeout: 3_000 },
    );
  } catch {
    strategy = "Playwright.page.setViewportSize";
    await page.setViewportSize({ width, height });
  }

  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(Math.abs(actual.width - width) <= 1 && Math.abs(actual.height - height) <= 1, `${surface} viewport is ${actual.width}x${actual.height}, expected ${width}x${height}`);
  return { surface, strategy, requested: { width, height }, actual };
}

function cssAttributeValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function startKubernetesFixture(temporaryRoot) {
  const requests = [];
  const fastServer = createKubernetesFixtureServer("fast", 0, requests);
  const slowServer = createKubernetesFixtureServer("slow", 800, requests);
  const [fastPort, slowPort] = await Promise.all([listen(fastServer), listen(slowServer)]);
  const kubeconfig = path.join(temporaryRoot, "fixture-kubeconfig.yaml");
  await fs.writeFile(kubeconfig, fixtureKubeconfig(fastPort, slowPort), { mode: 0o600 });
  const extraKubeconfig = path.join(temporaryRoot, "extra-cluster.yaml");
  await fs.writeFile(extraKubeconfig, extraKubeconfigDocument(fastPort), { mode: 0o600 });
  return {
    kubeconfig,
    extraKubeconfig,
    requests,
    close: async () => {
      await Promise.all([closeServer(fastServer), closeServer(slowServer)]);
    },
  };
}

async function startUpdaterFixture() {
  const sha512 = `${"A".repeat(87)}=`;
  const latestYml = [
    "version: 9.9.9",
    "path: Aster_9.9.9.zip",
    `sha512: ${sha512}`,
    "releaseNotes: |",
    "  Fixture release notes with **markdown** and <b>html</b> markup",
    "files:",
    "  - url: Aster_9.9.9.zip",
    `    sha512: ${sha512}`,
    "    size: 1024",
    "",
  ].join("\n");
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://updater.local");
    if (request.method === "GET" && url.pathname.endsWith(".yml")) {
      response.writeHead(200, { "content-type": "text/yaml" });
      response.end(latestYml);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}

function createKubernetesFixtureServer(identity, delay, requests) {
  const deploymentState = new Map();
  const configMapState = new Map();
  const widgetState = new Map();
  const watchResponses = new Map();
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://fixture.local");
    const resource = classifyFixtureResource(url.pathname);
    const record = { identity, method: request.method, path: url.pathname, resource, at: Date.now() };
    requests.push(record);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

    // Discovery documents drive the custom-resource sidebar group.
    if (request.method === "GET" && url.pathname === "/api") {
      return writeJson(response, 200, { kind: "APIVersions", versions: ["v1"], serverAddressByClientCIDRs: [] });
    }
    if (request.method === "GET" && url.pathname === "/api/v1") {
      return writeJson(response, 200, apiResourceList("v1", [
        { name: "pods", kind: "Pod", namespaced: true },
        { name: "configmaps", kind: "ConfigMap", namespaced: true },
        { name: "secrets", kind: "Secret", namespaced: true },
        { name: "namespaces", kind: "Namespace", namespaced: false },
        { name: "nodes", kind: "Node", namespaced: false },
        { name: "events", kind: "Event", namespaced: true },
      ]));
    }
    if (request.method === "GET" && url.pathname === "/apis") {
      return writeJson(response, 200, {
        kind: "APIGroupList",
        apiVersion: "v1",
        groups: [
          apiGroup("apps", "v1"),
          apiGroup("batch", "v1"),
          apiGroup("networking.k8s.io", "v1"),
          apiGroup("storage.k8s.io", "v1"),
          apiGroup("rbac.authorization.k8s.io", "v1"),
          apiGroup("example.com", "v1"),
        ],
      });
    }
    const groupVersionMatch = url.pathname.match(/^\/apis\/([^/]+)\/([^/]+)$/);
    if (request.method === "GET" && groupVersionMatch) {
      const [, group, version] = groupVersionMatch;
      const resourcesByGroup = {
        apps: [
          { name: "deployments", kind: "Deployment", namespaced: true },
          { name: "statefulsets", kind: "StatefulSet", namespaced: true },
          { name: "daemonsets", kind: "DaemonSet", namespaced: true },
        ],
        batch: [
          { name: "jobs", kind: "Job", namespaced: true },
          { name: "cronjobs", kind: "CronJob", namespaced: true },
        ],
        "networking.k8s.io": [
          { name: "ingresses", kind: "Ingress", namespaced: true },
          { name: "networkpolicies", kind: "NetworkPolicy", namespaced: true },
        ],
        "storage.k8s.io": [{ name: "storageclasses", kind: "StorageClass", namespaced: false }],
        "rbac.authorization.k8s.io": [
          { name: "roles", kind: "Role", namespaced: true },
          { name: "rolebindings", kind: "RoleBinding", namespaced: true },
        ],
        "example.com": [{ name: "widgets", kind: "Widget", namespaced: true }],
      };
      const groupResources = resourcesByGroup[group];
      if (!groupResources || version !== "v1") {
        return writeJson(response, 404, { kind: "Status", status: "Failure", reason: "NotFound", code: 404 });
      }
      return writeJson(response, 200, apiResourceList(`${group}/${version}`, groupResources));
    }

    if (request.method === "PUT" && resource === "widget") {
      const value = await readJson(request);
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      const dryRun = url.searchParams.has("dryRun");
      record.dryRun = dryRun;
      record.size = value?.spec?.size;
      const current = widgetState.get(`${namespace}/${name}`) || widgetObject(name, namespace);
      const updated = structuredClone(value);
      updated.metadata = { ...current.metadata, ...updated.metadata, resourceVersion: dryRun ? current.metadata.resourceVersion : String(Number(current.metadata.resourceVersion || 1) + 1) };
      if (!dryRun) {
        widgetState.set(`${namespace}/${name}`, updated);
        broadcastWatch(watchResponses, "MODIFIED", updated, "widgets");
      }
      return writeJson(response, 200, updated);
    }

    if (request.method === "PUT" && resource === "deployment") {
      const value = await readJson(request);
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      const dryRun = url.searchParams.has("dryRun");
      const replicas = Number(value?.spec?.replicas);
      record.dryRun = dryRun;
      record.replicas = replicas;
      record.image = value?.spec?.template?.spec?.containers?.[0]?.image;
      record.restartedAt = value?.spec?.template?.metadata?.annotations?.["kubectl.kubernetes.io/restartedAt"];
      const current = deploymentState.get(`${namespace}/${name}`) || deploymentObject(name, namespace, 0);
      const updated = structuredClone(value);
      updated.metadata = { ...current.metadata, ...updated.metadata, resourceVersion: dryRun ? current.metadata.resourceVersion : String(Number(current.metadata.resourceVersion || 1) + 1) };
      if (!dryRun) {
        deploymentState.set(`${namespace}/${name}`, updated);
        broadcastWatch(watchResponses, "MODIFIED", updated, "deployments");
      }
      return writeJson(response, 200, updated);
    }
    if (request.method === "PUT" && resource === "configmap") {
      const value = await readJson(request);
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      const dryRun = url.searchParams.has("dryRun");
      record.dryRun = dryRun;
      record.data = value?.data;
      const current = configMapState.get(`${namespace}/${name}`) || configMapObject(name, namespace);
      const updated = structuredClone(value);
      updated.metadata = { ...current.metadata, ...updated.metadata, resourceVersion: dryRun ? current.metadata.resourceVersion : String(Number(current.metadata.resourceVersion || 1) + 1) };
      if (!dryRun) {
        configMapState.set(`${namespace}/${name}`, updated);
        broadcastWatch(watchResponses, "MODIFIED", updated, "configmaps");
      }
      return writeJson(response, 200, updated);
    }
    if (request.method === "POST" && resource === "configmaps") {
      const value = await readJson(request);
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      const dryRun = url.searchParams.has("dryRun");
      const name = value?.metadata?.name || "unnamed";
      record.dryRun = dryRun;
      record.data = value?.data;
      record.created = name;
      if (configMapState.has(`${namespace}/${name}`)) {
        return writeJson(response, 409, { kind: "Status", status: "Failure", reason: "AlreadyExists", message: `configmaps "${name}" already exists`, code: 409 });
      }
      const created = structuredClone(value);
      created.metadata = { resourceVersion: "1", creationTimestamp: new Date().toISOString(), ...created.metadata, namespace };
      if (!dryRun) {
        configMapState.set(`${namespace}/${name}`, created);
        broadcastWatch(watchResponses, "ADDED", created, "configmaps");
      }
      return writeJson(response, 201, created);
    }
    if (request.method === "DELETE" && resource === "configmap") {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      // client-go sends DeleteOptions (including dryRun) in the request body.
      const body = await readJson(request).catch(() => undefined);
      const dryRun = url.searchParams.has("dryRun") || (Array.isArray(body?.dryRun) && body.dryRun.length > 0);
      record.dryRun = dryRun;
      record.deleted = name;
      const current = configMapState.get(`${namespace}/${name}`);
      if (!current) {
        return writeJson(response, 404, { kind: "Status", status: "Failure", reason: "NotFound", message: `configmaps "${name}" not found`, code: 404 });
      }
      if (!dryRun) {
        configMapState.delete(`${namespace}/${name}`);
        broadcastWatch(watchResponses, "DELETED", current, "configmaps");
      }
      return writeJson(response, 200, { kind: "Status", status: "Success" });
    }
    if (request.method !== "GET") return writeJson(response, 405, { message: "method not allowed" });
    if (url.searchParams.get("watch") === "true") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.write(`${JSON.stringify({
        type: "BOOKMARK",
        object: {
          apiVersion: "v1",
          kind: "Deployment",
          metadata: { resourceVersion: `${identity}-watch-rv` },
        },
      })}\n`);
      watchResponses.set(response, resource);
      request.on("close", () => {
        watchResponses.delete(response);
        response.end();
      });
      return;
    }
    if (resource === "namespaces") {
      return writeJson(response, 200, kubernetesList("NamespaceList", [namespaceObject(`${identity}-ns`)], `${identity}-namespaces-rv`));
    }
    if (resource === "deployments") {
      const count = identity === "fast" ? 10_000 : 1;
      const limit = Number(url.searchParams.get("limit") || count);
      const offset = decodeContinueToken(url.searchParams.get("continue"));
      const items = Array.from({ length: Math.min(limit, Math.max(0, count - offset)) }, (_, index) => {
        const name = `${identity}-deploy-${String(offset + index).padStart(5, "0")}`;
        const namespace = identity === "fast" ? "fast-ns" : "slow-ns";
        return deploymentState.get(`${namespace}/${name}`) || deploymentObject(name, namespace, offset + index);
      });
      const nextOffset = offset + items.length;
      const list = kubernetesList("DeploymentList", items, `${identity}-deployments-rv`);
      if (nextOffset < count) list.metadata.continue = encodeContinueToken(nextOffset);
      return writeJson(response, 200, list);
    }
    if (resource === "deployment") {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      return writeJson(response, 200, deploymentState.get(`${namespace}/${name}`) || deploymentObject(name, namespace, 0));
    }
    if (resource === "configmaps") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      const item = configMapState.get(`${namespace}/fixture-settings`) || configMapObject("fixture-settings", namespace);
      return writeJson(response, 200, kubernetesList("ConfigMapList", [item], `${identity}-configmaps-rv`));
    }
    if (resource === "configmap") {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      return writeJson(response, 200, configMapState.get(`${namespace}/${name}`) || configMapObject(name, namespace));
    }
    if (resource === "widgets") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      const item = widgetState.get(`${namespace}/fixture-widget`) || widgetObject("fixture-widget", namespace);
      return writeJson(response, 200, kubernetesList("WidgetList", [item], `${identity}-widgets-rv`));
    }
    if (resource === "widget") {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      return writeJson(response, 200, widgetState.get(`${namespace}/${name}`) || widgetObject(name, namespace));
    }
    if (resource === "replicasets") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      return writeJson(response, 200, kubernetesList("ReplicaSetList", [replicaSetObject(namespace)], `${identity}-replicasets-rv`));
    }
    if (resource === "services") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      return writeJson(response, 200, kubernetesList("ServiceList", [serviceObject(namespace)], `${identity}-services-rv`));
    }
    if (resource === "pods") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      return writeJson(response, 200, kubernetesList("PodList", [podObject("fixture-pod", namespace)], `${identity}-pods-rv`));
    }
    if (resource === "pod") {
      const name = decodeURIComponent(url.pathname.split("/").at(-1));
      const namespace = decodeURIComponent(url.pathname.split("/").at(-3));
      return writeJson(response, 200, podObject(name, namespace));
    }
    if (resource === "pod-logs") {
      if (url.searchParams.get("follow") === "true") {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
        response.write("fixture log line 1\nfixture log line 2\nfixture log line 3\n");
        let line = 4;
        const timer = setInterval(() => {
          if (line > 7 || response.destroyed) {
            clearInterval(timer);
            return;
          }
          response.write(`fixture log line ${line}\n`);
          line += 1;
        }, 40);
        request.on("close", () => clearInterval(timer));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("fixture log line 1\nfixture log line 2\nfixture log line 3\n");
      return;
    }
    if (resource === "metrics-pods") {
      return writeJson(response, 200, {
        kind: "PodMetricsList",
        apiVersion: "metrics.k8s.io/v1beta1",
        metadata: {},
        items: [{
          apiVersion: "metrics.k8s.io/v1beta1",
          kind: "PodMetrics",
          metadata: { name: "fixture-pod", namespace: decodeURIComponent(url.pathname.split("/").at(-2) || "fast-ns") },
          containers: [{ name: "app", usage: { cpu: "7m", memory: "42Mi" } }],
        }],
      });
    }
    if (resource === "events") {
      const namespace = decodeURIComponent(url.pathname.split("/").at(-2));
      const name = url.searchParams.get("fieldSelector")?.split("=").at(-1) || "fast-deploy-00000";
      return writeJson(response, 200, kubernetesList("EventList", [{
        apiVersion: "v1", kind: "Event", metadata: { name: `${name}.1`, namespace }, reason: "Pulled", message: "Fixture image pulled", type: "Normal", count: 2, lastTimestamp: "2026-01-01T00:00:00Z", involvedObject: { name },
      }], `${identity}-events-rv`));
    }
    return writeJson(response, 404, { kind: "Status", apiVersion: "v1", status: "Failure", reason: "NotFound", code: 404 });
  });
}

function broadcastWatch(responses, type, object, resource) {
  const line = `${JSON.stringify({ type, object })}\n`;
  for (const [response, watched] of responses) {
    if (watched === resource && !response.destroyed) response.write(line);
  }
}

function classifyFixtureResource(pathname) {
  if (pathname.endsWith("/namespaces")) return "namespaces";
  if (pathname.endsWith("/events")) return "events";
  if (pathname.endsWith("/log") && pathname.includes("/pods/")) return "pod-logs";
  if (pathname.includes("metrics.k8s.io") && pathname.endsWith("/pods")) return "metrics-pods";
  if (pathname.endsWith("/exec") && pathname.includes("/pods/")) return "pod-exec";
  if (pathname.includes("/deployments/")) return "deployment";
  if (pathname.endsWith("/deployments")) return "deployments";
  if (pathname.includes("/configmaps/")) return "configmap";
  if (pathname.endsWith("/configmaps")) return "configmaps";
  if (pathname.includes("/widgets/")) return "widget";
  if (pathname.endsWith("/widgets")) return "widgets";
  if (pathname.includes("/replicasets/")) return "replicaset";
  if (pathname.endsWith("/replicasets")) return "replicasets";
  if (pathname.includes("/services/")) return "service";
  if (pathname.endsWith("/services")) return "services";
  if (pathname.includes("/pods/")) return "pod";
  if (pathname.endsWith("/pods")) return "pods";
  return "unknown";
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function fixtureKubeconfig(fastPort, slowPort) {
  return `apiVersion: v1\nkind: Config\nclusters:\n  - name: fixture-fast-cluster\n    cluster:\n      server: http://127.0.0.1:${fastPort}\n  - name: fixture-slow-cluster\n    cluster:\n      server: http://127.0.0.1:${slowPort}\nusers:\n  - name: fixture-fast-user\n    user:\n      token: fast-token\n  - name: fixture-slow-user\n    user:\n      token: slow-token\ncontexts:\n  - name: fixture-fast\n    context:\n      cluster: fixture-fast-cluster\n      user: fixture-fast-user\n      namespace: fast-ns\n  - name: fixture-slow\n    context:\n      cluster: fixture-slow-cluster\n      user: fixture-slow-user\n      namespace: slow-ns\ncurrent-context: fixture-fast\n`;
}

function extraKubeconfigDocument(fastPort) {
  return `apiVersion: v1\nkind: Config\nclusters:\n  - name: fixture-extra-cluster\n    cluster:\n      server: http://127.0.0.1:${fastPort}\nusers:\n  - name: fixture-extra-user\n    user:\n      token: extra-token\ncontexts:\n  - name: fixture-extra\n    context:\n      cluster: fixture-extra-cluster\n      user: fixture-extra-user\n      namespace: fast-ns\n`;
}

function kubernetesList(kind, items, resourceVersion) {
  return { apiVersion: "v1", kind, metadata: { resourceVersion }, items };
}

function encodeContinueToken(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeContinueToken(value) {
  if (!value) return 0;
  const decoded = Number(Buffer.from(value, "base64url").toString("utf8"));
  return Number.isSafeInteger(decoded) && decoded >= 0 ? decoded : 0;
}

function namespaceObject(name) {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name, uid: `uid-${name}`, resourceVersion: "1", creationTimestamp: "2026-01-01T00:00:00Z" },
    status: { phase: "Active" },
  };
}

function deploymentObject(name, namespace, index) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace,
      uid: `uid-${namespace}-${name}`,
      resourceVersion: String(index + 1),
      creationTimestamp: "2026-01-01T00:00:00Z",
      labels: { app: name },
      annotations: {
        "fixture.aster.dev/evidence": "sanitized-detail",
        "kubectl.kubernetes.io/last-applied-configuration": "{should-not-reach-renderer:true}",
      },
      managedFields: [{ manager: "fixture-manager", operation: "Apply" }],
      ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: `${name}-rs`, uid: `owner-${name}` }],
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          serviceAccountName: "fixture-sa",
          containers: [{ name: "app", image: "registry.example/fixture:1" }],
          volumes: [{ name: "config", configMap: { name: "fixture-settings" } }],
        },
      },
    },
    status: { replicas: 1, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 },
  };
}

function configMapObject(name, namespace) {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name, namespace, uid: `uid-${namespace}-${name}`, resourceVersion: "1", creationTimestamp: "2026-01-01T00:00:00Z" },
    data: { mode: "initial" },
  };
}

function widgetObject(name, namespace) {
  return {
    apiVersion: "example.com/v1",
    kind: "Widget",
    metadata: { name, namespace, uid: `uid-${namespace}-${name}`, resourceVersion: "1", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { size: 1 },
  };
}

function replicaSetObject(namespace) {
  return {
    apiVersion: "apps/v1",
    kind: "ReplicaSet",
    metadata: {
      name: "fast-deploy-00000-rs",
      namespace,
      uid: `uid-${namespace}-fast-deploy-00000-rs`,
      resourceVersion: "1",
      creationTimestamp: "2026-01-01T00:00:00Z",
      ownerReferences: [{ apiVersion: "apps/v1", kind: "Deployment", name: "fast-deploy-00000", uid: `uid-${namespace}-fast-deploy-00000` }],
    },
    spec: { replicas: 1 },
  };
}

function serviceObject(namespace) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "fast-svc", namespace, uid: `uid-${namespace}-fast-svc`, resourceVersion: "1", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { selector: { app: "fast-deploy-00000" }, ports: [{ port: 80 }] },
  };
}

function apiResourceList(groupVersion, resources) {
  return {
    kind: "APIResourceList",
    apiVersion: "v1",
    groupVersion,
    resources: resources.map((item) => ({
      name: item.name,
      singularName: item.name.replace(/s$/, ""),
      namespaced: item.namespaced,
      kind: item.kind,
      verbs: ["get", "list", "watch", "create", "update", "patch", "delete"],
    })),
  };
}

function apiGroup(name, version) {
  return {
    name,
    versions: [{ groupVersion: `${name}/${version}`, version }],
    preferredVersion: { groupVersion: `${name}/${version}`, version },
  };
}

function podObject(name, namespace) {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name, namespace, uid: `uid-${namespace}-${name}`, resourceVersion: "1", creationTimestamp: "2026-01-01T00:00:00Z" },
    spec: { containers: [{ name: "app", image: "registry.example/fixture:2" }] },
    status: { phase: "Running", containerStatuses: [{ name: "app", ready: true }] },
  };
}

function summarizeFixtureRequests(requests) {
  const counts = {};
  for (const request of requests) {
    const key = `${request.method} ${request.resource}${request.dryRun === true ? " dry-run" : request.dryRun === false ? " apply" : ""}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return { total: requests.length, counts };
}

function writeJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function waitUntil(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function findPackagedExecutable() {
  const releaseDir = path.join(desktopRoot, "release");
  const packagedArch = process.env.ASTER_PACKAGED_ARCH || (process.arch === "arm64" ? "arm64" : "x64");
  const candidates = process.platform === "darwin"
    ? [
        path.join(releaseDir, packagedArch === "x64" ? "mac" : "mac-arm64", "Aster.app", "Contents", "MacOS", "Aster"),
        path.join(releaseDir, packagedArch === "x64" ? "mac-x64" : "mac-arm64", "Aster.app", "Contents", "MacOS", "Aster"),
        path.join(releaseDir, "mac", "Aster.app", "Contents", "MacOS", "Aster"),
        path.join(releaseDir, "mac-arm64", "Aster.app", "Contents", "MacOS", "Aster"),
      ]
    : process.platform === "win32"
      ? [path.join(releaseDir, "win-unpacked", "Aster.exe")]
      : [path.join(releaseDir, "linux-unpacked", "aster"), path.join(releaseDir, "linux-unpacked", "Aster")];
  const found = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (!found) throw new Error(`Could not find a packaged Aster executable. Checked:\n${candidates.join("\n")}`);
  return found;
}
