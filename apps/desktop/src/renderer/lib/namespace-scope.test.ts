// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ResourceListResponse, ResourceRow } from "../../shared/types";
import {
  MAX_NAMESPACE_SELECTION,
  MULTI_SCOPE_CONTINUE,
  appendNamespacePage,
  mergeNamespacePages,
  namespaceScopeKey,
  namespaceScopeSummary,
  toggleNamespace,
} from "./namespace-scope";

describe("toggleNamespace", () => {
  it("appends a new namespace in click order", () => {
    expect(toggleNamespace([], "a").scope).toEqual(["a"]);
    expect(toggleNamespace(["a"], "b").scope).toEqual(["a", "b"]);
    expect(toggleNamespace(["a"], "b").accepted).toBe(true);
  });

  it("removes a selected namespace and keeps the remaining order", () => {
    const result = toggleNamespace(["a", "b", "c"], "b");
    expect(result.scope).toEqual(["a", "c"]);
    expect(result.accepted).toBe(true);
  });

  it("removing still works at the cap", () => {
    const full = Array.from({ length: MAX_NAMESPACE_SELECTION }, (_, i) => `ns-${i}`);
    const result = toggleNamespace(full, "ns-5");
    expect(result.accepted).toBe(true);
    expect(result.scope).toHaveLength(MAX_NAMESPACE_SELECTION - 1);
  });

  it("rejects the 33rd namespace without mutating the selection", () => {
    const full = Array.from({ length: MAX_NAMESPACE_SELECTION }, (_, i) => `ns-${i}`);
    const result = toggleNamespace(full, "one-too-many");
    expect(result.accepted).toBe(false);
    expect(result.scope).toBe(full);
  });
});

describe("namespaceScopeKey", () => {
  it("is order-insensitive", () => {
    expect(namespaceScopeKey(["b", "a"])).toBe(namespaceScopeKey(["a", "b"]));
  });

  it("encodes the empty scope as the All-namespaces key", () => {
    expect(namespaceScopeKey([])).toBe("");
  });

  it("distinguishes scopes that are not permutations of each other", () => {
    expect(namespaceScopeKey(["a"])).not.toBe(namespaceScopeKey(["a", "b"]));
    expect(namespaceScopeKey(["a"])).toBe(namespaceScopeKey(["a"]));
  });
});

describe("namespaceScopeSummary", () => {
  it("empty scope summarizes to nothing (the trigger says All namespaces)", () => {
    expect(namespaceScopeSummary([])).toBe("");
  });

  it("one name renders alone so single-selection reads exactly as before", () => {
    expect(namespaceScopeSummary(["kube-system"])).toBe("kube-system");
  });

  it("two names join with a comma in selection order", () => {
    expect(namespaceScopeSummary(["a", "b"])).toBe("a, b");
  });

  it("longer selections overflow into +N from three on", () => {
    expect(namespaceScopeSummary(["a", "b", "c"])).toBe("a, b +1");
    expect(namespaceScopeSummary(["a", "b", "c", "d"])).toBe("a, b +2");
    expect(namespaceScopeSummary(["a", "b", "c", "d", "e", "f"])).toBe("a, b +4");
  });
});

function page(items: string[], continueToken?: string): ResourceListResponse {
  return {
    items: items.map((name) => ({
      uid: `uid-${name}`,
      apiVersion: "v1",
      kind: "Pod",
      name,
      namespace: "ns",
      resourceVersion: "1",
      createdAt: "2026-08-01T00:00:00Z",
    })),
    ...(continueToken ? { continueToken } : {}),
  };
}

const rowsOf = (response: ResourceListResponse) => response.items.map((row: ResourceRow) => row.name);

describe("mergeNamespacePages", () => {
  it("concatenates pages in selection order, not fetch order", () => {
    const merged = mergeNamespacePages(["a", "b"], { b: page(["b-0"]), a: page(["a-0", "a-1"]) });
    expect(rowsOf({ items: merged.items } as ResourceListResponse)).toEqual(["a-0", "a-1", "b-0"]);
  });

  it("a missing page contributes nothing instead of stalling the merge", () => {
    const merged = mergeNamespacePages(["a", "b", "c"], { a: page(["a-0"]), c: page(["c-0"]) });
    expect(rowsOf({ items: merged.items } as ResourceListResponse)).toEqual(["a-0", "c-0"]);
  });

  it("hasMore is true when any selected namespace still has a page", () => {
    expect(mergeNamespacePages(["a", "b"], { a: page(["a-0"], "tok-a"), b: page(["b-0"]) }).hasMore).toBe(true);
    expect(mergeNamespacePages(["a", "b"], { a: page(["a-0"]), b: page(["b-0"]) }).hasMore).toBe(false);
    expect(mergeNamespacePages(["a", "b"], {}).hasMore).toBe(false);
  });

  it("empty scope merges to nothing", () => {
    expect(mergeNamespacePages([], { a: page(["a-0"]) })).toEqual({ items: [], hasMore: false });
  });
});

describe("appendNamespacePage", () => {
  it("appends the next page after the loaded ones and adopts the new token", () => {
    const pages = { a: page(["a-0"], "tok") };
    const next = appendNamespacePage(pages, "a", page(["a-1"], "tok-2"));
    expect(rowsOf(next.a)).toEqual(["a-0", "a-1"]);
    expect(next.a.continueToken).toBe("tok-2");
    // Pure: the input record is untouched.
    expect(rowsOf(pages.a)).toEqual(["a-0"]);
  });

  it("a failed namespace keeps its old token so load-more retries it", () => {
    const pages = { a: page(["a-0"], "tok-a"), b: page(["b-0"], "tok-b") };
    const next = appendNamespacePage(pages, "a", page(["a-1"]));
    expect(next.a.continueToken).toBeUndefined();
    expect(next.b.continueToken).toBe("tok-b");
  });

  it("the multi-scope sentinel is a truthy marker, never sent to the core", () => {
    expect(MULTI_SCOPE_CONTINUE).toBeTruthy();
  });
});
