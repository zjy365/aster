import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Renderer smoke tests. The app boots in plain Chromium against vite preview
 * with a mock DesktopApi injected before any app code runs; no Tauri shell,
 * no Go core, no cluster. Covers what the shell-agnostic UI owns: picker,
 * sidebar, virtualized table, detail view, overflow, and console hygiene.
 * The Rust↔core pipeline is covered by the src-tauri integration tests.
 */

const TOTAL_DEPLOYMENTS = 10_000;
const PAGE_SIZE = 100;

// Self-contained: serialized into the page before app scripts execute.
const MOCK_DESKTOP_API = `
(() => {
  const TOTAL = ${TOTAL_DEPLOYMENTS};
  const PAGE = ${PAGE_SIZE};

  const contexts = [
    { id: "dev", name: "dev", cluster: "dev-cluster", server: "https://dev.invalid", user: "dev", namespace: "default", current: true, source: "fixture" },
    { id: "prod", name: "prod", cluster: "prod-cluster", server: "https://prod.invalid", user: "prod", namespace: "default", current: false, source: "fixture" },
  ];

  const discovery = [
    ["", "v1", "pods", "Pod", true],
    ["", "v1", "nodes", "Node", false],
    ["apps", "v1", "deployments", "Deployment", true],
    ["apps", "v1", "statefulsets", "StatefulSet", true],
    ["apps", "v1", "daemonsets", "DaemonSet", true],
    ["batch", "v1", "jobs", "Job", true],
    ["batch", "v1", "cronjobs", "CronJob", true],
    ["", "v1", "services", "Service", true],
    ["networking.k8s.io", "v1", "ingresses", "Ingress", true],
    ["networking.k8s.io", "v1", "networkpolicies", "NetworkPolicy", true],
    ["", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", true],
    ["", "v1", "persistentvolumes", "PersistentVolume", false],
    ["storage.k8s.io", "v1", "storageclasses", "StorageClass", false],
    ["", "v1", "configmaps", "ConfigMap", true],
    ["", "v1", "secrets", "Secret", true],
    ["", "v1", "namespaces", "Namespace", false],
    ["", "v1", "serviceaccounts", "ServiceAccount", true],
    ["rbac.authorization.k8s.io", "v1", "roles", "Role", true],
    ["rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", true],
    ["rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", false],
  ].map(([group, version, resource, kind, namespaced]) => ({ group, version, resource, kind, namespaced }));

  const row = (kind, index, namespaced) => ({
    uid: kind.id + "-uid-" + index,
    apiVersion: kind.group ? kind.group + "/" + kind.version : kind.version,
    kind: kind.kind,
    name: kind.resource + "-" + index,
    namespace: namespaced ? "default" : "",
    resourceVersion: "1000",
    createdAt: "2026-08-01T00:00:00Z",
    status: "Running",
    desired: 2,
    ready: 2,
    available: 2,
    updated: 2,
    images: ["nginx:1.27"],
  });

  const pageOf = (request) => {
    const index = request.continueToken ? Number(request.continueToken) : 0;
    const start = index * PAGE;
    const items = [];
    for (let i = start; i < Math.min(start + PAGE, TOTAL); i++) {
      items.push(row(request.resourceKind, i, request.resourceKind.namespaced));
    }
    const next = start + PAGE < TOTAL ? String(index + 1) : undefined;
    return {
      items,
      ...(next ? { continueToken: next } : {}),
      resourceVersion: "1000",
    };
  };

  window.__ASTER_DESKTOP__ = {
    platform: "darwin",
    app: {
      version: async () => "0.1.0",
      onCommand: () => () => undefined,
    },
    updater: {
      state: async () => ({ state: "disabled", currentVersion: "0.1.0" }),
      check: async () => undefined,
      download: async () => undefined,
      install: async () => undefined,
      onState: () => () => undefined,
    },
    appearance: { setThemeSource: async () => undefined },
    core: {
      status: async () => ({ state: "ready", version: "0.1.0" }),
      onStatus: () => () => undefined,
    },
    safety: { setReadOnly: async () => undefined },
    contexts: { list: async () => contexts },
    settings: {
      get: async () => ({ kubeconfigSources: [] }),
      setKubeconfigSources: async (sources) => ({ kubeconfigSources: sources }),
      applyKubeconfigSources: async () => undefined,
      pickKubeconfigFile: async () => null,
      pickKubeconfigFolder: async () => null,
    },
    discovery: { list: async () => discovery },
    namespaces: {
      list: async () => [
        { name: "default", status: "Active" },
        { name: "kube-system", status: "Active" },
      ],
    },
    metrics: { pods: async () => [] },
    resources: {
      list: async (request) => pageOf(request),
      get: async (request) => ({
        row: row(request.resourceKind, 0, request.resourceKind.namespaced),
        yaml: "apiVersion: apps/v1\\nkind: " + request.resourceKind.kind + "\\nmetadata:\\n  name: " + request.name + "\\n",
      }),
      events: async () => [
        { name: "event-1", namespace: "default", reason: "Scheduled", message: "Successfully assigned", type: "Normal", count: 1, lastTimestamp: "2026-08-01T00:00:00Z" },
      ],
      related: async () => [],
      search: async () => [],
      logs: async () => ({ text: "line one\\nline two\\n", truncated: false }),
      followLogs: (_request, _listener) => () => undefined,
      exec: async () => ({ stdout: "", stderr: "" }),
      portForwardStart: async () => ({ id: "pf-1", localPort: 12_345 }),
      portForwardStop: async () => undefined,
      mutate: async (request) => ({ operation: request.operation, dryRun: Boolean(request.dryRun), changed: true, resourceVersion: "1001", name: request.name }),
      watch: (request, listener) => {
        const timer = setTimeout(() => {
          listener({
            subscriptionId: "fixture-watch",
            kind: "snapshot",
            ...pageOf(request),
          });
        }, 0);
        return () => clearTimeout(timer);
      },
    },
  };
})();
`;

function collectFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  return failures;
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.horizontal, `${label} has horizontal overflow`).toBeLessThanOrEqual(0);
}

async function connectToDev(page: Page): Promise<void> {
  const option = page.getByTestId("context-option-dev");
  await option.click();
  await option.dblclick();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(MOCK_DESKTOP_API);
});

test("context picker renders without overflow at both viewports", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("context-option-dev")).toBeVisible();
  await expect(page.getByTestId("context-option-prod")).toBeVisible();
  await expectNoOverflow(page, "context picker 1280x800");
  await screenshot(page, "picker-1280");

  await page.setViewportSize({ width: 900, height: 640 });
  await expectNoOverflow(page, "context picker 900x640");
  await screenshot(page, "picker-900");
  expect(failures).toEqual([]);
});

test("workbench virtualizes the resource table", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  await expect(grid).toBeVisible();
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });

  // 10,000 fixture deployments exist; the DOM holds only the visible slice.
  const renderedRows = await grid.getByRole("row").count();
  expect(renderedRows).toBeLessThan(120);

  await expectNoOverflow(page, "workbench 1280x800");
  await screenshot(page, "workbench-1280");

  await page.setViewportSize({ width: 900, height: 640 });
  await expectNoOverflow(page, "workbench 900x640");
  await screenshot(page, "workbench-900");
  expect(failures).toEqual([]);
});

test("resource detail opens and preserves layout", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });
  await firstRow.click();

  const detail = page.getByTestId("resource-detail-view");
  await expect(detail).toBeVisible({ timeout: 15_000 });
  await expect(detail).toContainText("deployments-0");
  // Writes stay blocked until the context is explicitly unlocked.
  await expect(detail).toContainText("Blocked by read-only mode");

  await detail.getByRole("tab", { name: "YAML" }).click();
  // The YAML projection renders through the highlighter (tokens are split).
  await expect(detail).toContainText("apiVersion");
  await expectNoOverflow(page, "detail 1280x800");
  await screenshot(page, "detail-1280");
  expect(failures).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "..", "..", "output", "playwright");
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `renderer-${name}.png`) });
}
