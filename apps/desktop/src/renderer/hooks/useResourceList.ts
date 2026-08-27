import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResourceKind, ResourceListResponse, ResourceRow, ResourceWatchBatch } from "../../shared/types";
import { applyResourceWatchBatches } from "../lib/resource-watch";
import { readResourceListSnapshot, resourceListCacheKey, writeResourceListSnapshot } from "../lib/resource-list-cache";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface ResourceListOptions {
  contextId: string;
  kind: ResourceKind;
  namespace: string;
  coreReady: boolean;
  setError(message: string): void;
  /** Server-side selector pinning the list, e.g. a workload's pod selector. */
  labelSelector?: string;
  /** False keeps the hook idle: no watch, no fetch, empty list. */
  enabled?: boolean;
}

export interface ResourceListState {
  list: ResourceListResponse;
  loading: boolean;
  loadingMore: boolean;
  /** True while cached rows show and a fresh snapshot runs behind them. */
  revalidating: boolean;
  query: string;
  setQuery(query: string): void;
  visibleRows: ResourceRow[];
  /** True when the list is a bounded snapshot rather than a live watch stream. */
  snapshotOnly: boolean;
  /** Bumps on every explicit refresh; detail view uses it to close stale selections. */
  generation: number;
  refresh(): void;
  loadMore(): Promise<void>;
  reset(): void;
}

/**
 * A cluster-wide list (namespace unset on a namespaced kind) is never watched.
 * Watching it would open one cluster-scoped watch stream whose per-object
 * deltas flood the IPC channel and the API server in a 100k-namespace cluster,
 * so the table gets the first snapshot page and manual refresh only.
 */
function watchEnabled(kind: ResourceKind, namespace: string, enabled: boolean): boolean {
  return enabled && (kind.namespaced ? namespace !== "" : true);
}

/**
 * Owns the resource table data: the snapshot+delta watch subscription with a
 * 24ms flush queue, manual next-page loading (server pagination is kept),
 * the filter query, and the visible error. Selection resets triggered by
 * list scope changes live in useResourceDetail via `generation`.
 */
export function useResourceList({ contextId, kind, namespace, coreReady, setError, labelSelector, enabled = true }: ResourceListOptions): ResourceListState {
  const [list, setList] = useState<ResourceListResponse>({ items: [] });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState(0);
  const listRequest = useRef(0);
  const watchQueue = useRef<ResourceWatchBatch[]>([]);
  const watchHasSnapshot = useRef(false);
  const watchFlushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Latest list, so the scope-change cleanup can retain it as a snapshot.
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  const liveWatch = watchEnabled(kind, namespace, enabled);

  const loadMore = useCallback(async () => {
    if (!contextId || !coreReady || !enabled || !list.continueToken) return;
    const request = ++listRequest.current;
    setLoadingMore(true);
    setError("");
    try {
      const response = await desktop.resources.list({
        contextId,
        resourceKind: kind,
        ...(kind.namespaced && namespace ? { namespace } : {}),
        ...(labelSelector ? { labelSelector } : {}),
        limit: 100,
        continueToken: list.continueToken,
      });
      if (request !== listRequest.current) return;
      setList((current) => ({ ...response, items: [...current.items, ...response.items] }));
    } catch {
      // Keep the loaded page; the footer button retries with the same token.
    } finally {
      if (request !== listRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [contextId, coreReady, enabled, kind, labelSelector, list.continueToken, namespace, setError]);

  useEffect(() => {
    if (!contextId || !coreReady || !enabled) return;
    ++listRequest.current;
    setError("");
    watchQueue.current = [];
    watchHasSnapshot.current = false;

    // Only watched (namespace-scoped) views retain snapshots; cluster-wide
    // snapshot-only scopes keep their manual-refresh behavior untouched.
    const cacheKey = liveWatch ? resourceListCacheKey(contextId, kind.id, namespace, labelSelector) : "";
    const cached = cacheKey ? readResourceListSnapshot(cacheKey) : undefined;
    if (cached?.items.length) {
      // Stale-while-revalidate: revisit renders the retained snapshot at once
      // and the fresh snapshot + watch replaces it in place below.
      setList(cached);
      setLoading(false);
      setRevalidating(true);
    } else {
      setLoading(true);
      setRevalidating(false);
      setList({ items: [] });
    }

    // Cluster-wide namespaced lists are snapshot-only (see watchEnabled): the
    // initial page is fetched, watch never starts, and refresh re-fetches.
    if (!liveWatch) {
      let active = true;
      desktop.resources.list({
        contextId,
        resourceKind: kind,
        ...(kind.namespaced && namespace ? { namespace } : {}),
        ...(labelSelector ? { labelSelector } : {}),
        limit: 100,
      }).then((response) => {
        if (!active || !listRequest.current) return;
        setList(response);
      }).catch((cause) => {
        if (active) setError(messageOf(cause));
      }).finally(() => {
        if (active) setLoading(false);
      });
      return () => { active = false; };
    }

    const stop = desktop.resources.watch({
      contextId,
      resourceKind: kind,
      ...(kind.namespaced && namespace ? { namespace } : {}),
      ...(labelSelector ? { labelSelector } : {}),
      limit: 100,
    }, (batch) => {
      if (batch.kind === "error") {
        setLoading(false);
        setRevalidating(false);
        if (!watchHasSnapshot.current) setError(batch.message);
        return;
      }
      if (batch.kind === "snapshot") watchHasSnapshot.current = true;
      watchQueue.current.push(batch);
      if (watchFlushTimer.current !== undefined) return;
      watchFlushTimer.current = setTimeout(() => {
        watchFlushTimer.current = undefined;
        const batches = watchQueue.current;
        watchQueue.current = [];
        setList((current) => applyResourceWatchBatches(current, batches));
        // The flush only runs once fresh batches arrive, so any retained
        // snapshot has now been replaced by live data.
        setLoading(false);
        setRevalidating(false);
      }, 24);
    });

    return () => {
      stop();
      watchQueue.current = [];
      if (watchFlushTimer.current !== undefined) {
        clearTimeout(watchFlushTimer.current);
        watchFlushTimer.current = undefined;
      }
      // Retain the leaving view's latest rows for the next revisit.
      if (cacheKey && listRef.current.items.length) {
        writeResourceListSnapshot(cacheKey, listRef.current);
      }
    };
  }, [contextId, namespace, kind, coreReady, enabled, labelSelector, generation, setError, liveWatch]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list.items;
    return list.items.filter((item) =>
      item.name.toLowerCase().includes(needle)
      || item.namespace.toLowerCase().includes(needle)
      || item.status?.toLowerCase().includes(needle),
    );
  }, [list.items, query]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const reset = useCallback(() => setList({ items: [] }), []);

  return {
    list,
    loading,
    loadingMore,
    revalidating,
    query,
    setQuery,
    visibleRows,
    snapshotOnly: !liveWatch,
    generation,
    refresh,
    loadMore,
    reset,
  };
}
