// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  NAMESPACE_ROW_WINDOW,
  NAMESPACE_SHOW_ROW_LIMIT,
  searchNamespaces,
} from "./namespace-search";

/** A 200k-namespace cluster with the "ns-xxxxxx" pattern the user described. */
function bigCluster(): string[] {
  const names = new Array<string>(200_000);
  for (let index = 0; index < 200_000; index++) {
    names[index] = `ns-${String(index).padStart(6, "0")}`;
  }
  return names;
}

describe("searchNamespaces", () => {
  it("short prefix on a huge cluster is narrowed: count hint, no concrete rows", () => {
    const names = bigCluster();
    const match = searchNamespaces(names, "ns-");
    expect(match.total).toBe(200_000);
    expect(match.narrowed).toBe(true);
    // The shown window is bounded (constant), not 200k.
    expect(match.shown.length).toBeLessThanOrEqual(NAMESPACE_ROW_WINDOW);
    // Every shown name still starts with the prefix.
    for (const name of match.shown) expect(name.startsWith("ns-")).toBe(true);
  });

  it("narrowing the prefix shrinks the interval progressively", () => {
    const names = bigCluster();
    expect(searchNamespaces(names, "ns-").total).toBe(200_000);
    expect(searchNamespaces(names, "ns-12").total).toBe(10_000);
    expect(searchNamespaces(names, "ns-123").total).toBe(1_000);
    expect(searchNamespaces(names, "ns-1234").total).toBe(100);
    expect(searchNamespaces(names, "ns-12345").total).toBe(10);
  });

  it("exact name matches exactly one and shows it", () => {
    const match = searchNamespaces(bigCluster(), "ns-123456");
    expect(match.total).toBe(1);
    expect(match.narrowed).toBe(false);
    expect(match.shown).toEqual(["ns-123456"]);
  });

  it("small match sets render rows without the narrowed hint", () => {
    const names = ["default", "kube-system", "ns-1", "ns-2"];
    const match = searchNamespaces(names, "ns-");
    expect(match.total).toBe(2);
    expect(match.narrowed).toBe(false);
    expect(match.shown).toEqual(["ns-1", "ns-2"]);
  });

  it("orders the shown window shortest-first, then lexical", () => {
    // Prefix interval is [ns-12345, ns-12345...) which lexically is
    // ns-123450, ns-1234500, ... — but the shortest names are the most useful.
    const names = bigCluster();
    const match = searchNamespaces(names, "ns-12345");
    expect(match.shown).toEqual([
      "ns-123450", "ns-123451", "ns-123452", "ns-123453", "ns-123454",
      "ns-123455", "ns-123456", "ns-123457", "ns-123458", "ns-123459",
    ]);
  });

  it("empty query lists the start of the array with a narrowed hint if huge", () => {
    const small = ["default", "kube-system"];
    expect(searchNamespaces(small, "").shown).toEqual(["default", "kube-system"]);
    const huge = searchNamespaces(bigCluster(), "");
    expect(huge.total).toBe(200_000);
    expect(huge.narrowed).toBe(true);
    expect(huge.shown.length).toBeLessThanOrEqual(NAMESPACE_ROW_WINDOW);
  });

  it("handles case-insensitive queries and no matches", () => {
    const names = ["Default", "NS-123456"];
    expect(searchNamespaces(names, "ns-123456").total).toBe(1);
    expect(searchNamespaces(names, "zzz").total).toBe(0);
    expect(searchNamespaces(names, "zzz").narrowed).toBe(false);
    expect(searchNamespaces(names, "zzz").shown).toEqual([]);
  });

  it("hits the boundary between rows and hint", () => {
    const names = Array.from({ length: NAMESPACE_SHOW_ROW_LIMIT + 10 }, (_, index) => `n${String(index).padStart(3, "0")}`);
    const atLimit = searchNamespaces(names, "n");
    expect(atLimit.total).toBe(NAMESPACE_SHOW_ROW_LIMIT + 10);
    expect(atLimit.narrowed).toBe(true);
  });
});
