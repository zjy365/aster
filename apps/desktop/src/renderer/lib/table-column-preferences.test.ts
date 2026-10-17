// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMN_IDS } from "./table-columns";
import {
  columnOrderFor,
  effectiveColumnOrder,
  normalizeColumnOrder,
  parseTableColumnPrefs,
  withColumnOrder,
  withoutColumnOrder,
} from "./table-column-preferences";

describe("parseTableColumnPrefs", () => {
  it("accepts a well-formed payload", () => {
    expect(parseTableColumnPrefs({ deployments: ["name", "images"], pods: ["name"] })).toEqual({
      deployments: ["name", "images"],
      pods: ["name"],
    });
  });

  it("degrades corrupt or foreign payloads to empty preferences", () => {
    expect(parseTableColumnPrefs(null)).toEqual({});
    expect(parseTableColumnPrefs("deployments")).toEqual({});
    expect(parseTableColumnPrefs(["name"])).toEqual({});
    expect(parseTableColumnPrefs(() => undefined)).toEqual({});
  });

  it("drops invalid entries instead of failing the whole store", () => {
    expect(parseTableColumnPrefs({ ok: ["name"], notAList: "name", mixed: ["name", 3, null], empty: [] })).toEqual({
      ok: ["name"],
      mixed: ["name"],
    });
  });

  it("ignores a literal __proto__ key", () => {
    // JSON.parse produces an own "__proto__" property; it must not leak into
    // the preferences object's prototype.
    const prefs = parseTableColumnPrefs(JSON.parse('{"__proto__":["name"]}'));
    expect(prefs).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(prefs, "__proto__")).toBe(false);
  });
});

describe("normalizeColumnOrder", () => {
  it("deduplicates while keeping first-seen order", () => {
    expect(normalizeColumnOrder(["name", "status", "name", "age"])).toEqual(["name", "status", "age"]);
  });
});

describe("columnOrderFor / effectiveColumnOrder", () => {
  it("returns the stored order for a customized kind", () => {
    const prefs = { deployments: ["name", "images"] };
    expect(columnOrderFor(prefs, "deployments")).toEqual(["name", "images"]);
  });

  it("falls back to the default set for an unknown or reset kind", () => {
    expect(columnOrderFor({ deployments: ["name"] }, "pods")).toBeUndefined();
    expect(effectiveColumnOrder({}, "pods")).toEqual([...DEFAULT_COLUMN_IDS]);
    expect(effectiveColumnOrder({ pods: ["name", "status"] }, "deployments")).toEqual([...DEFAULT_COLUMN_IDS]);
  });
});

describe("withColumnOrder / withoutColumnOrder", () => {
  it("saves an order per kind without mutating the input", () => {
    const prefs = { pods: ["name"] };
    expect(withColumnOrder(prefs, "deployments", ["name", "images", "status"])).toEqual({
      pods: ["name"],
      deployments: ["name", "images", "status"],
    });
    expect(prefs).toEqual({ pods: ["name"] });
  });

  it("overwrites the same kind in place and deduplicates", () => {
    expect(withColumnOrder({ deployments: ["name"] }, "deployments", ["status", "status", "name"])).toEqual({
      deployments: ["status", "name"],
    });
  });

  it("treats an empty order as reset (the entry is removed)", () => {
    expect(withColumnOrder({ deployments: ["name"], pods: ["name"] }, "deployments", [])).toEqual({ pods: ["name"] });
  });

  it("reset drops only the targeted kind and is a no-op for unknown kinds", () => {
    expect(withoutColumnOrder({ deployments: ["name"], pods: ["name"] }, "deployments")).toEqual({ pods: ["name"] });
    const prefs = { pods: ["name"] };
    expect(withoutColumnOrder(prefs, "deployments")).toBe(prefs);
  });
});
