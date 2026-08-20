import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResourceRow } from "../../shared/types";
import { formatAge, formatReady } from "../lib/format";
import { StatusDot } from "../components/ResourceTable";

const ROW_HEIGHT = 36;

export interface WorkloadPodsPanelProps {
  rows: ResourceRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  onLoadMore(): void;
  onOpen(pod: ResourceRow): void;
}

/**
 * The Pods tab of a workload detail: the same dense table language as the main
 * resource table (hairline rows, status dots, tabular numbers), scoped to the
 * workload's selector. Server pagination and virtual rendering match the main
 * table's contract even though workload pod counts are usually small.
 */
export function WorkloadPodsPanel({
  rows,
  loading,
  loadingMore,
  hasMore,
  error,
  onLoadMore,
  onOpen,
}: WorkloadPodsPanelProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length + (hasMore ? 1 : 0),
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div className="workload-pods" data-testid="workload-pods">
      <div className="workload-pods-header pod-grid" role="row">
        <span>Name</span>
        <span>Status</span>
        <span>Ready</span>
        <span>Age</span>
      </div>
      <div ref={viewport} className="workload-pods-viewport">
        {loading ? (
          <div className="resource-inline-state"><LoaderCircle className="spin" aria-hidden="true" />Loading pods…</div>
        ) : error ? (
          <div className="resource-inline-state resource-inline-error" role="alert">{error}</div>
        ) : rows.length === 0 ? (
          <div className="resource-inline-state">No pods match this workload's selector.</div>
        ) : (
          <div className="virtual-space" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              if (virtualRow.index >= rows.length) {
                return (
                  <div
                    className="workload-pods-row workload-pods-more"
                    key="__load-more__"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <button className="load-more" disabled={loadingMore} onClick={onLoadMore}>
                      {loadingMore && <LoaderCircle className="spin" size={14} />}
                      Load next 100
                    </button>
                  </div>
                );
              }
              const pod = rows[virtualRow.index];
              return (
                <button
                  type="button"
                  className="workload-pods-row pod-grid"
                  key={pod.uid || pod.name}
                  data-testid={`workload-pod-${pod.name}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                  onClick={() => onOpen(pod)}
                >
                  <span className="primary-cell"><StatusDot status={pod.status} />{pod.name}</span>
                  <span>{pod.status || "Unknown"}</span>
                  <span className="tabular">{formatReady(pod)}</span>
                  <span className="tabular">{formatAge(pod.createdAt)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
