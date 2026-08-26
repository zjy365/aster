import { useCallback, useEffect, useRef, useState } from "react";
import type { ResourceGetResponse, ResourceKind, ResourceRow } from "../../shared/types";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface ResourceDetailOptions {
  contextId: string;
  kind: ResourceKind;
  namespace: string;
  /** Changes whenever the list scope resets; closes any open selection. */
  generation: number;
  items: ResourceRow[];
}

export interface ResourceDetailState {
  selected?: ResourceRow;
  detail?: ResourceGetResponse;
  detailError: string;
  /** True while an explicit object refresh is in flight. */
  refreshing: boolean;
  select(row: ResourceRow): void;
  clear(): void;
  /**
   * Re-gets the open object and adopts the returned row, so a refresh (or an
   * applied mutation) updates the vitals and YAML without waiting for the
   * list watch — which snapshot-only scopes do not have.
   */
  refetch(): Promise<void>;
}

/** Identity tag of the object a fetched detail belongs to. */
function objectTag(row: ResourceRow): string {
  return `${row.uid || `${row.kind}:${row.namespace}/${row.name}`}@${row.resourceVersion}`;
}

/**
 * Kubernetes resource versions are monotonic (the watch pipeline relies on
 * this), so a numerically newer version always wins. Non-numeric values fall
 * back to inequality — the old adopt-on-any-change behavior.
 */
function isNewerResourceVersion(candidate: string, current: string): boolean {
  if (/^\d+$/.test(candidate) && /^\d+$/.test(current)) return BigInt(candidate) > BigInt(current);
  return candidate !== current;
}

/**
 * Owns the selected row and its fetched detail. The selection follows list
 * updates (resourceVersion bumps) and closes when the row disappears or the
 * list scope resets.
 */
export function useResourceDetail({ contextId, kind, namespace, generation, items }: ResourceDetailOptions): ResourceDetailState {
  const [selected, setSelected] = useState<ResourceRow>();
  const [detail, setDetail] = useState<ResourceGetResponse>();
  const [detailError, setDetailError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const detailRequest = useRef(0);
  /** Tag of the object the current `detail` was fetched for; skips duplicate gets. */
  const detailFor = useRef("");
  const selectedRef = useRef<ResourceRow | undefined>(undefined);
  selectedRef.current = selected;

  useEffect(() => {
    ++detailRequest.current;
    detailFor.current = "";
    setSelected(undefined);
    setDetail(undefined);
    setDetailError("");
    setRefreshing(false);
  }, [contextId, kind, namespace, generation]);

  useEffect(() => {
    if (!selected) return;
    const next = items.find((row) => (row.uid || `${row.kind}:${row.namespace}/${row.name}`)
      === (selected.uid || `${selected.kind}:${selected.namespace}/${selected.name}`));
    if (!next) {
      detailFor.current = "";
      setSelected(undefined);
      setDetail(undefined);
    } else if (isNewerResourceVersion(next.resourceVersion, selected.resourceVersion)) {
      // Never downgrade: an explicit refetch adopts the row the get returned,
      // which a stale list snapshot (or a lagging watch) has not caught up with.
      setSelected(next);
    }
  }, [items, selected]);

  // Fetches the object and adopts the returned row. Shared by the follow effect
  // (on selection change) and refetch (on explicit refresh / applied write).
  const fetchDetail = useCallback(async (row: ResourceRow) => {
    if (!contextId) return undefined;
    const request = ++detailRequest.current;
    try {
      const response = await desktop.resources.get({
        contextId,
        resourceKind: kind,
        namespace: row.namespace,
        name: row.name,
      });
      if (request !== detailRequest.current) return undefined;
      detailFor.current = objectTag(response.row);
      setDetail(response);
      setDetailError("");
      return response;
    } catch (cause) {
      if (request === detailRequest.current) setDetailError(messageOf(cause));
      return undefined;
    }
  }, [contextId, kind]);

  useEffect(() => {
    if (!selected || !contextId) return;
    if (detailFor.current === objectTag(selected)) return;
    setDetail(undefined);
    setDetailError("");
    void fetchDetail(selected);
  }, [contextId, kind, selected, fetchDetail]);

  const select = useCallback((row: ResourceRow) => setSelected(row), []);
  const clear = useCallback(() => {
    detailFor.current = "";
    setSelected(undefined);
    setDetail(undefined);
    setDetailError("");
  }, []);

  const refetch = useCallback(async () => {
    const current = selectedRef.current;
    if (!current || !contextId) return;
    setRefreshing(true);
    // Fetch straight through: the follow effect's tag guard would skip the get
    // when the snapshot already matches, but an explicit refresh must re-read.
    const response = await fetchDetail(current);
    if (response) setSelected(response.row);
    setRefreshing(false);
  }, [contextId, fetchDetail]);

  return { selected, detail, detailError, refreshing, select, clear, refetch };
}
