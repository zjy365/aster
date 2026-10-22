import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextInfo, NamespaceInfo, NamespaceScope } from "../../shared/types";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";
import { clusterSelectionKey, unionNamespaceLists } from "../lib/multi-cluster";
import {
  NAMESPACE_CACHE_TTL_MS,
  readNamespaceCache,
  writeNamespaceCache,
} from "../lib/namespace-cache";

export interface NamespacesState {
  namespaces: NamespaceInfo[];
  /** True when the core capped the namespace list; pickers should say so. */
  truncated: boolean;
  /** True while the lazy first fetch is in flight; pickers show a loading row. */
  loading: boolean;
  /** True after the lazy inventory has completed successfully, including empty results. */
  loaded: boolean;
  /** Ordered namespace selection; [] is the All-namespaces scope. */
  namespaceScope: NamespaceScope;
  setNamespaceScope(scope: NamespaceScope): void;
  /** Lazily fetches the namespace list on first use (pickers, ⌘K). */
  load(): void;
}

/**
 * Applies the context's default namespace on connect and lazily loads the
 * namespace list. In a 100k+ namespace cluster the list can take seconds and
 * tens of pages to fetch, so it is never loaded eagerly at connect time —
 * only when the top picker or the command palette first needs it, once.
 * Failures surface through onError and allow a retry on the next open.
 *
 * Lists are retained per cluster (see namespace-cache). Switching A→B→A
 * renders the cached list instantly with no request; a stale entry (older
 * than the TTL) still renders instantly and is re-fetched in the background,
 * replacing the rows in place. The generation guard discards a slow fetch
 * started under a previous context, and loadingRef keeps the effect-triggered
 * refresh and a later picker open from doubling up.
 *
 * An aggregate view (contextIds with 2+ entries) skips the per-cluster cache
 * and unions the live lists instead: the scope's namespaces are offered from
 * every selected cluster, and a namespace only one cluster knows is still
 * selectable — the clusters without it simply return no rows for it.
 */
export function useNamespaces(
  contextId: string,
  contexts: ContextInfo[],
  onError: (message: string) => void,
  contextIds?: string[],
): NamespacesState {
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [namespaceScope, setNamespaceScope] = useState<NamespaceScope>([]);
  const [loaded, setLoaded] = useState(false);
  const loadingRef = useRef(false);
  // Bumped on every context change so a slow fetch started under the previous
  // context is discarded when it resolves late.
  const generationRef = useRef(0);
  const aggregate = (contextIds?.length ?? 0) > 1;
  // Order-insensitive identity of the cluster selection, so the reset effect
  // below does not churn on array re-creation with equal contents.
  const clusterKey = useMemo(
    () => (aggregate ? clusterSelectionKey(contextIds!) : ""),
    [aggregate, contextIds],
  );

  // Fetches the current scope's inventory. Cold loads (no retained list)
  // show the picker's loading row; stale-while-revalidate refreshes keep the
  // retained list on screen and replace it in place.
  const fetchList = useCallback((showLoading: boolean) => {
    if (!contextId || loadingRef.current) return;
    loadingRef.current = true;
    if (showLoading) setLoading(true);
    const generation = generationRef.current;
    if (aggregate) {
      // Union fan-out: one ordinary per-cluster list call each; a cluster
      // that fails drops out of the union instead of failing the whole scope,
      // and only a total outage surfaces as an error.
      void Promise.all((contextIds ?? [contextId]).map((id) =>
        desktop.namespaces.list(id)
          .then((result) => ({ names: result.namespaces.map((item) => item.name), truncated: result.truncated, failed: false as const }))
          .catch(() => ({ names: [] as string[], truncated: false, failed: true as const })),
      )).then((results) => {
        if (generation !== generationRef.current) return;
        loadingRef.current = false;
        setLoading(false);
        if (results.every((result) => result.failed)) {
          onError("Could not load namespaces from any selected cluster");
          return;
        }
        const names = unionNamespaceLists(results.filter((result) => !result.failed).map((result) => result.names));
        setNamespaces(names.map((name) => ({ name })));
        setTruncated(results.some((result) => result.truncated));
        setLoaded(true);
      });
      return;
    }
    desktop.namespaces.list(contextId)
      .then((result) => {
        if (generation !== generationRef.current) return;
        loadingRef.current = false;
        setLoading(false);
        setNamespaces(result.namespaces);
        setTruncated(result.truncated);
        setLoaded(true);
        writeNamespaceCache(contextId, result.namespaces.map((item) => item.name), result.truncated);
      })
      .catch((cause) => {
        // Keep loadingRef false so the next open retries; a failed refresh
        // leaves the retained (possibly stale) list on screen.
        if (generation !== generationRef.current) return;
        loadingRef.current = false;
        setLoading(false);
        onError(messageOf(cause));
      });
  }, [contextId, onError, aggregate, contextIds]);

  useEffect(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    setNamespaces([]);
    setTruncated(false);
    setLoading(false);
    setLoaded(false);
    if (!contextId) {
      setNamespaceScope((current) => (current.length ? [] : current));
      return;
    }
    // The context's default namespace is known without the list. connectContext
    // may already have applied the same scope: bail out on equal contents so
    // the array identity — and with it every scope-keyed effect — stays put.
    const context = contexts.find((item) => item.id === contextId);
    const defaultNamespace = context?.namespace || "";
    setNamespaceScope((current) => (
      current.length === (defaultNamespace ? 1 : 0) && current[0] === defaultNamespace ? current : defaultNamespace ? [defaultNamespace] : []
    ));
    if (aggregate) return;
    // A retained list renders at once; a stale one refreshes in the background.
    const cached = readNamespaceCache(contextId);
    if (cached) {
      setNamespaces(cached.names.map((name) => ({ name })));
      setTruncated(cached.truncated);
      setLoaded(true);
      if (Date.now() - cached.fetchedAt >= NAMESPACE_CACHE_TTL_MS) fetchList(false);
    }
    // Only a context switch resets the list; contexts identity churn must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, clusterKey]);

  const load = useCallback(() => {
    if (!contextId || loadingRef.current || (aggregate && loaded)) return;
    if (!aggregate) {
      const cached = readNamespaceCache(contextId);
      if (cached) {
        // Fresh lists need nothing; stale ones re-fetch quietly (the switch
        // effect may already have started the refresh, which loadingRef guards).
        if (Date.now() - cached.fetchedAt >= NAMESPACE_CACHE_TTL_MS) fetchList(false);
        return;
      }
    }
    // Cold path: first time this scope's inventory is needed. The aggregate
    // inventory stays loaded until the connected cluster selection changes.
    fetchList(true);
  }, [contextId, aggregate, loaded, fetchList]);

  return { namespaces, truncated, loading, loaded, namespaceScope, setNamespaceScope, load };
}
