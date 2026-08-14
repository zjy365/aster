import { useRef, type ComponentType } from "react";
import { AlertCircle, Boxes, LoaderCircle, type LucideProps } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResourceRow } from "../../shared/types";
import { formatAge, formatReady } from "../lib/format";

type Icon = ComponentType<LucideProps>;

export function ResourceTable({ rows, selected, loading, error, onSelect }: {
  rows: ResourceRow[];
  selected?: ResourceRow;
  loading: boolean;
  error: string;
  onSelect(row: ResourceRow): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => viewport.current, estimateSize: () => 38, overscan: 8 });

  if (loading) return <TableState icon={LoaderCircle} title="Loading resources" detail="Querying the active Kubernetes API server." spinning />;
  if (error) return <TableState icon={AlertCircle} title="Could not load resources" detail={error} tone="error" />;
  if (!rows.length) return <TableState icon={Boxes} title="No resources found" detail="Try another namespace, resource type, or search." />;

  return (
    <div className="table-frame">
      <div className="table-header resource-grid" role="row">
        <span>Name</span><span>Namespace</span><span>Status</span><span>Ready</span><span>Age</span>
      </div>
      <div ref={viewport} className="table-viewport">
        <div className="virtual-space" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const active = selected?.uid === row.uid;
            return (
              <button
                type="button"
                className={`table-row resource-grid ${active ? "selected" : ""}`}
                key={row.uid || `${row.namespace}/${row.name}`}
                onClick={() => onSelect(row)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <span className="primary-cell"><ResourceStatus status={row.status} />{row.name}</span>
                <span>{row.namespace || "Cluster"}</span>
                <span>{row.status || "Unknown"}</span>
                <span className="tabular">{formatReady(row)}</span>
                <span className="tabular">{formatAge(row.createdAt)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TableState({ icon: StateIcon, title, detail, tone, spinning }: { icon: Icon; title: string; detail: string; tone?: "error"; spinning?: boolean }) {
  return <div className={`table-state ${tone || ""}`}><StateIcon className={spinning ? "spin" : ""} size={22} /><strong>{title}</strong><p>{detail}</p></div>;
}

function ResourceStatus({ status }: { status?: string }) {
  const normalized = status?.toLowerCase() || "unknown";
  const tone = /ready|running|active|bound|complete|available|healthy/.test(normalized)
    ? "healthy"
    : /fail|error|crash|lost/.test(normalized)
      ? "failed"
      : /pending|progress|terminat|unknown/.test(normalized) ? "warning" : "neutral";
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}
