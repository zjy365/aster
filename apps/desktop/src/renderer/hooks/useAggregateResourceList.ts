import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NamespaceScope, ResourceKind, ResourceListResponse, ResourceRow } from "../../shared/types";
import { MULTI_SCOPE_CONTINUE, namespaceScopeKey } from "../lib/namespace-scope";
import { messageOf } from "../lib/format";
import {
  aggregateNamespaces,
  appendClusterPage,
  CLUSTER_PAGE_SEPARATOR,
  clusterPageKey,
  clusterSelectionKey,
  splitClusterPageKey,
  ClusterListState,
  decorateClusterRow,
  mergeClusterPages,
} from "../lib/multi-cluster";
import { desktop } from "../lib/desktop";

export interface AggregateResourceListOptions {
  /** Two or more selected context ids; the hook stays idle otherwise. */
  contextIds: string[];
  kind: ResourceKind;
  /** The same namespace scope applies to every selected cluster. */
  namespaceScope: NamespaceScope;
  coreReady: boolean;
  /** False keeps the hook idle: no fetch, empty list. */
  enabled: boolean;
}

export interface AggregateResourceListState {
  list: ResourceListResponse;
  loading: boolean;
  loadingMore: boolean;
  /**
   * Always false: the aggregate view keeps no retained snapshot to
   * revalidate (per-cluster snapshots would blur on blend), so a revisit
   * simply refetches. Present so both list hooks share one interface.
   */
  revalidating: boolean;
  query: string;
  setQuery(query: string): void;
  visibleRows: ResourceRow[];
  /** Always true: the aggregate view is a bounded snapshot (no live watch). */
  snapshotOnly: boolean;
  /** Bumps on every explicit refresh; detail view uses it to close stale selections. */
  generation: number;
  /** Per-cluster fetch state in selection order; failures degrade, never block. */
  clusters: ClusterListState[];
  /** Re-fetches just one cluster's pages, keeping the others' rows on screen. */
  retryCluster(contextId: string): void;
  refresh(): void;
  loadMore(): Promise<void>;
  reset(): void;
}

/**
 * Owns the multi-cluster aggregate table: one ordinary single-context list
 * snapshot per (cluster, namespace) cell, fetched concurrently and merged
 * client-side. Like the multi-namespace scope it is deliberately
 * snapshot-only — one watch per view is the app's invariant, and a fan-out
 * watch across clusters would break it — so refresh is manual.
 *
 * Degradation is per cluster: a failed cluster's rows simply stay absent
 * while its status chip offers a retry; the other clusters render normally.
 */
export function useAggregateResourceList({ contextIds, kind, namespaceScope, coreReady, enabled }: AggregateResourceListOptions): AggregateResourceListState {
  const [pages, setPages] = useState<Record<string, ResourceListResponse>>({});
  const [clusterStates, setClusterStates] = useState<Record<string, ClusterListState>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState(0);
  // Supersedes every in-flight cell on scope change or refresh.
  const requestGen = useRef(0);
  const loadingMoreGeneration = useRef<number | undefined>(undefined);
  // Per-cluster epochs: a retry supersedes only that cluster's in-flight cells.
  const clusterEpochs = useRef<Record<string, number>>({});
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const scopeRef = useRef(namespaceScope);
  scopeRef.current = namespaceScope;
  const idsRef = useRef(contextIds);
  idsRef.current = contextIds;

  const active = enabled && contextIds.length > 1 && coreReady;
  const namespaces = useMemo(() => aggregateNamespaces(kind, namespaceScope), [kind, namespaceScope]);
  const selectionKey = useMemo(() => clusterSelectionKey(contextIds), [contextIds]);
  // Canonical identity of the scope dimensions; a reordering of either must
  // not tear the view down and refetch everything.
  const scopeKey = useMemo(() => namespaceScopeKey(namespaceScope), [namespaceScope]);

  const merged = useMemo(
    () => mergeClusterPages(contextIds, namespaces, active ? pages : {}),
    [contextIds, namespaces, pages, active],
  );
  const list: ResourceListResponse = {
    items: merged.items,
    ...(merged.hasMore ? { continueToken: MULTI_SCOPE_CONTINUE } : {}),
  };

  const applyClusterState = useCallback((contextId: string, status: ClusterListState["status"], message?: string) => {
    setClusterStates((current) => ({
      ...current,
      [contextId]: status === "error" ? { contextId, status, message } : { contextId, status },
    }));
  }, []);

  /** Fetches one (cluster, namespace) cell's first page; decorations applied on arrival. */
  const fetchCell = useCallback(async (contextId: string, namespace: string, gen: number, epoch: number) => {
    try {
      const response = await desktop.resources.list({
        contextId,
        resourceKind: kind,
        ...(namespace ? { namespace } : {}),
        limit: 100,
      });
      if (gen !== requestGen.current || epoch !== (clusterEpochs.current[contextId] ?? 0)) return;
      const decorated: ResourceListResponse = { ...response, items: response.items.map((row) => decorateClusterRow(row, contextId)) };
      setPages((current) => ({ ...current, [clusterPageKey(contextId, namespace)]: decorated }));
      return true;
    } catch (cause) {
      if (gen !== requestGen.current || epoch !== (clusterEpochs.current[contextId] ?? 0)) return false;
      applyClusterState(contextId, "error", messageOf(cause));
      return false;
    }
  }, [kind, applyClusterState]);

  /** Loads one cluster's first pages; the cluster settles "ok" once every cell landed. */
  const loadCluster = useCallback((contextId: string, gen: number) => {
    const epoch = (clusterEpochs.current[contextId] ?? 0) + 1;
    clusterEpochs.current[contextId] = epoch;
    applyClusterState(contextId, "loading");
    // A retry replaces that cluster's pages wholesale; the other clusters'
    // cells stay untouched so their rows never leave the screen.
    setPages((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`${contextId}${CLUSTER_PAGE_SEPARATOR}`)),
    ));
    const cells = aggregateNamespaces(kind, scopeRef.current);
    void Promise.all(cells.map((namespace) => fetchCell(contextId, namespace, gen, epoch)))
      .then((results) => {
        if (gen !== requestGen.current || epoch !== (clusterEpochs.current[contextId] ?? 0)) return;
        if (results.every(Boolean)) applyClusterState(contextId, "ok");
      });
  }, [kind, fetchCell, applyClusterState]);

  // The aggregate fetch effect: keyed on the canonical selection and scope
  // keys so reorderings do not refetch. In-flight requests from a previous
  // scope are superseded by the generation bump; each cluster still lands
  // its rows incrementally.
  useEffect(() => {
    if (!active) return;
    const gen = ++requestGen.current;
    clusterEpochs.current = {};
    setPages({});
    setLoadingMore(false);
    setClusterStates({});
    for (const contextId of idsRef.current) loadCluster(contextId, gen);
  }, [active, selectionKey, scopeKey, kind, generation, loadCluster]);

  const clusters = useMemo(
    () => contextIds.map((contextId) => clusterStates[contextId] ?? { contextId, status: "loading" as const }),
    [contextIds, clusterStates],
  );
  // The table's loading state only covers the very first paint; once any
  // cluster has settled, its rows render while the rest keep loading or show
  // their error chip — a slow or dead cluster never blocks the others.
  const loading = active && clusters.length > 0 && clusters.every((cluster) => cluster.status === "loading");

  const loadMore = useCallback(async () => {
    if (!active || loadingMoreGeneration.current === requestGen.current) return;
    const pending = Object.entries(pagesRef.current).filter(([, page]) => page.continueToken);
    if (!pending.length) return;
    const gen = requestGen.current;
    loadingMoreGeneration.current = gen;
    setLoadingMore(true);
    await Promise.all(pending.map(async ([key, page]) => {
      const { contextId, namespace } = splitClusterPageKey(key);
      const epoch = clusterEpochs.current[contextId] ?? 0;
      try {
        const response = await desktop.resources.list({
          contextId,
          resourceKind: kind,
          ...(namespace ? { namespace } : {}),
          limit: 100,
          continueToken: page.continueToken,
        });
        if (gen !== requestGen.current || epoch !== (clusterEpochs.current[contextId] ?? 0)) return;
        const decorated: ResourceListResponse = { ...response, items: response.items.map((row) => decorateClusterRow(row, contextId)) };
        // A different cluster's first page or retry may settle while this
        // page is in flight. Append only to the latest state, never a snapshot
        // captured before the request; the token also rejects double delivery.
        setPages((current) => {
          if (gen !== requestGen.current || epoch !== (clusterEpochs.current[contextId] ?? 0)
            || current[key]?.continueToken !== page.continueToken) return current;
          return appendClusterPage(current, contextId, namespace, decorated);
        });
      } catch {
        // Keep that cell's loaded page and token; the footer button retries
        // only the cells that still have one.
      }
    }));
    if (loadingMoreGeneration.current === gen) loadingMoreGeneration.current = undefined;
    if (gen === requestGen.current) setLoadingMore(false);
  }, [active, kind]);

  const retryCluster = useCallback((contextId: string) => {
    if (!active || !contextIds.includes(contextId)) return;
    loadCluster(contextId, requestGen.current);
  }, [active, contextIds, loadCluster]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list.items;
    return list.items.filter((item) =>
      item.name.toLowerCase().includes(needle)
      || item.namespace.toLowerCase().includes(needle)
      || item.status?.toLowerCase().includes(needle)
      // The cluster column filters too: typing a context name isolates its rows.
      || (item.sourceContextId?.toLowerCase().includes(needle) ?? false),
    );
  }, [list.items, query]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const reset = useCallback(() => {
    setPages({});
    setClusterStates({});
  }, []);

  return {
    list,
    loading,
    loadingMore,
    revalidating: false,
    query,
    setQuery,
    visibleRows,
    snapshotOnly: true,
    generation,
    clusters,
    retryCluster,
    refresh,
    loadMore,
    reset,
  };
}
