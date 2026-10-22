import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

import type { DesktopApi, NodeMetric } from "../src/shared/types";
import type { NodeMetricsState } from "../src/renderer/hooks/useNodeMetrics";

interface MetricsProbe {
  state: NodeMetricsState;
  select(contextId: string, name: string): void;
  requests: Array<{
    contextId: string;
    resolve(metrics: NodeMetric[]): void;
    reject(error: Error): void;
  }>;
}

declare global {
  interface Window {
    __nodeMetricsProbe: MetricsProbe;
  }
}

// Exercise the real hook with React in Chromium. Deferred DesktopApi mocks
// make response ordering deterministic without a DOM library or a cluster.
let harness: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { useNodeMetrics } from "./src/renderer/hooks/useNodeMetrics";

        const probe = window.__nodeMetricsProbe;

        function Harness() {
          const [identity, setIdentity] = useState({ contextId: "dev", name: "worker-1" });
          probe.state = useNodeMetrics(identity.contextId, identity.name);
          probe.select = (contextId, name) => setIdentity({ contextId, name });
          return <div>Node metrics hook</div>;
        }
        createRoot(document.getElementById("root")).render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
  });
  harness = bundle.outputFiles[0].text;
});

async function mountHarness(page: Page): Promise<void> {
  await page.route("**/__node-metrics", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body><div id='root'></div></body></html>",
  }));
  await page.goto("/__node-metrics");
  await page.clock.install();
  await page.evaluate(() => {
    const probe = window.__nodeMetricsProbe = { requests: [] } as unknown as MetricsProbe;
    window.__ASTER_DESKTOP__ = { metrics: {
      nodes: (contextId: string) => new Promise<NodeMetric[]>((resolve, reject) => probe.requests.push({ contextId, resolve, reject })),
    } } as unknown as DesktopApi;
  });
  await page.addScriptTag({ content: harness });
  await expect.poll(() => page.evaluate(() => window.__nodeMetricsProbe.requests.length)).toBe(1);
}

async function settle(page: Page): Promise<void> {
  // Flush React's scheduled render before asserting that a late response had
  // no effect; an immediate negative assertion could otherwise pass early.
  await page.clock.runFor(50);
}

async function resolveMetrics(page: Page, index: number, name: string, cpu: string): Promise<void> {
  await page.evaluate(({ index, name, cpu }) => {
    window.__nodeMetricsProbe.requests[index].resolve([{ name, cpu, memory: "1Gi" }]);
  }, { index, name, cpu });
  await settle(page);
}

async function selectNode(page: Page, contextId: string, name: string): Promise<void> {
  await page.evaluate(({ contextId, name }) => window.__nodeMetricsProbe.select(contextId, name), { contextId, name });
  await settle(page);
}

test("node metrics resets samples and readout when the node or cluster changes", async ({ page }) => {
  await mountHarness(page);
  await resolveMetrics(page, 0, "worker-1", "250m");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.cpu)).toBe("250m");

  await selectNode(page, "dev", "worker-2");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state)).toMatchObject({ samples: [], loading: true, error: "" });
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.cpu)).toBeUndefined();
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.memory)).toBeUndefined();
  await resolveMetrics(page, 1, "worker-2", "750m");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.samples.map((sample) => sample.cpuMillicores))).toEqual([750]);

  // Identical node names in different clusters must not share history.
  await selectNode(page, "prod", "worker-2");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.samples)).toEqual([]);
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.cpu)).toBeUndefined();
  await page.evaluate(() => window.__nodeMetricsProbe.requests[2].resolve([]));
  await settle(page);
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state)).toMatchObject({ samples: [], loading: false, error: "" });
});

for (const outcome of ["success", "error"] as const) {
  test(`node metrics ignores stale manual refresh ${outcome} after leaving and revisiting a node`, async ({ page }) => {
    await mountHarness(page);
    await resolveMetrics(page, 0, "worker-1", "250m");
    await page.evaluate(() => window.__nodeMetricsProbe.state.refresh());
    await selectNode(page, "prod", "worker-2");
    await selectNode(page, "dev", "worker-1");
    await resolveMetrics(page, 3, "worker-1", "400m");

    if (outcome === "success") {
      await resolveMetrics(page, 1, "worker-1", "9999m");
    } else {
      await page.evaluate(() => window.__nodeMetricsProbe.requests[1].reject(new Error("old cluster unavailable")));
      await settle(page);
    }
    expect(await page.evaluate(() => window.__nodeMetricsProbe.state.cpu)).toBe("400m");
    expect(await page.evaluate(() => window.__nodeMetricsProbe.state.error)).toBe("");
    expect(await page.evaluate(() => window.__nodeMetricsProbe.state.samples.map((sample) => sample.cpuMillicores))).toEqual([400]);
  });
}

test("node metrics clears a polling error when the next poll succeeds", async ({ page }) => {
  await mountHarness(page);
  await page.evaluate(() => window.__nodeMetricsProbe.requests[0].reject(new Error("metrics unavailable")));
  await settle(page);
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.error)).toBe("metrics unavailable");
  await page.clock.fastForward(15_000);
  await expect.poll(() => page.evaluate(() => window.__nodeMetricsProbe.requests.length)).toBe(2);
  await resolveMetrics(page, 1, "worker-1", "500m");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.error)).toBe("");
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state.loading)).toBe(false);
});

test("node metrics stays idle after the detail identity is cleared", async ({ page }) => {
  await mountHarness(page);
  await resolveMetrics(page, 0, "worker-1", "250m");
  await selectNode(page, "", "");
  await page.evaluate(() => window.__nodeMetricsProbe.state.refresh());
  await page.clock.fastForward(30_000);
  await settle(page);
  expect(await page.evaluate(() => window.__nodeMetricsProbe.requests.length)).toBe(1);
  expect(await page.evaluate(() => window.__nodeMetricsProbe.state)).toMatchObject({ samples: [], loading: false, error: "" });
});
