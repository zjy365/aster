// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNamespaceCache,
  NAMESPACE_CACHE_MAX_ENTRIES,
  NAMESPACE_CACHE_TTL_MS,
  readNamespaceCache,
  writeNamespaceCache,
} from "./namespace-cache";

beforeEach(() => {
  clearNamespaceCache();
  vi.useRealTimers();
});

describe("namespace cache", () => {
  it("reads back the written names and truncation flag", () => {
    writeNamespaceCache("dev", ["default", "kube-system"], false);
    const entry = readNamespaceCache("dev");
    expect(entry?.names).toEqual(["default", "kube-system"]);
    expect(entry?.truncated).toBe(false);
  });

  it("isolates clusters from each other", () => {
    writeNamespaceCache("dev", ["default", "kube-system"], false);
    expect(readNamespaceCache("prod")).toBeUndefined();
  });

  it("evicts the least recently revisited cluster beyond the cap", () => {
    for (let i = 0; i < NAMESPACE_CACHE_MAX_ENTRIES; i++) {
      writeNamespaceCache("ctx-" + i, [`ns-${i}`], false);
    }
    // Revisit the oldest, then push one more: ctx-0 survives, ctx-1 goes.
    readNamespaceCache("ctx-0");
    writeNamespaceCache("ctx-" + NAMESPACE_CACHE_MAX_ENTRIES, ["ns-new"], false);
    expect(readNamespaceCache("ctx-0")).toBeDefined();
    expect(readNamespaceCache("ctx-1")).toBeUndefined();
  });

  it("still returns a stale entry; a re-fetch after it resets the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    writeNamespaceCache("dev", ["default"], false);

    vi.setSystemTime(1_000 + NAMESPACE_CACHE_TTL_MS + 1);
    const entry = readNamespaceCache("dev");
    expect(entry?.names).toEqual(["default"]);
    expect(entry?.fetchedAt).toBe(1_000);

    // A re-fetch after the read replaces the entry and resets its clock.
    writeNamespaceCache("dev", ["default", "kube-system"], false);
    expect(readNamespaceCache("dev")?.fetchedAt).toBe(1_000 + NAMESPACE_CACHE_TTL_MS + 1);
  });

  it("clear drops every retained cluster list", () => {
    writeNamespaceCache("dev", ["default"], false);
    clearNamespaceCache();
    expect(readNamespaceCache("dev")).toBeUndefined();
  });
});
