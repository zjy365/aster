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
  select(row: ResourceRow): void;
  clear(): void;
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
  const detailRequest = useRef(0);

  useEffect(() => {
    ++detailRequest.current;
    setSelected(undefined);
    setDetail(undefined);
    setDetailError("");
  }, [contextId, kind, namespace, generation]);

  useEffect(() => {
    if (!selected) return;
    const next = items.find((row) => (row.uid || `${row.kind}:${row.namespace}/${row.name}`)
      === (selected.uid || `${selected.kind}:${selected.namespace}/${selected.name}`));
    if (!next) {
      setSelected(undefined);
      setDetail(undefined);
    } else if (next.resourceVersion !== selected.resourceVersion) {
      setSelected(next);
    }
  }, [items, selected]);

  useEffect(() => {
    if (!selected || !contextId) return;
    const request = ++detailRequest.current;
    setDetail(undefined);
    setDetailError("");
    void desktop.resources.get({
      contextId,
      resourceKind: kind,
      namespace: selected.namespace,
      name: selected.name,
    }).then((response) => {
      if (request === detailRequest.current) setDetail(response);
    }).catch((cause) => request === detailRequest.current && setDetailError(messageOf(cause)));
  }, [contextId, kind, selected]);

  const select = useCallback((row: ResourceRow) => setSelected(row), []);
  const clear = useCallback(() => {
    setSelected(undefined);
    setDetail(undefined);
    setDetailError("");
  }, []);

  return { selected, detail, detailError, select, clear };
}
