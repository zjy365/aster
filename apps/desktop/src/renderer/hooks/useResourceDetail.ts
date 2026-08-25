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

  useEffect(() => {
    if (!selected || !contextId) return;
    const tag = objectTag(selected);
    if (detailFor.current === tag) return;
    const request = ++detailRequest.current;
    setDetail(undefined);
    setDetailError("");
    void desktop.resources.get({
      contextId,
      resourceKind: kind,
      namespace: selected.namespace,
      name: selected.name,
    }).then((response) => {
      if (request !== detailRequest.current) return;
      detailFor.current = objectTag(response.row);
      setDetail(response);
    }).catch((cause) => request === detailRequest.current && setDetailError(messageOf(cause)));
  }, [contextId, kind, selected]);

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
    const request = ++detailRequest.current;
    setRefreshing(true);
    try {
      const response = await desktop.resources.get({
        contextId,
        resourceKind: kind,
        namespace: current.namespace,
        name: current.name,
      });
      if (request !== detailRequest.current) return;
      detailFor.current = objectTag(response.row);
      setDetail(response);
      setDetailError("");
      // Adopting the fresh row re-fires the fetch effect above; the tag guard
      // turns that into a no-op instead of a duplicate get.
      setSelected(response.row);
    } catch (cause) {
      if (request === detailRequest.current) setDetailError(messageOf(cause));
    } finally {
      if (request === detailRequest.current) setRefreshing(false);
    }
  }, [contextId, kind]);

  return { selected, detail, detailError, refreshing, select, clear, refetch };
}
