import { describe, expect, it } from "vitest";
import type { NamespaceScope, ResourceListResponse, ResourceRow } from "../../shared/types";
import {
  aggregateNamespaces,
  aggregateRowUid,
  appendClusterPage,
  clusterPageKey,
  clusterSelectionKey,
  decorateClusterRow,
  isAggregateSelection,
  MAX_CLUSTER_SELECTION,
  mergeClusterPages,
  retainClusterSelection,
  splitClusterPageKey,
  toggleCluster,
  unionNamespaceLists,
} from "./multi-cluster";

function row(uid: string, name = uid, namespace = "default"): ResourceRow {
  return {
    uid,
    apiVersion: "apps/v1",
    kind: "Deployment",
    name,
    namespace,
    resourceVersion: "1000",
    createdAt: "2026-08-01T00:00:00Z",
    status: "Running",
  };
}

function page(items: ResourceRow[], continueToken?: string): ResourceListResponse {
  return { items, ...(continueToken ? { continueToken } : {}) };
}

describe("cluster selection", () => {
  it("toggles membership in click order and always allows removal", () => {
    expect(toggleCluster([], "dev").selection).toEqual(["dev"]);
    expect(toggleCluster(["dev"], "prod").selection).toEqual(["dev", "prod"]);
    expect(toggleCluster(["dev", "prod"], "dev").selection).toEqual(["prod"]);
  });

  it("caps the selection at the fan-out bound and reports the rejection", () => {
    const full = Array.from({ length: MAX_CLUSTER_SELECTION }, (_, index) => `ctx-${index}`);
    const rejected = toggleCluster(full, "overflow");
    expect(rejected).toEqual({ selection: full, accepted: false });
    expect(toggleCluster(full, full[0]).accepted).toBe(true);
  });

  it("keeps a selection only while the refreshed kubeconfig still contains it", () => {
    expect(retainClusterSelection(["dev", "prod"], ["dev", "gone", "prod"])).toEqual(["dev", "prod"]);
    expect(retainClusterSelection(["dev"], ["prod"])).toEqual([]);
  });

  it("keys the selection order-insensitively", () => {
    expect(clusterSelectionKey(["dev", "prod"])).toBe(clusterSelectionKey(["prod", "dev"]));
    expect(clusterSelectionKey(["dev"])).not.toBe(clusterSelectionKey(["dev", "prod"]));
  });

  it("treats exactly one context as the ordinary single-cluster view", () => {
    expect(isAggregateSelection([])).toBe(false);
    expect(isAggregateSelection(["dev"])).toBe(false);
    expect(isAggregateSelection(["dev", "prod"])).toBe(true);
  });
});

describe("aggregate row identity", () => {
  it("prefixes the uid with the source context so equal objects cannot collide", () => {
    const left = decorateClusterRow(row("same-uid", "web"), "dev");
    const right = decorateClusterRow(row("same-uid", "web"), "prod");
    expect(left.uid).toBe(aggregateRowUid("dev", row("same-uid", "web")));
    expect(left.uid).not.toBe(right.uid);
    expect(left.sourceContextId).toBe("dev");
    expect(right.sourceContextId).toBe("prod");
    // The payload survives untouched apart from the decoration.
    expect(left.name).toBe("web");
    expect(left.resourceVersion).toBe("1000");
  });

  it("falls back to namespace/name when the row carries no uid", () => {
    const bare = { ...row("", "web", "apps"), uid: "" };
    expect(aggregateRowUid("dev", bare)).toBe(`dev\u001fapps/web`);
  });
});

describe("page keys", () => {
  it("round-trips a (cluster, namespace) cell, including the cluster-wide cell", () => {
    expect(splitClusterPageKey(clusterPageKey("dev", "kube-system"))).toEqual({ contextId: "dev", namespace: "kube-system" });
    expect(splitClusterPageKey(clusterPageKey("prod", ""))).toEqual({ contextId: "prod", namespace: "" });
  });
});

describe("aggregateNamespaces", () => {
  const namespaced = { namespaced: true };
  const clusterScoped = { namespaced: false };

  it("uses the selected scope for namespaced kinds", () => {
    expect(aggregateNamespaces(namespaced, ["default"] as NamespaceScope)).toEqual(["default"]);
    expect(aggregateNamespaces(namespaced, ["a", "b"] as NamespaceScope)).toEqual(["a", "b"]);
  });

  it("collapses All-namespaces and cluster-scoped kinds to one cluster-wide cell", () => {
    expect(aggregateNamespaces(namespaced, [] as NamespaceScope)).toEqual([""]);
    expect(aggregateNamespaces(clusterScoped, ["default", "kube-system"] as NamespaceScope)).toEqual([""]);
  });
});

describe("mergeClusterPages", () => {
  it("concatenates in selection order — one cluster's rows, then the next", () => {
    const pages = {
      [clusterPageKey("dev", "")]: page([row("a"), row("b")]),
      [clusterPageKey("prod", "")]: page([row("c")]),
    };
    const merged = mergeClusterPages(["dev", "prod"], [""], pages);
    expect(merged.items.map((item) => item.uid)).toEqual(["a", "b", "c"]);
    expect(merged.hasMore).toBe(false);
  });

  it("carries the namespace dimension inside each cluster", () => {
    const pages = {
      [clusterPageKey("dev", "apps")]: page([row("a")]),
      [clusterPageKey("dev", "infra")]: page([row("b")]),
      [clusterPageKey("prod", "apps")]: page([row("c")]),
    };
    const merged = mergeClusterPages(["dev", "prod"], ["apps", "infra"], pages);
    expect(merged.items.map((item) => item.uid)).toEqual(["a", "b", "c"]);
  });

  it("skips cells without a page instead of stalling the merge", () => {
    const pages = {
      [clusterPageKey("dev", "")]: page([row("a")]),
      // prod failed or is still loading: no page at all.
    };
    expect(mergeClusterPages(["dev", "prod"], [""], pages).items.map((item) => item.uid)).toEqual(["a"]);
  });

  it("de-dups a row delivered twice under its decorated uid", () => {
    const once = decorateClusterRow(row("a"), "dev");
    const again = decorateClusterRow(row("a"), "dev");
    const merged = mergeClusterPages(["dev"], [""], { [clusterPageKey("dev", "")]: page([once, again, once]) });
    expect(merged.items).toHaveLength(1);
  });

  it("keeps same-name objects from different clusters as distinct rows", () => {
    const devWeb = decorateClusterRow(row("uid-1", "web"), "dev");
    const prodWeb = decorateClusterRow(row("uid-2", "web"), "prod");
    const merged = mergeClusterPages(["dev", "prod"], [""], {
      [clusterPageKey("dev", "")]: page([devWeb]),
      [clusterPageKey("prod", "")]: page([prodWeb]),
    });
    expect(merged.items).toHaveLength(2);
  });

  it("flags hasMore when any cell still has a server page", () => {
    const pages = {
      [clusterPageKey("dev", "")]: page([row("a")], "next-dev"),
      [clusterPageKey("prod", "")]: page([row("c")]),
    };
    expect(mergeClusterPages(["dev", "prod"], [""], pages).hasMore).toBe(true);
  });
});

describe("appendClusterPage", () => {
  it("appends one cell's next page and keeps the token that came with it", () => {
    const start = { [clusterPageKey("dev", "")]: page([row("a")], "2") };
    const next = appendClusterPage(start, "dev", "", page([row("b")], "3"));
    expect(next[clusterPageKey("dev", "")].items.map((item) => item.uid)).toEqual(["a", "b"]);
    expect(next[clusterPageKey("dev", "")].continueToken).toBe("3");
  });
});

describe("unionNamespaceLists", () => {
  it("dedupes and sorts the union across clusters", () => {
    expect(unionNamespaceLists([["kube-system", "default"], ["default", "zzz"]])).toEqual(["default", "kube-system", "zzz"]);
    expect(unionNamespaceLists([])).toEqual([]);
  });
});
