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
    { id: "dev", name: "dev", cluster: "dev-cluster", server: "https://dev.invalid", user: "dev", namespace: "default", current: true, source: "fixture", conflicts: [{ path: "/Users/fixture/other.yaml", kind: "cluster", name: "dev-cluster", suggestion: "dev-cluster-hzh" }] },
    { id: "prod", name: "prod", cluster: "prod-cluster", server: "https://prod.invalid", user: "prod", namespace: "default", current: false, source: "fixture" },
    ...Array.from({ length: 58 }, (_, index) => ({
      id: "ctx-" + index,
      name: "ctx-" + index,
      cluster: "cluster-" + index,
      server: "https://cluster-" + index + ".invalid",
      user: "user-" + index,
      namespace: "default",
      current: false,
      source: "fixture",
    })),
  ];

  // Discovery returns only custom resources (CRDs); builtin kinds are static.
  // sealos.io folds three API groups under one domain; devbox.example.com
  // stays flat as the single group of its domain.
  const discovery = [
    ["license.sealos.io", "v1", "licenses", "License", true],
    ["license.sealos.io", "v1", "activationcodes", "ActivationCode", true],
    ["app.sealos.io", "v1beta1", "apps", "App", true],
    ["user.sealos.io", "v1", "users", "User", true],
    ["devbox.example.com", "v1", "widgets", "Widget", false],
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

  // A realistic Deployment object: selector, strategy, conditions, and
  // annotations feed the overview's structured sections and the pods scope.
  const deploymentYaml = (name) => [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: " + name,
    "  namespace: default",
    "  labels:",
    "    app: " + name,
    "  annotations:",
    "    deployment.kubernetes.io/revision: \\"3\\"",
    "    team: platform",
    "spec:",
    "  replicas: 2",
    "  selector:",
    "    matchLabels:",
    "      app: " + name,
    "  strategy:",
    "    type: RollingUpdate",
    "    rollingUpdate:",
    "      maxSurge: 25%",
    "      maxUnavailable: 0",
    "  template:",
    "    metadata:",
    "      labels:",
    "        app: " + name,
    "    spec:",
    "      serviceAccountName: default",
    "      containers:",
    "        - name: web",
    "          image: nginx:1.27",
    "status:",
    "  conditions:",
    "    - type: Available",
    "      status: \\"True\\"",
    "      reason: MinimumReplicasAvailable",
    "      message: Deployment has minimum availability.",
    "      lastTransitionTime: \\"2026-08-01T00:00:10Z\\"",
    "    - type: Progressing",
    "      status: \\"True\\"",
    "      reason: NewReplicaSetAvailable",
    "      lastTransitionTime: \\"2026-08-01T00:00:05Z\\"",
  ].join("\\n");

  window.__ASTER_DESKTOP__ = {
    platform: "darwin",
    app: {
      version: async () => "1.0.2",
      onCommand: () => () => undefined,
      openExternal: async (url) => {
        window.__asterOpenedUrls = window.__asterOpenedUrls || [];
        window.__asterOpenedUrls.push(url);
      },
    },
    updater: {
      state: async () => ({ state: "disabled", currentVersion: "1.0.2" }),
      check: async () => undefined,
      download: async () => undefined,
      install: async () => undefined,
      onState: () => () => undefined,
    },
    appearance: { setThemeSource: async () => undefined },
    files: { saveTextFile: async () => null },
    core: {
      status: async () => ({ state: "ready", version: "1.0.2" }),
      onStatus: () => () => undefined,
    },
    contexts: {
      list: async () => contexts,
      sourcesReport: async () => ({
        chain: [{ path: "/Users/fixture/.kube/config", kind: "file", files: 1, contexts: 2, default: true }],
        configured: [],
      }),
      renameConflict: async (request) => { window.__renamedConflict = request; },
    },
    settings: {
      get: async () => ({ kubeconfigSources: [], includeStandardChain: true }),
      setKubeconfigSources: async (sources, includeStandardChain) => ({ kubeconfigSources: sources, includeStandardChain }),
      applyKubeconfigSources: async () => undefined,
      pickKubeconfigFile: async () => null,
      pickKubeconfigFolder: async () => null,
    },
    discovery: { list: async () => discovery },
    namespaces: {
      // Per-context lists: dev has two namespaces, prod only one, so the
      // context-switch regression test can tell a stale list apart.
      list: async (contextId) => ({
        namespaces: contextId === "prod"
          ? [{ name: "default", status: "Active" }]
          : [
              { name: "default", status: "Active" },
              { name: "kube-system", status: "Active" },
            ],
        truncated: false,
      }),
    },
    metrics: {
      pods: async (_contextId, namespace) => {
        // One container per pod, values oscillate so the detail chart shows a
        // line, and the pod detail the test opens (pods-0) reports usage.
        const value = (base, index) => base + (index % 3) * 5;
        return [
          { name: "pods-0", namespace: namespace || "default", containers: [{ name: "app", cpu: value(120, 0) + "m", memory: (96 + (0 % 3) * 8) + "Mi" }] },
          { name: "pods-1", namespace: namespace || "default", containers: [{ name: "app", cpu: value(80, 1) + "m", memory: (64 + (1 % 3) * 8) + "Mi" }] },
          { name: "pods-2", namespace: namespace || "default", containers: [{ name: "app", cpu: value(200, 2) + "m", memory: (192 + (2 % 3) * 8) + "Mi" }] },
        ];
      },
    },
    overview: {
      get: async () => ({
        nodes: { total: 3, ready: 3 },
        pods: { total: 24, ready: 22 },
        namespaces: 5,
        services: 8,
        resource: {
          cpu: { requested: 1500, limited: 3000, allocatable: 12000 },
          memory: { requested: 3221225472, limited: 6442450944, allocatable: 25769803776 },
        },
        events: [
          { namespace: "default", name: "web-0", reason: "Started", message: "Started container web", type: "Normal", count: 1, lastTimestamp: "2026-08-16T12:00:00Z" },
          { namespace: "kube-system", name: "coredns-0", reason: "BackOff", message: "Back-off restarting failed container", type: "Warning", count: 14, lastTimestamp: "2026-08-16T11:58:00Z" },
        ],
      }),
    },
    helm: {
      list: async (_contextId, namespace) => [
        { name: "web", namespace, version: 3, status: "deployed", chart: "web", chartVersion: "1.2.3", appVersion: "7.0", updatedAt: "2026-08-01T00:00:00Z", description: "Install complete" },
        { name: "broken", namespace, version: 1, status: "failed", chart: "broken", chartVersion: "0.1.0", appVersion: "1.0", updatedAt: "2026-08-02T00:00:00Z" },
      ],
      get: async (request) => ({
        name: request.name,
        namespace: request.namespace,
        version: 3,
        status: "deployed",
        chart: "web",
        chartVersion: "1.2.3",
        appVersion: "7.0",
        updatedAt: "2026-08-01T00:00:00Z",
        description: "Install complete",
        values: "replicas: 2",
        manifest: "apiVersion: v1\\nkind: ConfigMap\\nmetadata:\\n  name: web-cm\\n",
        truncated: false,
        history: [
          { name: request.name, namespace: request.namespace, version: 3, status: "deployed", chart: "web", chartVersion: "1.2.3", appVersion: "7.0", updatedAt: "2026-08-01T00:00:00Z" },
          { name: request.name, namespace: request.namespace, version: 2, status: "superseded", chart: "web", chartVersion: "1.2.2", appVersion: "7.0", updatedAt: "2026-07-01T00:00:00Z" },
        ],
      }),
      uninstall: async () => undefined,
      rollback: async () => undefined,
    },
    resources: {
      list: async (request) => pageOf(request),
      get: async (request) => ({
        row: row(request.resourceKind, 0, request.resourceKind.namespaced),
        yaml: request.resourceKind.kind === "Deployment"
          ? deploymentYaml(request.name)
          : "apiVersion: apps/v1\\nkind: " + request.resourceKind.kind + "\\nmetadata:\\n  name: " + request.name + "\\n",
      }),
      events: async () => [
        { name: "event-1", namespace: "default", reason: "Scheduled", message: "Successfully assigned", type: "Normal", count: 1, lastTimestamp: "2026-08-01T00:00:00Z" },
      ],
      related: async (request) => request.resourceKind.kind === "Deployment" ? [
        { group: "apps", version: "v1", resource: "replicasets", kind: "ReplicaSet", namespace: "default", name: request.name + "-5d47d688c8", relation: "owned" },
        { group: "apps", version: "v1", resource: "replicasets", kind: "ReplicaSet", namespace: "default", name: request.name + "-746dd895cc", relation: "owned" },
        { group: "", version: "v1", resource: "services", kind: "Service", namespace: "default", name: request.name + "-service", relation: "selects" },
      ] : [],
      search: async () => [],
      logs: async () => ({
        text: "2026-08-17T08:45:02.100Z INFO snapshot line one\\n2026-08-17T08:45:03.200Z ERROR snapshot line two\\n",
        truncated: false,
        containers: ["app", "sidecar"],
      }),
      followLogs: (_request, listener) => {
        const lines = [
          "2026-08-17T08:45:02.100Z INFO stream started",
          "2026-08-17T08:45:03.200Z ERROR simulated failure",
          "2026-08-17T08:45:04.300Z plain output line",
        ];
        const timers = lines.map((text, index) =>
          setTimeout(() => listener({ subscriptionId: "fixture-logs", type: "line", text }), 20 * (index + 1)));
        return () => timers.forEach(clearTimeout);
      },
      workloadLogs: async () => ({
        lines: [
          { pod: "deployments-0-abc12-x1", text: "2026-08-17T08:45:01.0Z INFO boot" },
        ],
        pods: ["deployments-0-abc12-x1", "deployments-0-abc12-x2"],
        containers: ["app", "sidecar"],
        truncated: false,
      }),
      followWorkloadLogs: (_request, listener) => {
        const lines = [
          { pod: "deployments-0-abc12-x1", text: "2026-08-17T08:45:01.0Z INFO pod one boot" },
          { pod: "deployments-0-abc12-x2", text: "2026-08-17T08:45:02.0Z WARN pod two slow start" },
          { pod: "deployments-0-abc12-x1", text: "2026-08-17T08:45:03.0Z ERROR pod one probe failed" },
        ];
        const timers = lines.map((line, index) =>
          setTimeout(() => listener({ subscriptionId: "fixture-wlogs", type: "line", ...line }), 20 * (index + 1)));
        return () => timers.forEach(clearTimeout);
      },
      exec: async () => ({ stdout: "", stderr: "" }),
      portForwardStart: async () => ({ id: "pf-1", localPort: 12_345 }),
      portForwardStop: async () => undefined,
      mutate: async (request) => {
        // Mirror the API server's optimistic concurrency: the live object sits
        // at resourceVersion 1001 (the dry-run response reports it), so an apply
        // presenting any other version — e.g. the stale list snapshot 1000 —
        // is rejected.
        if (!request.dryRun && request.resourceVersion && request.resourceVersion !== "1001") {
          throw new Error("resource version conflict: expected " + request.resourceVersion + ", got 1001");
        }
        // Mirror the API server: a scale dry-run echoes the would-be object,
        // including server-managed bumps (generation) the review diff filters out.
        const yaml = request.dryRun && request.operation === "scale" && request.resourceKind.kind === "Deployment"
          ? deploymentYaml(request.name)
              .replace("  replicas: 2", "  replicas: " + request.replicas)
              .replace("  namespace: default", "  namespace: default\\n  generation: 2")
          : request.operation === "create"
            ? request.yaml
            : undefined;
        return { operation: request.operation, dryRun: Boolean(request.dryRun), changed: true, resourceVersion: "1001", name: request.name, yaml };
      },
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

test("context picker marks a context with kubeconfig name conflicts", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  // The dev context carries a conflicts array (same name in another source).
  const option = page.getByTestId("context-option-dev");
  await expect(option).toBeVisible();
  // The warning row (icon + text, one line) is the tooltip trigger.
  const trigger = page.getByTestId("context-conflict-dev");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("1 other source");
  // The row must stay inside its card, in the narrow grid layout too.
  await page.getByTestId("context-layout-grid").click();
  await page.setViewportSize({ width: 900, height: 640 });
  const cardBox = await option.boundingBox();
  const warnBox = await trigger.boundingBox();
  expect(warnBox!.x + warnBox!.width, "warning row overflows its card horizontally")
    .toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
  expect(warnBox!.y + warnBox!.height, "warning row overflows its card vertically")
    .toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
  await page.setViewportSize({ width: 1280, height: 800 });
  await trigger.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Connecting to https://dev.invalid",
    { timeout: 5000 },
  );
  await expectNoOverflow(page, "context picker conflict 1280x800");
  await screenshot(page, "picker-conflict-1280");

  // Clicking the warning opens the fix dialog; renaming resolves the conflict
  // in the file itself, with a suggested collision-free name prefilled.
  await trigger.click();
  const dialog = page.getByTestId("context-conflict-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("defined by 2 sources");
  await expect(dialog).toContainText("/Users/fixture/other.yaml");
  await dialog.getByTestId("context-conflict-rename").click();
  const input = dialog.getByTestId("context-conflict-input");
  await expect(input).toHaveValue("dev-cluster-hzh");
  await screenshot(page, "picker-conflict-dialog");
  await input.fill("dev-cluster-renamed");
  await dialog.getByTestId("context-conflict-rename-apply").click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __renamedConflict: unknown }).__renamedConflict),
  ).toEqual({
    path: "/Users/fixture/other.yaml",
    kind: "cluster",
    name: "dev-cluster",
    newName: "dev-cluster-renamed",
  });
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

test("overview is a sidebar pane and swaps back to the resource table", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  // The overview is a workbench pane like a resource kind: the sidebar and
  // the toolbar stay in place while the content area shows the summary.
  await page.getByTestId("source-list-overview").click();
  const overview = page.getByTestId("overview-view");
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("Overview");
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  await expect(page.getByTestId("unified-toolbar")).toBeVisible();
  await expect(page.getByTestId("source-list")).toBeVisible();

  // Only the overview entry is highlighted while the pane is active.
  await expect(page.getByTestId("source-list-overview")).toHaveClass(/active/);
  await expect(page.getByTestId("resource-nav-deployments")).not.toHaveClass(/active/);

  // Overview and Helm live inside the scrollable resource list, not pinned
  // above it.
  const nav = page.getByTestId("resource-navigation");
  await expect(nav.getByTestId("source-list-overview")).toHaveCount(1);
  await expect(nav.getByTestId("source-list-tools")).toHaveCount(1);

  // Stat cards carry the fixture counts and readiness.
  await expect(overview.getByTestId("overview-card-nodes")).toContainText("3");
  await expect(overview.getByTestId("overview-card-nodes")).toContainText("All ready");
  await expect(overview.getByTestId("overview-card-pods")).toContainText("24");
  await expect(overview.getByTestId("overview-card-pods")).toContainText("2 not ready");

  // Resource usage bars and recent events render.
  await expect(overview.getByTestId("overview-usage-cpu")).toBeVisible();
  await expect(overview.getByTestId("overview-usage-memory")).toBeVisible();
  await expect(overview.getByTestId("overview-events")).toContainText("BackOff");
  await expect(overview.getByTestId("overview-events")).toContainText("Started");

  await expectNoOverflow(page, "overview 1280x800");
  await screenshot(page, "overview-1280");

  // Cards navigate into the resource list for that kind.
  await overview.getByTestId("overview-card-nodes").click();
  await expect(page.getByTestId("overview-view")).toHaveCount(0);
  const grid = page.getByRole("grid", { name: "Resources" });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("row").nth(1)).toContainText("nodes-0");

  // Selecting the overview again swaps the table back out.
  await page.getByTestId("source-list-overview").click();
  await expect(page.getByTestId("overview-view")).toBeVisible();
  await expect(grid).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("custom resources nest by API domain and scroll with the sidebar", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const nav = page.getByTestId("resource-navigation");
  const overview = page.getByTestId("source-list-overview");

  // The sidebar is one scrollable list: the overview entry moves with it
  // instead of staying pinned at the top.
  const before = await overview.boundingBox();
  expect(before).not.toBeNull();
  await nav.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const after = await overview.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y).toBeLessThan(before!.y);

  // Custom resources fold under their API domain; a folded row carries the
  // number of kinds it hides.
  const sealos = page.getByTestId("group-toggle-custom-resources-sealos-io");
  await sealos.scrollIntoViewIfNeeded();
  await expect(sealos).toContainText("sealos.io");
  await expect(sealos).toContainText("4");
  await screenshot(page, "sidebar-custom-collapsed-1280");

  await sealos.click();
  const license = page.getByTestId("group-toggle-sealos-io-license");
  await expect(license).toBeVisible();
  await expect(license).toContainText("2");

  // Expanding the API group reveals selectable custom kinds.
  await license.click();
  const licenses = page.getByTestId("resource-nav-crd-license-sealos-io-v1-licenses");
  await expect(licenses).toBeVisible();
  await licenses.click();
  const grid = page.getByRole("grid", { name: "Resources" });
  await expect(grid.getByRole("row").nth(1)).toContainText("licenses-0", { timeout: 15_000 });

  await expectNoOverflow(page, "custom resources sidebar");
  await screenshot(page, "sidebar-custom-1280");
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
  // Writes are always available; changes are previewed before apply.
  await expect(page.getByTestId("resource-detail-status")).toContainText(
    "Changes are previewed before apply."
  );

  // Object-scoped actions live in the identity header, above the fold.
  const actions = page.getByTestId("resource-detail-actions");
  await expect(actions.getByTestId("resource-action-scale")).toBeVisible();
  await expect(actions.getByTestId("resource-action-image")).toBeVisible();
  await expect(actions.getByTestId("resource-action-restart")).toBeVisible();
  await expect(actions.getByTestId("delete-resource")).toBeVisible();
  // Wide layout resolves actions inline, so the More menu stays out of the tree.
  await expect(page.getByTestId("resource-actions-more")).toBeHidden();

  // Replica counters lead the overview instead of sitting in the metadata grid.
  await expect(page.getByTestId("resource-vitals")).toBeVisible();
  // Structured sections parsed from the live object: rollout conditions,
  // container images with names, and selector/strategy in the info grid.
  await expect(page.getByTestId("resource-conditions")).toContainText("Available");
  await expect(page.getByTestId("overview-containers")).toContainText("nginx:1.27");
  await expect(detail).toContainText("RollingUpdate");
  // The scoped pods preview links through to the dedicated Pods tab.
  await expect(page.getByTestId("overview-pods")).toContainText("pods-0", { timeout: 15_000 });
  await expectNoOverflow(page, "detail overview 1280x800");
  await screenshot(page, "detail-overview-1280");

  await detail.getByRole("tab", { name: /Pods/ }).click();
  const podsPanel = page.getByTestId("workload-pods");
  await expect(podsPanel).toBeVisible();
  await expect(podsPanel.getByTestId("workload-pod-pods-0")).toBeVisible();
  await expectNoOverflow(page, "detail pods 1280x800");
  await screenshot(page, "detail-pods-1280");

  await detail.getByRole("tab", { name: "YAML" }).click();
  // The YAML projection renders through the highlighter (tokens are split).
  await expect(detail).toContainText("apiVersion");
  // Actions stay reachable from every tab, not just Overview.
  await expect(actions.getByTestId("delete-resource")).toBeVisible();
  await expectNoOverflow(page, "detail 1280x800");
  await screenshot(page, "detail-1280");
  expect(failures).toEqual([]);
});

test("mutation review renders a collapsed GitHub-style diff", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });
  await firstRow.click();

  await page.getByTestId("resource-action-scale").click();
  const scaleDialog = page.getByTestId("resource-operation-dialog");
  await expect(scaleDialog).toBeVisible();
  await scaleDialog.getByLabel("Desired replicas").fill("5");
  await scaleDialog.getByTestId("operation-prepare-dry-run").click();

  const dialog = page.getByTestId("mutation-review-dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const diff = dialog.locator(".mutation-review-diff");
  await expect(diff).toBeVisible();
  // The diff surface renders hunks, not the whole object: the changed replicas
  // line shows up, while the server-managed generation bump is filtered out.
  await expect(diff).toContainText("replicas: 5", { timeout: 15_000 });
  await expect(diff).not.toContainText("generation");
  await expect(dialog.getByTestId("mutation-apply")).toBeEnabled();
  await expectNoOverflow(page, "mutation review diff 1280x800");
  await screenshot(page, "mutation-review-1280");

  // Apply presents the dry-run's resourceVersion (1001), not the stale list
  // snapshot (1000) — the mock rejects anything else with a conflict.
  await dialog.getByTestId("mutation-apply").click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  expect(failures).toEqual([]);
});

test("create review renders the preview as a pure addition", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  await page.getByTestId("new-resource").click();
  const dialog = page.getByTestId("create-resource-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("create-yaml-editor").fill(
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: review-me\n  namespace: default\n",
  );
  await dialog.getByTestId("create-prepare-dry-run").click();

  // The review reuses the GitHub-style diff surface: the new object is one
  // pure addition, no server-side noise lines.
  const diff = dialog.locator(".mutation-review-diff");
  await expect(diff).toContainText("name: review-me", { timeout: 15_000 });
  await expect(diff).not.toContainText("generation");
  await expectNoOverflow(page, "create review 1280x800");
  await screenshot(page, "create-review-1280");

  await dialog.getByTestId("create-apply").click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  expect(failures).toEqual([]);
});

test("overview splits into main and aside columns on a wide workspace", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });
  await firstRow.click();

  await expect(page.getByTestId("resource-detail-view")).toBeVisible({ timeout: 15_000 });
  const overviewEvents = page.getByTestId("overview-events");
  await expect(overviewEvents).toBeVisible();

  // The aside sits beside the main column rather than below it: its left edge
  // must start after the metadata grid ends.
  const asideBox = await overviewEvents.boundingBox();
  const mainBox = await page.getByTestId("resource-vitals").boundingBox();
  expect(asideBox && mainBox).toBeTruthy();
  expect(asideBox!.x).toBeGreaterThan(mainBox!.x + 400);

  await expectNoOverflow(page, "detail overview 1680x900");
  await screenshot(page, "detail-overview-1680");

  // The vitals strip introduces positive/caution tokens: verify both appearances.
  await page.getByTestId("theme-menu").click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("resource-vitals")).toBeVisible();
  await expectNoOverflow(page, "detail overview dark 1680x900");
  await screenshot(page, "detail-overview-1680-dark");
  expect(failures).toEqual([]);
});

test("detail actions collapse into one More menu on a narrow window", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });
  await firstRow.click();

  await expect(page.getByTestId("resource-detail-view")).toBeVisible({ timeout: 15_000 });
  // Safe actions fold away; the destructive action is never buried in a menu.
  await expect(page.getByTestId("resource-action-scale")).toBeHidden();
  await expect(page.getByTestId("delete-resource")).toBeVisible();

  await page.getByTestId("resource-actions-more").click();
  await expect(page.getByTestId("resource-action-menu-scale")).toBeVisible();
  await expect(page.getByTestId("resource-action-menu-restart")).toBeVisible();
  await page.keyboard.press("Escape");

  await expectNoOverflow(page, "detail 1000x800");
  await screenshot(page, "detail-narrow-1000");
  expect(failures).toEqual([]);
});

test("pod detail shows live resource usage charts", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  await page.getByTestId("resource-nav-pods").click();
  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("pods-0", { timeout: 15_000 });

  // The Pod table carries the live CPU/memory readout columns ahead of Ready.
  const headerText = await grid.getByRole("row").first().textContent();
  expect(headerText?.indexOf("CPU") ?? -1).toBeGreaterThan(-1);
  expect(headerText!.indexOf("CPU")).toBeLessThan(headerText!.indexOf("Ready"));
  expect(headerText!.indexOf("Memory")).toBeLessThan(headerText!.indexOf("Ready"));
  await expect(firstRow).toContainText("120m");
  await expect(firstRow).toContainText("96.0 MiB");
  await expectNoOverflow(page, "pod table with metrics 1280x800");
  await screenshot(page, "pod-table-metrics-1280");

  await firstRow.click();
  const detail = page.getByTestId("resource-detail-view");
  await expect(detail).toBeVisible({ timeout: 15_000 });

  // The overview renders the usage charts once the first sample lands.
  const usage = page.getByTestId("pod-usage");
  await expect(usage).toBeVisible({ timeout: 15_000 });
  await expect(usage).toContainText("Resource usage");
  await expect(usage).toContainText("120m");
  await expect(usage).toContainText("96.0 MiB");
  await expect(usage.getByTestId("pod-usage-refresh")).toBeVisible();
  await expectNoOverflow(page, "pod detail usage 1280x800");
  await screenshot(page, "pod-usage-1280");

  // The chart surface itself renders an SVG per series (CPU and memory).
  await expect(usage.locator(".recharts-wrapper svg").first()).toBeVisible();
  await expect(usage.locator(".pod-usage-area")).toHaveCount(2);
  expect(failures).toEqual([]);
});

test("pod log viewer streams into the terminal surface", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  await page.getByTestId("resource-nav-pods").click();
  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("pods-0", { timeout: 15_000 });
  await firstRow.click();

  const detail = page.getByTestId("resource-detail-view");
  await detail.getByRole("tab", { name: "Logs" }).click();

  const viewer = page.getByTestId("log-viewer");
  await expect(viewer).toBeVisible();
  // Follow is on by default: streamed lines land on the terminal surface.
  await expect(viewer).toContainText("3 lines", { timeout: 15_000 });
  await expect(page.getByTestId("logs-container-select")).toBeVisible();

  await page.getByTestId("logs-search-toggle").click();
  await expect(page.getByTestId("logs-search-bar")).toBeVisible();
  await page.getByTestId("logs-search-bar").getByLabel("Search in logs").fill("simulated");
  await expect(page.getByTestId("logs-search-bar")).toContainText("of 1");

  await expectNoOverflow(page, "log viewer 1280x800");
  await screenshot(page, "logs-1280");
  expect(failures).toEqual([]);
});

test("workload detail streams aggregated logs with pod prefixes", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const grid = page.getByRole("grid", { name: "Resources" });
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow).toContainText("deployments-0", { timeout: 15_000 });
  await firstRow.click();

  const detail = page.getByTestId("resource-detail-view");
  await detail.getByRole("tab", { name: "Logs" }).click();

  const viewer = page.getByTestId("log-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("3 lines", { timeout: 15_000 });
  await expect(page.getByTestId("logs-container-select")).toBeVisible();
  // Previous is per-pod semantics: hidden in workload fan-in mode.
  await expect(viewer.getByLabel("Previous")).toHaveCount(0);

  await expectNoOverflow(page, "workload logs 1280x800");
  await screenshot(page, "workload-logs-1280");
  expect(failures).toEqual([]);
});

test("settings opens as a page and returns to the picker", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("context-picker-settings").click();

  // Settings is a full page view, not a modal.
  const settings = page.getByTestId("settings-page");
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId("context-picker-list")).toHaveCount(0);
  await expectNoOverflow(page, "settings page");

  // Appearance is the default section: theme options are present.
  await expect(settings.getByTestId("settings-theme-system")).toBeVisible();
  await expect(settings.getByTestId("settings-theme-dark")).toBeVisible();

  // Palette cards apply their CSS variables to <html> and persist; switching
  // back to the default removes the overrides so :root governs again.
  await expect(settings.getByTestId("settings-palette-aster")).toBeVisible();
  await settings.getByTestId("settings-palette-ocean").click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--brand")))
    .toBe("#0e6fb8");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("aster.theme-palette")))
    .toBe("ocean");
  await screenshot(page, "settings-palette-ocean");
  await settings.getByTestId("settings-palette-aster").click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--brand")))
    .toBe("");

  // Kubeconfig shows the standard chain with per-source context counts.
  await settings.getByTestId("settings-tab-kubeconfig").click();
  await expect(settings.getByTestId("settings-chain-list")).toContainText("/Users/fixture/.kube/config");
  await expect(settings.getByTestId("settings-chain-list")).toContainText("2 contexts");
  await expect(settings.getByTestId("settings-chain-list")).toContainText("Default");
  await expect(settings.getByTestId("settings-source-list")).toContainText("No extra sources");

  // The chain is a default, not a privilege: it can be switched off, which
  // dirties the form and, with no other sources, explains the empty state.
  const chainToggle = settings.getByTestId("settings-chain-toggle");
  await expect(chainToggle).toHaveAttribute("aria-checked", "true");
  await chainToggle.click();
  await expect(chainToggle).toHaveAttribute("aria-checked", "false");
  await expect(settings.getByTestId("settings-chain-off")).toBeVisible();
  await expect(settings.getByTestId("settings-source-list")).toContainText("No sources at all");
  await expect(settings.getByTestId("settings-apply")).toBeEnabled();
  await settings.getByRole("button", { name: "Revert" }).click();
  await expect(chainToggle).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByTestId("settings-chain-list")).toContainText("/Users/fixture/.kube/config");
  await expect(settings.getByTestId("settings-apply")).toBeDisabled();
  await screenshot(page, "settings-kubeconfig");

  // Manual path entry admits extension-less kubeconfigs, then Apply is live.
  await settings.getByTestId("settings-path-input").fill("/Users/fixture/.kube/devbox-review-189-kubeconfig");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await expect(settings.getByTestId("settings-source-list")).toContainText("devbox-review-189-kubeconfig");
  await expect(settings.getByTestId("settings-apply")).toBeEnabled();

  // About reports version and a core state.
  await settings.getByTestId("settings-tab-about").click();
  await expect(settings).toContainText("1.0.2");
  await expect(settings).toContainText("Ready");
  await expect(settings.getByTestId("settings-check-updates")).toBeVisible();

  // Community links in the sidebar hand their URLs to the shell opener.
  await settings.getByTestId("settings-link-github").click();
  await settings.getByTestId("settings-link-x").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __asterOpenedUrls?: string[] }).__asterOpenedUrls ?? []))
    .toEqual(["https://github.com/zjy365", "https://x.com/zjy365"]);

  // Let the 150ms tab highlight transition settle so the screenshot shows the
  // final state instead of a mid-fade frame.
  await page.waitForTimeout(200);
  await screenshot(page, "settings");
  expect(failures).toEqual([]);

  // Back returns to the context picker.
  await settings.getByTestId("settings-back").click();
  await expect(page.getByTestId("context-picker")).toBeVisible();
  await expect(page.getByTestId("context-option-prod")).toBeVisible();
});

test("settings opens with no kubeconfig at all", async ({ page }) => {
  // A machine with no kubeconfig: the core reports zero contexts and an empty
  // standard chain (the wire contract is [], never null — a null here once
  // crashed the settings page on open).
  await page.addInitScript(() => {
    const desktop = (window as unknown as { __ASTER_DESKTOP__?: { contexts: Record<string, unknown> } }).__ASTER_DESKTOP__;
    if (desktop) {
      desktop.contexts.list = async () => [];
      desktop.contexts.sourcesReport = async () => ({ chain: [], configured: [] });
    }
  });
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await expect(page.getByTestId("context-picker-empty")).toContainText("No contexts found");
  // The empty state guides straight into Settings instead of the toolbar gear.
  await page.getByTestId("context-picker-empty-settings").click();

  const settings = page.getByTestId("settings-page");
  await expect(settings).toBeVisible();
  await settings.getByTestId("settings-tab-kubeconfig").click();
  await expect(settings.getByTestId("settings-chain-list")).toContainText(
    "No kubeconfig found in the standard chain.",
  );
  await expectNoOverflow(page, "settings page with no kubeconfig");
  await screenshot(page, "settings-no-kubeconfig");
  expect(failures).toEqual([]);
});

test("settings opens from the workbench toolbar and returns", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const toolbar = page.getByTestId("unified-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByTestId("open-settings").click();

  const settings = page.getByTestId("settings-page");
  await expect(settings).toBeVisible();
  await expectNoOverflow(page, "settings page from workbench");

  // Back returns to the workbench, not the context picker.
  await settings.getByTestId("settings-back").click();
  await expect(page.getByTestId("unified-toolbar")).toBeVisible();
  await expect(page.getByRole("grid", { name: "Resources" })).toBeVisible();
  expect(failures).toEqual([]);
});

test("helm view lists releases and opens a detail", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  // The Helm group lives above the resource navigation in the source list.
  await page.getByTestId("tool-nav-helm").click();
  const view = page.getByTestId("helm-view");
  await expect(view).toBeVisible();
  await expect(view).toContainText("Releases");
  await expect(view.getByTestId("helm-release-web")).toContainText("deployed");
  await expect(view.getByTestId("helm-release-broken")).toContainText("failed");
  await expectNoOverflow(page, "helm list 1280x800");
  await screenshot(page, "helm-list-1280");

  // Selecting a release opens the read view: values, manifest, history.
  await view.getByTestId("helm-release-web").click();
  const detail = page.getByTestId("helm-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("web");
  await expect(detail.getByTestId("helm-values")).toContainText("replicas");
  await expect(detail.getByTestId("helm-manifest")).toContainText("ConfigMap");
  await expect(detail.getByTestId("helm-history")).toContainText("v3");
  await expect(detail.getByTestId("helm-rollback")).toBeVisible();
  await expect(detail.getByTestId("helm-uninstall")).toBeVisible();
  await expectNoOverflow(page, "helm detail 1280x800");
  await screenshot(page, "helm-detail-1280");

  // Back returns to the release list; the helm tab stays active.
  await detail.getByTestId("helm-back").click();
  await expect(page.getByTestId("helm-table")).toBeVisible();
  await expect(view.getByTestId("helm-release-broken")).toBeVisible();
  expect(failures).toEqual([]);
});

test("context picker keeps the brand visible when many contexts scroll", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("context-option-prod")).toBeVisible();

  const brand = page.locator(".context-picker-brand");
  const list = page.getByTestId("context-picker-list");
  await expect(brand).toBeVisible();

  // The list owns the scroll; the page itself never scrolls.
  const scrollState = await page.evaluate(() => {
    const listEl = document.querySelector('[data-testid="context-picker-list"]');
    return {
      listScrolls: listEl ? listEl.scrollHeight > listEl.clientHeight : false,
      pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });
  expect(scrollState.listScrolls).toBe(true);
  expect(scrollState.pageScrolls).toBe(false);

  // Scrolling to the bottom of the list leaves the brand pinned.
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(brand).toBeVisible();
  await expectNoOverflow(page, "picker with many contexts");
  expect(failures).toEqual([]);
});

test("namespace picker refetches the list after each context switch", async ({ page }) => {
  const failures = collectFailures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await connectToDev(page);

  const openPicker = async () => {
    await page.getByTestId("namespace-select").click();
    await expect(page.getByTestId("namespace-filter")).toBeVisible();
  };
  const namespaceItem = (name: string) =>
    page.locator(".namespace-combobox-item", { hasText: name });

  // dev: the list loads on first open.
  await openPicker();
  await expect(namespaceItem("kube-system")).toBeVisible();
  await page.keyboard.press("Escape");

  // Switch to prod: only prod's namespaces may appear — never dev's stale list.
  await page.getByTestId("change-context").click();
  const prod = page.getByTestId("context-option-prod");
  await prod.click();
  await prod.dblclick();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  await openPicker();
  await expect(namespaceItem("default")).toBeVisible();
  await expect(namespaceItem("kube-system")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Back to dev: the list must load again (regression: it stayed empty).
  await page.getByTestId("change-context").click();
  await connectToDev(page);
  await openPicker();
  await expect(namespaceItem("kube-system")).toBeVisible();
  await screenshot(page, "namespace-picker-after-context-switch");
  expect(failures).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "..", "..", "output", "playwright");
  fs.mkdirSync(directory, { recursive: true });
  // "disabled" fast-forwards CSS transitions (e.g. the sidebar highlight
  // fade) so screenshots show the resting state, not a mid-fade frame.
  await page.screenshot({ path: path.join(directory, `renderer-${name}.png`), animations: "disabled" });
}
