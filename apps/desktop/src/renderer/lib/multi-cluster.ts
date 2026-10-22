// SPDX-License-Identifier: Apache-2.0

import type { NamespaceScope, ResourceListResponse, ResourceRow } from "../../shared/types";

/**
 * The cluster dimension of a list view: an ordered selection of kubeconfig
 * context ids, mirroring namespace-scope.ts one dimension up. One id is the
 * ordinary single-cluster workbench (nothing here applies); two or more is
 * the aggregate view, where the renderer fans out one ordinary single-context
 * list request per selected cluster and merges the pages client-side. The
 * wire format never changes — there is no batch or proxy call.
 */

/**
 * Bounds the per-cluster fan-out: worst case MAX_CLUSTER_SELECTION list
 * requests per namespace per refresh (times MAX_NAMESPACE_SELECTION), which
 * keeps a careless select-all from opening dozens of concurrent API clients.
 */
export const MAX_CLUSTER_SELECTION = 8;

/** Separator for page keys and prefixed row uids; forbidden in both operands. */
export const CLUSTER_PAGE_SEPARATOR = "\u001f";

export interface ClusterToggle {
  selection: string[];
  /** False when adding would exceed MAX_CLUSTER_SELECTION; selection is unchanged. */
  accepted: boolean;
}

/** Toggles one context in the aggregate selection; removing is always allowed. */
export function toggleCluster(selection: string[], contextId: string): ClusterToggle {
  if (selection.includes(contextId)) {
    return { selection: selection.filter((item) => item !== contextId), accepted: true };
  }
  if (selection.length >= MAX_CLUSTER_SELECTION) {
    return { selection, accepted: false };
  }
  return { selection: [...selection, contextId], accepted: true };
}

/** Drops ids the refreshed kubeconfig no longer contains (context removal). */
export function retainClusterSelection(contextIds: string[], selection: string[]): string[] {
  const known = new Set(contextIds);
  return selection.filter((id) => known.has(id));
}

/**
 * Order-insensitive identity of a cluster selection: sorted ids joined with
 * \u001f. [a, b] and [b, a] are the same aggregate view, so effects and resets
 * keyed on this must not tear down and refetch on a mere reordering.
 */
export function clusterSelectionKey(contextIds: string[]): string {
  return [...contextIds].sort().join(CLUSTER_PAGE_SEPARATOR);
}

/** True while the workbench shows one aggregate view across 2+ clusters. */
export function isAggregateSelection(contextIds: readonly string[]): boolean {
  return contextIds.length > 1;
}

/** Identity of one row inside an aggregate view: the source context prefixes the uid. */
export function aggregateRowUid(contextId: string, row: Pick<ResourceRow, "uid" | "namespace" | "name">): string {
  return `${contextId}${CLUSTER_PAGE_SEPARATOR}${row.uid || `${row.namespace}/${row.name}`}`;
}

/**
 * Decorates one row with its source cluster: the uid is prefixed (so the same
 * object listed from two clusters cannot collide in React keys, checkbox sets
 * or selection matching) and sourceContextId routes detail, diagnostics and
 * mutation requests back to the cluster the row came from.
 */
export function decorateClusterRow<T extends ResourceRow>(row: T, contextId: string): T {
  return { ...row, uid: aggregateRowUid(contextId, row), sourceContextId: contextId };
}

/** Page key of one (cluster, namespace) fan-out cell; "" namespace is cluster-wide. */
export function clusterPageKey(contextId: string, namespace: string): string {
  return `${contextId}${CLUSTER_PAGE_SEPARATOR}${namespace}`;
}

/** Splits a page key back into its cluster and namespace ("" when cluster-wide). */
export function splitClusterPageKey(key: string): { contextId: string; namespace: string } {
  const separator = key.indexOf(CLUSTER_PAGE_SEPARATOR);
  return { contextId: key.slice(0, separator), namespace: key.slice(separator + 1) };
}

export interface MergedClusterPages {
  /** Rows concatenated in selection order — cluster by cluster, like the multi-namespace merge. */
  items: ResourceRow[];
  /** True when any (cluster, namespace) cell still has a server page to load. */
  hasMore: boolean;
}

/**
 * Merges the per-cluster snapshot pages into the aggregate table view. Rows
 * keep cluster order (the comparison layout: one cluster's rows, then the
 * next) and rows missing a page — a cluster still loading, failed, or without
 * that namespace — contribute nothing rather than stalling the merge. A
 * defensive de-dup on decorated uid collapses an accidental double delivery
 * of the same row (e.g. a retried page landing twice).
 */
export function mergeClusterPages(
  contextIds: string[],
  namespaces: string[],
  pages: Readonly<Record<string, ResourceListResponse | undefined>>,
): MergedClusterPages {
  const items: ResourceRow[] = [];
  const seen = new Set<string>();
  let hasMore = false;
  for (const contextId of contextIds) {
    for (const namespace of namespaces) {
      const page = pages[clusterPageKey(contextId, namespace)];
      if (!page) continue;
      for (const row of page.items) {
        const key = row.uid || `${row.namespace}/${row.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(row);
      }
      if (page.continueToken) hasMore = true;
    }
  }
  return { items, hasMore };
}

/** Returns a new pages record with one cell's next page appended. */
export function appendClusterPage(
  pages: Readonly<Record<string, ResourceListResponse>>,
  contextId: string,
  namespace: string,
  response: ResourceListResponse,
): Record<string, ResourceListResponse> {
  const key = clusterPageKey(contextId, namespace);
  const current = pages[key];
  return {
    ...pages,
    [key]: {
      ...response,
      items: [...(current?.items ?? []), ...response.items],
    },
  };
}

/**
 * The per-cluster namespaces of an aggregate fetch: the selected scope, or a
 * single cluster-wide cell for All-namespaces and cluster-scoped kinds —
 * their requests carry no namespace, so a stale multi selection must not fan
 * out for them.
 */
export function aggregateNamespaces(kind: { namespaced: boolean }, namespaceScope: NamespaceScope): string[] {
  return kind.namespaced && namespaceScope.length > 0 ? namespaceScope : [""];
}

/** Per-cluster status of an aggregate view, in selection order. */
export type ClusterListStatus = "loading" | "ok" | "error";

export interface ClusterListState {
  contextId: string;
  status: ClusterListStatus;
  /** First failure message when status is "error". */
  message?: string;
}

/** Unions per-cluster namespace lists into the aggregate picker's inventory. */
export function unionNamespaceLists(lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}
