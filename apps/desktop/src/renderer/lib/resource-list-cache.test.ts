import { beforeEach, describe, expect, it } from "vitest";
import type { ResourceListResponse } from "../../shared/types";
import {
  clearResourceListSnapshots,
  readResourceListSnapshot,
  resourceListCacheKey,
  writeResourceListSnapshot,
} from "./resource-list-cache";

function snapshot(name: string): ResourceListResponse {
  return {
    items: [{
      uid: name,
      apiVersion: "v1",
      kind: "Pod",
      name,
      namespace: "default",
      resourceVersion: "1",
      createdAt: "2026-08-01T00:00:00Z",
    }],
    resourceVersion: "1",
  };
}

function emptySnapshot(): ResourceListResponse {
  return { items: [], resourceVersion: "7" };
}

beforeEach(() => clearResourceListSnapshots());

describe("resourceListCacheKey", () => {
  it("isolates views by context, kind, namespace, and selector", () => {
    const base = resourceListCacheKey("dev", "pods", "default");
    expect(base).not.toBe(resourceListCacheKey("prod", "pods", "default"));
    expect(base).not.toBe(resourceListCacheKey("dev", "deployments", "default"));
    expect(base).not.toBe(resourceListCacheKey("dev", "pods", "kube-system"));
    expect(base).not.toBe(resourceListCacheKey("dev", "pods", "default", "app=web"));
    expect(base).toBe(resourceListCacheKey("dev", "pods", "default", undefined));
  });
});

describe("snapshot LRU", () => {
  it("reads back the written snapshot and misses unknown keys", () => {
    const key = resourceListCacheKey("dev", "pods", "default");
    expect(readResourceListSnapshot(key)).toBeUndefined();
    writeResourceListSnapshot(key, snapshot("a"));
    expect(readResourceListSnapshot(key)?.items[0]?.name).toBe("a");
  });

  it("reads back an empty snapshot as a valid loaded view", () => {
    writeResourceListSnapshot("empty", emptySnapshot());
    expect(readResourceListSnapshot("empty")).toEqual(emptySnapshot());
  });

  it("evicts the least recently revisited view beyond eight entries", () => {
    const keys = Array.from({ length: 9 }, (_, index) => `k${index}`);
    keys.forEach((key) => writeResourceListSnapshot(key, snapshot(key)));
    expect(readResourceListSnapshot("k0")).toBeUndefined();
    expect(readResourceListSnapshot("k8")).toBeDefined();
  });

  it("a read touches the entry so it survives eviction", () => {
    const keys = Array.from({ length: 8 }, (_, index) => `k${index}`);
    keys.forEach((key) => writeResourceListSnapshot(key, snapshot(key)));
    // Revisit the oldest entry, then push a ninth: k1 evicts, not k0.
    expect(readResourceListSnapshot("k0")).toBeDefined();
    writeResourceListSnapshot("k8", snapshot("k8"));
    expect(readResourceListSnapshot("k0")).toBeDefined();
    expect(readResourceListSnapshot("k1")).toBeUndefined();
  });

  it("clear drops every retained snapshot", () => {
    writeResourceListSnapshot("k0", snapshot("a"));
    clearResourceListSnapshots();
    expect(readResourceListSnapshot("k0")).toBeUndefined();
  });
});
