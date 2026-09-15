import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NamespaceScope, ResourceKind, ResourceListResponse, ResourceRow, ResourceWatchBatch } from "../../shared/types";
import { applyResourceWatchBatches } from "../lib/resource-watch";
import { readResourceListSnapshot, resourceListCacheKey, writeResourceListSnapshot, clearResourceListSnapshots } from "../lib/resource-list-cache";
import { MULTI_SCOPE_CONTINUE, mergeNamespacePages } from "../lib/namespace-scope";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface ResourceListOptions {
  contextId: string;
  kind: ResourceKind;
  /**
   * Ordered namespace selection: [] is the cluster-wide All-namespaces scope,
   * one name is the live-watch scope, two or more fan out as per-namespace
   * snapshot requests merged in selection order.
   */
  namespaceScope: NamespaceScope;
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
 * A cluster-wide list (All-namespaces scope on a namespaced kind) is never
 * watched. Watching it would open one cluster-scoped watch stream whose
 * per-object deltas flood the IPC channel and the API server in a 100k-
 * namespace cluster, so the table gets the first snapshot page and manual
 * refresh only. A multi-namespace selection is a bounded fan-out of ordinary
 * single-namespace snapshot requests — also never watched, so the invariant
 * "at most one watch per list view" survives.
 */
function liveWatchEnabled(kind: ResourceKind, scopeSize: number, enabled: boolean): boolean {
  return enabled && (kind.namespaced ? scopeSize === 1 : true);
}

/**
 * Owns the resource table data: the snapshot+delta watch subscription with a
 * 24ms flush queue, manual next-page loading (server pagination is kept),
 * the filter query, and the visible error. Selection resets triggered by
 * list scope changes live in useResourceDetail via `generation`.
 */
export function useResourceList({ contextId, kind, namespaceScope, coreReady, setError, labelSelector, enabled = true }: ResourceListOptions): ResourceListState {
  const [list, setList] = useState<ResourceListResponse>({ items: [] });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState(0);
  const listRequest = useRef(0);
  const watchSubscription = useRef(0);
  const cacheContext = useRef(contextId);
  const watchQueue = useRef<ResourceWatchBatch[]>([]);
  const watchHasSnapshot = useRef(false);
  const watchFlushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Latest list, so the scope-change cleanup can retain it as a snapshot.
  const listRef = useRef(list);
  useEffect(() => {
    if (cacheContext.current !== contextId) {
      clearResourceListSnapshots();
      cacheContext.current = contextId;
    }
    listRef.current = list;
  }, [contextId, list]);

  // Multi-scope fan-out state: one snapshot page per selected namespace,
  // merged in selection order. The ref backs loadMore; the scope ref keeps
  // effects keyed on the order-insensitive scope key from re-running (and
  // re-fetching everything) on a mere reordering.
  const [multiPages, setMultiPages] = useState<Record<string, ResourceListResponse>>({});
  const multiPagesRef = useRef(multiPages);
  const scopeRef = useRef(namespaceScope);
  scopeRef.current = namespaceScope;
  multiPagesRef.current = multiPages;

  const liveWatch = liveWatchEnabled(kind, namespaceScope.length, enabled);
  // Cluster-scoped kinds ignore the scope entirely — their requests carry no
  // namespace, so a stale multi selection must not fan out for them.
  const multiScope = kind.namespaced && namespaceScope.length > 1;
  const scopeKey = useMemo(() => [...namespaceScope].sort().join("\u001f"), [namespaceScope]);

  // The multi-scope view derives from the per-namespace pages in selection
  // order; the sentinel token only signals "some namespace has another page"
  // and is never sent back to the core.
  const merged = useMemo(
    () => mergeNamespacePages(namespaceScope, multiScope ? multiPages : {}),
    [namespaceScope, multiScope, multiPages],
  );
  const listView: ResourceListResponse = multiScope
    ? { items: merged.items, ...(merged.hasMore ? { continueToken: MULTI_SCOPE_CONTINUE } : {}) }
    : list;
  useEffect(() => {
    listRef.current = listView;
  }, [listView]);

  const loadMore = useCallback(async () => {
    if (!contextId || !coreReady || !enabled) return;
    if (multiScope) {
      const pages = multiPagesRef.current;
      const pending = scopeRef.current.filter((namespace) => pages[namespace]?.continueToken);
      if (!pending.length) return;
      const request = ++listRequest.current;
      setLoadingMore(true);
      setError("");
      let next = pages;
      await Promise.all(pending.map(async (namespace) => {
        try {
          const response = await desktop.resources.list({
            contextId,
            resourceKind: kind,
            namespace,
            ...(labelSelector ? { labelSelector } : {}),
            limit: 100,
            continueToken: pages[namespace].continueToken,
          });
          if (request !== listRequest.current) return;
          next = {
            ...next,
            [namespace]: {
              ...response,
              items: [...(next[namespace]?.items ?? []), ...response.items],
            },
          };
        } catch {
          // Keep that namespace's loaded page and token; the footer button
          // retries only the namespaces that still have one.
        }
      }));
      if (request !== listRequest.current) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      multiPagesRef.current = next;
      setMultiPages(next);
      setLoadingMore(false);
      return;
    }
    if (!list.continueToken) return;
    const request = ++listRequest.current;
    setLoadingMore(true);
    setError("");
    try {
      const namespace = scopeRef.current[0] ?? "";
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
  }, [contextId, coreReady, enabled, kind, labelSelector, list.continueToken, multiScope, setError]);

  useEffect(() => {
    if (!contextId || !coreReady || !enabled) return;
    if (multiScope) return; // handled by the fan-out effect below
    ++listRequest.current;
    setError("");
    watchQueue.current = [];
    watchHasSnapshot.current = false;
    // Read through the ref: the effect keys on the canonical scope key, so a
    // reordering (or an upstream array re-creation with equal contents)
    // cannot tear the subscription down.
    const namespace = scopeRef.current[0] ?? "";

    // Only watched (namespace-scoped) views retain snapshots; cluster-wide
    // snapshot-only scopes keep their manual-refresh behavior untouched.
    const cacheKey = liveWatch ? resourceListCacheKey(contextId, kind.id, scopeKey, labelSelector) : "";
    const cached = cacheKey ? readResourceListSnapshot(cacheKey) : undefined;
    if (cached) {
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

    // Cluster-wide namespaced lists are snapshot-only (see liveWatchEnabled):
    // the initial page is fetched, watch never starts, and refresh re-fetches.
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

    const subscription = ++watchSubscription.current;
    let active = true;
    const stop = desktop.resources.watch({
      contextId,
      resourceKind: kind,
      ...(kind.namespaced && namespace ? { namespace } : {}),
      ...(labelSelector ? { labelSelector } : {}),
      limit: 100,
    }, (batch) => {
      if (!active || subscription !== watchSubscription.current) return;
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
        if (!active || subscription !== watchSubscription.current) return;
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
      active = false;
      stop();
      watchQueue.current = [];
      if (watchFlushTimer.current !== undefined) {
        clearTimeout(watchFlushTimer.current);
        watchFlushTimer.current = undefined;
      }
      // Retain the leaving view's latest rows for the next revisit.
      if (cacheKey && watchHasSnapshot.current) {
        writeResourceListSnapshot(cacheKey, listRef.current);
      }
    };
  }, [contextId, kind, coreReady, enabled, labelSelector, generation, setError, liveWatch, multiScope, scopeKey]);

  // Multi-namespace fan-out: one ordinary single-namespace snapshot request
  // per selected namespace (never a watch), merged in selection order. The
  // request generation supersedes every in-flight page on scope change or
  // refresh; a failed namespace degrades to "no rows from it" while the rest
  // still render.
  useEffect(() => {
    if (!multiScope || !contextId || !coreReady || !enabled) return;
    ++listRequest.current;
    const request = listRequest.current;
    setError("");
    const scope = scopeRef.current;
    const cacheKey = resourceListCacheKey(contextId, kind.id, scopeKey, labelSelector);
    const cached = readResourceListSnapshot(cacheKey);
    let pages: Record<string, ResourceListResponse> = {};
    let completed = false;
    if (cached) {
      // Stale-while-revalidate: the retained merged view renders at once
      // (without page tokens — they are not part of the merged snapshot)
      // while every namespace re-fetches its fresh snapshot in place.
      setList(cached);
      setMultiPages({});
      setLoading(false);
      setRevalidating(true);
    } else {
      setLoading(true);
      setRevalidating(false);
      setList({ items: [] });
    }

    const remaining = new Set(scope);
    const settle = () => {
      if (remaining.size > 0 || request !== listRequest.current) return;
      completed = true;
      setLoading(false);
      setRevalidating(false);
    };
    const fetchOne = async (namespace: string) => {
      try {
        const response = await desktop.resources.list({
          contextId,
          resourceKind: kind,
          namespace,
          ...(labelSelector ? { labelSelector } : {}),
          limit: 100,
        });
        if (request !== listRequest.current) return;
        pages = { ...pages, [namespace]: response };
        setMultiPages(pages);
        remaining.delete(namespace);
        settle();
      } catch (cause) {
        if (request !== listRequest.current) return;
        setError(messageOf(cause));
        remaining.delete(namespace);
        settle();
      }
    };
    for (const namespace of scope) void fetchOne(namespace);

    return () => {
      if (request !== listRequest.current) return;
      // Retain the leaving scope's merged rows for the next revisit.
      if (completed && scope.length) {
        const mergedSnapshot = mergeNamespacePages(scope, pages);
        if (mergedSnapshot.items.length) {
          writeResourceListSnapshot(cacheKey, { items: mergedSnapshot.items });
        }
      }
    };
  }, [contextId, multiScope, scopeKey, kind, coreReady, enabled, labelSelector, generation, setError]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return listView.items;
    return listView.items.filter((item) =>
      item.name.toLowerCase().includes(needle)
      || item.namespace.toLowerCase().includes(needle)
      || item.status?.toLowerCase().includes(needle),
    );
  }, [listView.items, query]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  const reset = useCallback(() => {
    setList({ items: [] });
    setMultiPages({});
  }, []);

  return {
    list: listView,
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
