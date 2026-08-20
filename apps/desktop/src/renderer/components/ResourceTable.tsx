import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { AlertCircle, Boxes, Check, LoaderCircle, Minus, type LucideProps } from "lucide-react";
import { Checkbox } from "@base-ui/react/checkbox";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResourceRow } from "../../shared/types";
import { formatAge, formatReady } from "../lib/format";

type Icon = ComponentType<LucideProps>;

const ROW_HEIGHT = 36;

export function rowKey(row: ResourceRow): string {
  return row.uid || `${row.namespace}/${row.name}`;
}

export function ResourceTable({ rows, selected, checkedRows, onToggleRow, onToggleAll, hasMore, loadingMore, onLoadMore, loading, error, onSelect }: {
  rows: ResourceRow[];
  selected?: ResourceRow;
  checkedRows: ReadonlySet<string>;
  onToggleRow(row: ResourceRow): void;
  onToggleAll(): void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore(): void;
  loading: boolean;
  error: string;
  onSelect(row: ResourceRow): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  // A trailing "load more" row keeps server pagination reachable without a
  // permanent footer bar.
  const virtualizer = useVirtualizer({ count: rows.length + (hasMore ? 1 : 0), getScrollElement: () => viewport.current, estimateSize: () => ROW_HEIGHT, overscan: 8 });
  // Roving tabindex: one row owns tab stop; arrows move it, Enter opens.
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);

  const clampedFocus = rows.length ? Math.min(focusIndex, rows.length - 1) : 0;
  const allChecked = rows.length > 0 && rows.every((row) => checkedRows.has(rowKey(row)));
  const someChecked = !allChecked && rows.some((row) => checkedRows.has(rowKey(row)));

  useEffect(() => {
    if (pendingFocus.current === null) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    viewport.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
  });

  if (loading) return <TableState icon={LoaderCircle} title="Loading resources" detail="Querying the active Kubernetes API server." spinning />;
  if (error) return <TableState icon={AlertCircle} title="Could not load resources" detail={error} tone="error" />;
  if (!rows.length) return <TableState icon={Boxes} title="No resources found" detail="Try another namespace, resource type, or search." />;

  const moveFocus = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    pendingFocus.current = next;
    setFocusIndex(next);
    virtualizer.scrollToIndex(next);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A focused checkbox owns Space itself; the grid only borrows it on rows.
    const onCheckbox = (event.target as HTMLElement).getAttribute("role") === "checkbox";
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(clampedFocus + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(clampedFocus - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(rows.length - 1);
        break;
      case " ":
        if (onCheckbox) return;
        event.preventDefault();
        if (rows[clampedFocus]) onToggleRow(rows[clampedFocus]);
        break;
      case "Enter":
        event.preventDefault();
        onSelect(rows[clampedFocus]);
        break;
    }
  };

  return (
    <div
      className="table-frame"
      role="grid"
      aria-label="Resources"
      aria-rowcount={rows.length + 1}
      onKeyDown={onGridKeyDown}
    >
      <div className="table-header resource-grid" role="row" aria-rowindex={1}>
        <span role="columnheader" className="checkbox-cell">
          <Checkbox.Root
            aria-label="Select all loaded resources"
            checked={allChecked}
            indeterminate={someChecked}
            onCheckedChange={() => onToggleAll()}
            className="row-checkbox"
            data-testid="select-all-rows"
          >
            <Checkbox.Indicator className="row-checkbox-indicator">
              {someChecked ? <Minus aria-hidden="true" /> : <Check aria-hidden="true" />}
            </Checkbox.Indicator>
          </Checkbox.Root>
        </span>
        <span role="columnheader">Name</span>
        <span role="columnheader">Namespace</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Ready</span>
        <span role="columnheader">Age</span>
      </div>
      <div ref={viewport} className="table-viewport">
        <div className="virtual-space" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            if (virtualRow.index >= rows.length) {
              return (
                <div
                  role="row"
                  aria-rowindex={virtualRow.index + 2}
                  className="table-row table-load-more"
                  key="__load-more__"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button className="load-more" data-testid="load-more" disabled={loadingMore} onClick={() => onLoadMore()}>
                    {loadingMore && <LoaderCircle className="spin" size={14} />}
                    Load next 100
                  </button>
                </div>
              );
            }
            const row = rows[virtualRow.index];
            const active = selected?.uid === row.uid;
            const checked = checkedRows.has(rowKey(row));
            return (
              <div
                role="row"
                aria-rowindex={virtualRow.index + 2}
                aria-selected={active}
                data-row-index={virtualRow.index}
                tabIndex={virtualRow.index === clampedFocus ? 0 : -1}
                className={`table-row resource-grid ${active ? "selected" : ""} ${checked ? "checked" : ""}`}
                key={rowKey(row)}
                onClick={() => {
                  setFocusIndex(virtualRow.index);
                  onSelect(row);
                }}
                onFocus={() => setFocusIndex(virtualRow.index)}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <span role="gridcell" className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
                  <Checkbox.Root
                    aria-label={`Select ${row.name}`}
                    checked={checked}
                    onCheckedChange={() => onToggleRow(row)}
                    className="row-checkbox"
                    tabIndex={-1}
                    data-testid={`select-row-${row.name}`}
                  >
                    <Checkbox.Indicator className="row-checkbox-indicator">
                      <Check aria-hidden="true" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                </span>
                <span role="gridcell" className="primary-cell"><StatusDot status={row.status} />{row.name}</span>
                <span role="gridcell">{row.namespace || "Cluster-scoped"}</span>
                <span role="gridcell">{row.status || "Unknown"}</span>
                <span role="gridcell" className="tabular">{formatReady(row)}</span>
                <span role="gridcell" className="tabular">{formatAge(row.createdAt)}</span>
              </div>
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

export function StatusDot({ status }: { status?: string }) {
  const normalized = status?.toLowerCase() || "unknown";
  const tone = /ready|running|active|bound|complete|available|healthy/.test(normalized)
    ? "healthy"
    : /fail|error|crash|lost/.test(normalized)
      ? "failed"
      : /pending|progress|terminat/.test(normalized) ? "warning" : "neutral";
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}
