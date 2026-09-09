import { useCallback, useEffect, useRef, useState } from "react";
import type { HelmReleaseDetail, HelmReleaseSummary, HelmUpgradeRequest } from "../../shared/types";
import { toast } from "@/components/ui/toast";
import { desktop } from "../lib/desktop";

export interface UseHelmOptions {
  contextId: string;
  namespace: string;
  coreReady: boolean;
}

export type HelmUpgradeInput = Omit<HelmUpgradeRequest, "contextId" | "namespace">;

export interface HelmState {
  releases: HelmReleaseSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore(): void;
  error: string;
  progress: string;
  cancel(): void;
  selected?: HelmReleaseDetail;
  detailLoading: boolean;
  detailError: string;
  busy: boolean;
  /** Bumps on every explicit refresh so the list effect re-fetches. */
  generation: number;
  refresh(): void;
  select(name: string, namespace?: string): Promise<void>;
  clear(): void;
  uninstall(name: string): Promise<void>;
  rollback(name: string, revision?: number): Promise<void>;
  /** Resolves null on success so the dialog can close, or the error message. */
  upgrade(input: HelmUpgradeInput): Promise<string | null>;
}

/**
 * Owns the Helm releases view: the list scoped to the active namespace plus
 * the selected release's full read. Uninstall and rollback are write
 * operations; the core runs them synchronously, so the view blocks on one
 * action at a time and refreshes the list when it finishes.
 */
export function useHelm({ contextId, namespace, coreReady }: UseHelmOptions): HelmState {
  const [releases, setReleases] = useState<HelmReleaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<HelmReleaseDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const loadNextPage = useRef<() => void>(() => {});
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const stopList = useRef<() => void>(() => {});
  const [progress, setProgress] = useState("");

  // Same scope-reset contract as useResourceDetail: when the list scope
  // (context or namespace) changes, close any open release detail so a stale
  // cross-namespace read can't linger under a picker that says otherwise.
  useEffect(() => {
    setSelected(undefined);
    setDetailError("");
  }, [contextId, namespace]);

  useEffect(() => {
    setReleases([]);
    setError("");
    setProgress("");
    setHasMore(false);
    setLoadingMore(false);
    setLoading(Boolean(contextId && coreReady));
    if (!contextId || !coreReady) return;
    let active = true;
    let pending = false;
    let pageRequest = 0;
    let cursor = "";
    let retainedCursor = "";
    let stop = () => {};
    const close = (continueToken: string) => {
      void desktop.helm.closeList({ contextId, namespace, continueToken }).catch(() => {});
    };
    const startPage = (continueToken: string) => {
      if (!active || pending) return;
      pending = true;
      const current = ++pageRequest;
      setLoading(!continueToken);
      setLoadingMore(Boolean(continueToken));
      setError("");
      setProgress("");
      stop = desktop.helm.list({ contextId, namespace, continueToken: continueToken || undefined }, (event) => {
        if (!active || current !== pageRequest) {
          if (!active && event.kind === "done" && event.continueToken) close(event.continueToken);
          return;
        }
        if (event.kind === "progress") return;
        pending = false;
        setLoading(false);
        setLoadingMore(false);
        if (event.kind === "error") { setError(event.message); return; }
        // Commit the whole page once; heartbeat/progress never changes rows.
        setReleases((items) => continueToken ? [...items, ...(event.releases ?? [])] : (event.releases ?? []));
        cursor = event.continueToken ?? "";
        if (cursor) retainedCursor = cursor;
        setHasMore(Boolean(cursor));
      });
    };
    loadNextPage.current = () => { if (cursor) startPage(cursor); };
    stopList.current = () => {
      ++pageRequest;
      pending = false;
      stop();
      setLoading(false);
      setLoadingMore(false);
      setProgress("Loading cancelled");
    };
    startPage("");
    return () => {
      active = false;
      ++pageRequest;
      stop();
      if (retainedCursor) close(retainedCursor);
    };
  }, [contextId, namespace, coreReady, generation]);

  const loadMore = useCallback(() => loadNextPage.current(), []);
  const cancel = useCallback(() => stopList.current(), []);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  const select = useCallback(async (name: string, releaseNamespace?: string) => {
    const ns = releaseNamespace || namespace;
    if (!contextId || !ns || !name) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await desktop.helm.get({ contextId, namespace: ns, name });
      setSelected(detail);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetailLoading(false);
    }
  }, [contextId, namespace]);

  const clear = useCallback(() => {
    setSelected(undefined);
    setDetailError("");
  }, []);

  const uninstall = useCallback(async (name: string) => {
    const ns = selected?.namespace || namespace;
    if (!contextId || !ns || busy) return;
    setBusy(true);
    setDetailError("");
    try {
      await desktop.helm.uninstall({ contextId, namespace: ns, name });
      toast.add({ title: `Release "${name}" uninstalled`, type: "success" });
      setSelected(undefined);
      refresh();
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, selected, busy, refresh]);

  const rollback = useCallback(async (name: string, revision?: number) => {
    const ns = selected?.namespace || namespace;
    if (!contextId || !ns || busy) return;
    setBusy(true);
    setDetailError("");
    try {
      await desktop.helm.rollback({ contextId, namespace: ns, name, revision });
      toast.add({ title: `Release "${name}" rolled back${revision ? ` to revision ${revision}` : " to the previous revision"}`, type: "success" });
      refresh();
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, selected, busy, refresh]);

  const upgrade = useCallback(async (input: HelmUpgradeInput): Promise<string | null> => {
    const ns = selected?.namespace || namespace;
    if (!contextId || !ns || busy) return "Another operation is already in progress";
    setBusy(true);
    setDetailError("");
    try {
      const response = await desktop.helm.upgrade({ contextId, namespace: ns, ...input });
      toast.add({ title: `Release "${input.name}" upgraded to revision ${response.revision}`, type: "success" });
      await select(input.name, ns);
      refresh();
      return null;
    } catch (cause) {
      // Returned so the open dialog can show it; detailError keeps it visible
      // on the detail view after the dialog closes.
      const failure = cause instanceof Error ? cause.message : String(cause);
      setDetailError(failure);
      return failure;
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, selected, busy, select, refresh]);

  return {
    releases,
    progress,
    cancel,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    selected,
    detailLoading,
    detailError,
    busy,
    generation,
    refresh,
    select,
    clear,
    uninstall,
    rollback,
    upgrade,
  };
}
