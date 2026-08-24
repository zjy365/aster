import { useCallback, useEffect, useRef, useState } from "react";
import type { HelmReleaseDetail, HelmReleaseSummary, HelmUpgradeRequest } from "../../shared/types";
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
  error: string;
  selected?: HelmReleaseDetail;
  detailLoading: boolean;
  detailError: string;
  busy: boolean;
  message: string;
  /** Bumps on every explicit refresh so the list effect re-fetches. */
  generation: number;
  refresh(): void;
  select(name: string): Promise<void>;
  clear(): void;
  uninstall(name: string): Promise<void>;
  rollback(name: string, revision?: number): Promise<void>;
  /** Resolves true when the upgrade succeeded so the dialog can close. */
  upgrade(input: HelmUpgradeInput): Promise<boolean>;
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
  const [message, setMessage] = useState("");
  const [generation, setGeneration] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    if (!contextId || !coreReady || !namespace) return;
    const current = ++request.current;
    setLoading(true);
    setError("");
    setReleases([]);
    desktop.helm.list(contextId, namespace)
      .then((items) => {
        if (current !== request.current) return;
        setReleases(items);
      })
      .catch((cause) => {
        if (current !== request.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [contextId, namespace, coreReady, generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  const select = useCallback(async (name: string) => {
    if (!contextId || !namespace || !name) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await desktop.helm.get({ contextId, namespace, name });
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
    if (!contextId || !namespace || busy) return;
    setBusy(true);
    setMessage("");
    setDetailError("");
    try {
      await desktop.helm.uninstall({ contextId, namespace, name });
      setMessage(`Release "${name}" uninstalled`);
      setSelected(undefined);
      refresh();
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, busy, refresh]);

  const rollback = useCallback(async (name: string, revision?: number) => {
    if (!contextId || !namespace || busy) return;
    setBusy(true);
    setMessage("");
    setDetailError("");
    try {
      await desktop.helm.rollback({ contextId, namespace, name, revision });
      setMessage(`Release "${name}" rolled back${revision ? ` to revision ${revision}` : " to the previous revision"}`);
      refresh();
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, busy, refresh]);

  const upgrade = useCallback(async (input: HelmUpgradeInput): Promise<boolean> => {
    if (!contextId || !namespace || busy) return false;
    setBusy(true);
    setMessage("");
    setDetailError("");
    try {
      const response = await desktop.helm.upgrade({ contextId, namespace, ...input });
      setMessage(`Release "${input.name}" upgraded to revision ${response.revision}`);
      await select(input.name);
      refresh();
      return true;
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [contextId, namespace, busy, select, refresh]);

  return {
    releases,
    loading,
    error,
    selected,
    detailLoading,
    detailError,
    busy,
    message,
    generation,
    refresh,
    select,
    clear,
    uninstall,
    rollback,
    upgrade,
  };
}
