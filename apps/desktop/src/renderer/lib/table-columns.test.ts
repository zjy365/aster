// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ResourceRow } from "../../shared/types";
import {
  DEFAULT_COLUMN_IDS,
  DISCOVERY_COLUMN_CAP,
  availableColumns,
  discoverColumnIds,
  resolveColumns,
} from "./table-columns";

function row(overrides: Record<string, unknown> = {}): ResourceRow {
  // Rows are loosely typed on purpose: discovery must handle spec/status
  // objects the ResourceRow summary type does not model.
  return {
    uid: "uid",
    apiVersion: "v1",
    kind: "Widget",
    name: "widget-0",
    namespace: "default",
    resourceVersion: "1000",
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as ResourceRow;
}

/** The row bookkeeping fields real callers always mark as known. */
const META = new Set(["uid", "apiVersion", "kind", "name", "namespace", "resourceVersion", "createdAt", "status", "labels", "images", "deleting"]);

describe("discoverColumnIds", () => {
  it("finds top-level and spec/status scalar fields, deduped across rows", () => {
    const rows = [
      row({ spec: { replicas: 2, paused: false }, status: { phase: "Running" } }),
      row({ spec: { replicas: 5, paused: true }, status: { phase: "Pending" } }),
    ];
    const meta = new Set([...META]);
    expect(discoverColumnIds(rows, meta)).toEqual(["spec.paused", "spec.replicas", "status.phase"]);
  });

  it("skips known ids, non-scalars, and empty strings", () => {
    const rows = [row({
      labels: { app: "web" },
      images: ["nginx"],
      status: "Running",
      reason: "",
      message: { nested: true },
      count: 3,
      deleting: false,
    })];
    const known = new Set(["uid", "apiVersion", "kind", "name", "namespace", "resourceVersion", "createdAt", "labels", "images", "status", "reason", "message", "deleting"]);
    expect(discoverColumnIds(rows, known)).toEqual(["count"]);
  });

  it("caps suggestions and ranks by how many rows carry the field", () => {
    const rows = Array.from({ length: 20 }, (_, index) => row({
      spec: { common: "x", rare: index === 0 ? "y" : undefined, zebra: index % 2 ? "z" : undefined },
    }));
    const ids = discoverColumnIds(rows, META, 3);
    expect(ids).toEqual(["spec.common", "spec.zebra", "spec.rare"]);
    expect(ids.length).toBeLessThanOrEqual(DISCOVERY_COLUMN_CAP);
  });

  it("breaks frequency ties alphabetically so the suggestion list is stable", () => {
    const rows = [row({ spec: { beta: 1, alpha: 2 } })];
    expect(discoverColumnIds(rows, META)).toEqual(["spec.alpha", "spec.beta"]);
  });

  it("rejects long prose strings but keeps short ones", () => {
    const rows = [row({ spec: { note: "x".repeat(300), code: "A-1" } })];
    expect(discoverColumnIds(rows, META)).toEqual(["spec.code"]);
  });
});

describe("availableColumns", () => {
  it("always leads with the default set", () => {
    const columns = availableColumns("widgets", [row()]);
    expect(columns.slice(0, DEFAULT_COLUMN_IDS.length).map((column) => column.id)).toEqual([...DEFAULT_COLUMN_IDS]);
  });

  it("offers a kind's curated fields only when loaded rows carry data", () => {
    const withImages = availableColumns("deployments", [row({ images: ["nginx:1.27"] })]);
    expect(withImages.map((column) => column.id)).toContain("images");
    // The kind is curated for services, but these rows have no addresses.
    const bare = availableColumns("services", [row({ images: ["nginx:1.27"] })]);
    expect(bare.map((column) => column.id)).not.toContain("addresses");
    // images is not curated for services either — only generic columns apply.
    expect(bare.map((column) => column.id)).not.toContain("images");
  });

  it("derives custom-resource columns from spec/status of the loaded rows", () => {
    const columns = availableColumns("widgets.example.com", [row({ spec: { tier: "gold" }, status: { ready: 3 } })]);
    const ids = columns.map((column) => column.id);
    expect(ids).toContain("spec.tier");
    expect(ids).toContain("status.ready");
    expect(columns.find((column) => column.id === "spec.tier")?.source).toBe("discovered");
  });
});

describe("resolveColumns", () => {
  const rows = [row({ images: ["nginx:1.27"], labels: { app: "web" } })];

  it("falls back to the default set for an unknown or never-customized kind", () => {
    const resolved = resolveColumns("deployments", rows, undefined);
    expect(resolved.visible.map((column) => column.id)).toEqual([...DEFAULT_COLUMN_IDS]);
    expect(resolved.customized).toBe(false);
    expect(resolved.hidden.map((column) => column.id)).toContain("images");
  });

  it("applies the stored order and visibility", () => {
    const resolved = resolveColumns("deployments", rows, ["name", "images", "status"]);
    expect(resolved.visible.map((column) => column.id)).toEqual(["name", "images", "status"]);
    expect(resolved.customized).toBe(true);
    expect(resolved.hidden.map((column) => column.id)).not.toContain("images");
  });

  it("drops stored ids the current rows cannot fill, silently", () => {
    const resolved = resolveColumns("deployments", rows, ["name", "addresses", "spec.tier"]);
    expect(resolved.visible.map((column) => column.id)).toEqual(["name"]);
    expect(resolved.customized).toBe(true);
  });

  it("never renders an empty table: an all-unknown order falls back to defaults", () => {
    const resolved = resolveColumns("deployments", rows, ["addresses", "spec.tier"]);
    expect(resolved.visible.map((column) => column.id)).toEqual([...DEFAULT_COLUMN_IDS]);
    expect(resolved.customized).toBe(false);
  });

  it("treats an empty stored order as no preference", () => {
    const resolved = resolveColumns("deployments", rows, []);
    expect(resolved.customized).toBe(false);
    expect(resolved.visible.map((column) => column.id)).toEqual([...DEFAULT_COLUMN_IDS]);
  });
});

describe("column values", () => {
  it("renders list-ish fields joined and capped", () => {
    const columns = availableColumns("deployments", [row({ images: ["a", "b", "c", "d", "e"] })]);
    const images = columns.find((column) => column.id === "images");
    expect(images?.value(row({ images: ["a", "b", "c", "d", "e"] }))).toBe("a, b, c +2 more");
  });

  it("renders labels as sorted key=value pairs", () => {
    const columns = availableColumns("pods", [row({ labels: { app: "web", tier: "backend" } })]);
    expect(columns.find((column) => column.id === "labels")?.value(row({ labels: { tier: "backend", app: "web" } })))
      .toBe("app=web tier=backend");
  });

  it("renders empty for missing values instead of erroring", () => {
    const columns = availableColumns("widgets.example.com", [row({ spec: { tier: "gold" } })]);
    const tier = columns.find((column) => column.id === "spec.tier");
    expect(tier?.value(row({ spec: {} }))).toBe("");
    expect(tier?.value(row({}))).toBe("");
    // A non-object where an object is expected must not throw either.
    expect(tier?.value(row({ spec: "broken" }))).toBe("");
  });

  it("keeps the builtin cells' semantics (namespace fallback, unknown status)", () => {
    const columns = availableColumns("pods", [row()]);
    const byId = new Map(columns.map((column) => [column.id, column]));
    expect(byId.get("namespace")?.value(row({ namespace: "" }))).toBe("Cluster-scoped");
    expect(byId.get("status")?.value(row({ status: undefined }))).toBe("Unknown");
    expect(byId.get("ready")?.value(row({}))).toBe("-");
    expect(byId.get("name")?.value(row({ name: "pod-7" }))).toBe("pod-7");
  });
});
