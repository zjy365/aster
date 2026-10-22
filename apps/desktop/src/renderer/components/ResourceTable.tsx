import { Fragment, useEffect, useRef, useState, type CSSProperties, type ComponentType, type KeyboardEvent } from "react";
import { AlertCircle, Boxes, Check, LoaderCircle, Minus, type LucideProps } from "lucide-react";
import { Checkbox } from "@base-ui/react/checkbox";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResourceRow } from "../../shared/types";
import { cpuToMillicores, formatAge, formatCpuUsage, formatMemoryUsage, formatReady, memoryToBytes, usagePercent } from "../lib/format";
import type { TableColumn } from "../lib/table-columns";

type Icon = ComponentType<LucideProps>;

const ROW_HEIGHT = 36;

/**
 * Grid tracks of the pinned usage columns the Pod table gains while live
 * metrics are loaded (mirrors the pod-metrics-grid template segments).
 */
const METRICS_WIDTHS = ["minmax(64px, 0.7fr)", "minmax(80px, 0.9fr)"];

/** Where the pinned CPU/Memory columns slot into a custom column order. */
function metricsInsertIndex(columns: readonly TableColumn[]): number {
  // Today's fixed order is Name, Namespace, Status, CPU, Memory, Ready,
  // Age — usage columns follow Status when it is visible, else sit where
  // the namespace column would end.
  const status = columns.findIndex((column) => column.id === "status");
  if (status >= 0) return status + 1;
  return Math.min(2, columns.length);
}

function clusterInsertIndex(columns: readonly TableColumn[]): number {
  const name = columns.findIndex((column) => column.id === "name");
  return name < 0 ? 0 : name + 1;
}

/** The minimum width (px) a track's floor contributes, for scroll sizing. */
function trackMinWidth(track: string): number {
  const min = /minmax\((\d+(?:\.\d+)?)px/.exec(track) ?? /^(\d+(?:\.\d+)?)px$/.exec(track);
  return min ? Number(min[1]) : 0;
}

/**
 * The dynamic grid of a customized table: checkbox track plus one track per
 * visible column, with the pinned metrics tracks spliced in for the Pod
 * kind. Also yields the summed track floors: header and rows take it as a
 * min-width so the virtualized rows' boxes (not just their overflowing
 * cells) extend the viewport's scrollable width — that is what makes many
 * columns horizontally scrollable with the header in lockstep.
 */
function customGrid(columns: readonly TableColumn[], withMetrics: boolean, withCluster: boolean, withNodeMetrics: boolean): { template: string; minWidthPx: number } {
  const tracks: string[] = [];
  const metricsWidths = withNodeMetrics ? ["minmax(112px, 0.9fr)", "minmax(128px, 1fr)"] : METRICS_WIDTHS;
  const insertAt = withMetrics ? metricsInsertIndex(columns) : columns.length;
  columns.forEach((column, index) => {
    if (withCluster && index === clusterInsertIndex(columns)) tracks.push("minmax(100px, 0.8fr)");
    if (index === insertAt) tracks.push(...metricsWidths);
    tracks.push(column.width);
  });
  if (withCluster && clusterInsertIndex(columns) >= columns.length) tracks.push("minmax(100px, 0.8fr)");
  if (withMetrics && insertAt >= columns.length) tracks.push(...metricsWidths);
  const all = ["32px", ...tracks];
  return {
    template: all.join(" "),
    minWidthPx: all.reduce((total, track) => total + trackMinWidth(track), 0),
  };
}

/** Cell class per column: the name keeps its status dot, counts align. */
function customCellClass(column: TableColumn): string {
  if (column.id === "name") return "primary-cell";
  if (column.id === "ready" || column.id === "age") return "tabular cell-clip";
  return "cell-clip";
}

export function rowKey(row: ResourceRow): string {
  return row.uid || `${row.namespace}/${row.name}`;
}

/**
 * Identity of a pod's usage entry: namespace/name rather than uid, because
 * metrics.k8s.io responses carry no uid and the same pod name in two
 * selected namespaces must not trade usage rows.
 */
export function podUsageKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

export function ResourceTable({ rows, selected, checkedRows, onToggleRow, onToggleAll, hasMore, loadingMore, onLoadMore, loading, error, onSelect, podMetrics, nodeMetrics, columns, clusterLabel }: {
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
  /** Live CPU/memory totals keyed by namespace/name; present only for the Pod kind. */
  podMetrics?: ReadonlyMap<string, { cpu?: string; memory?: string }>;
  /**
   * Customized column set (visibility + order) from useResourceColumns.
   * Absent — or empty — the fixed default columns render exactly as before;
   * this prop is additive so the table stays usable unchanged.
   */
  columns?: readonly TableColumn[];
  /** Present in aggregate views; source identity stays visible with any column order. */
  clusterLabel?: (row: ResourceRow) => string;
  /** Live CPU/memory keyed by node name; present only for the Node kind. */
  nodeMetrics?: ReadonlyMap<string, { cpu?: string; memory?: string }>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  // A trailing "load more" row keeps server pagination reachable without a
  // permanent footer bar.
  const virtualizer = useVirtualizer({ count: rows.length + (hasMore ? 1 : 0), getScrollElement: () => viewport.current, estimateSize: () => ROW_HEIGHT, overscan: 8 });
  // Roving tabindex: one row owns tab stop; arrows move it, Enter opens.
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  // Custom mode: one template drives header and every row (CSS variable on
  // the frame), and the header tracks the viewport's horizontal scroll so
  // many columns keep header and cells aligned.
  const usageColumns = Boolean(podMetrics || nodeMetrics);
  const customColumns = columns && columns.length > 0 ? columns : null;
  const header = useRef<HTMLDivElement>(null);
  const grid = customColumns ? customGrid(customColumns, usageColumns, Boolean(clusterLabel), Boolean(nodeMetrics)) : null;
  const gridTemplate = grid?.template ?? "";
  const syncHeaderScroll = () => {
    if (header.current && viewport.current) {
      header.current.style.transform = `translateX(${-viewport.current.scrollLeft}px)`;
    }
  };
  useEffect(() => {
    if (header.current && viewport.current) {
      header.current.style.transform = `translateX(${-viewport.current.scrollLeft}px)`;
    }
  }, [gridTemplate]);

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
      style={grid ? ({ "--table-columns": grid.template, "--table-min-width": `${grid.minWidthPx}px` } as CSSProperties) : undefined}
    >
      <div
        ref={header}
        className={`table-header resource-grid ${usageColumns && !customColumns ? "pod-metrics-grid" : ""} ${customColumns ? "table-grid-custom" : clusterLabel ? "cluster-grid" : ""}`}
        role="row"
        aria-rowindex={1}
      >
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
        {customColumns ? (
          <>
            {customColumns.map((column, index) => (
              <Fragment key={column.id}>
                {clusterLabel && index === clusterInsertIndex(customColumns) && <span role="columnheader">Cluster</span>}
                {usageColumns && index === metricsInsertIndex(customColumns) ? (
                  <>
                    <span role="columnheader">CPU</span>
                    <span role="columnheader">Memory</span>
                  </>
                ) : null}
                <span role="columnheader" className="cell-clip">{column.label}</span>
              </Fragment>
            ))}
            {clusterLabel && clusterInsertIndex(customColumns) >= customColumns.length && <span role="columnheader">Cluster</span>}
            {usageColumns && metricsInsertIndex(customColumns) >= customColumns.length ? (
              <>
                <span role="columnheader">CPU</span>
                <span role="columnheader">Memory</span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span role="columnheader">Name</span>
            {clusterLabel && <span role="columnheader">Cluster</span>}
            <span role="columnheader">Namespace</span>
            <span role="columnheader">Status</span>
            {usageColumns && (
              <>
                <span role="columnheader">CPU</span>
                <span role="columnheader">Memory</span>
              </>
            )}
            <span role="columnheader">Ready</span>
            <span role="columnheader">Age</span>
          </>
        )}
      </div>
      <div ref={viewport} className="table-viewport" onScroll={customColumns ? syncHeaderScroll : undefined}>
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
            const usage = podMetrics?.get(podUsageKey(row.namespace, row.name));
            // Node usage reads capacity off the row itself, so the cell shows
            // pressure relative to allocatable, not just the absolute number.
            const nodeUsage = nodeMetrics?.get(row.name);
            const nodeCpu = nodeUsage?.cpu
              ? nodeUsageCell(nodeUsage.cpu, row.allocatableCpu, formatCpuUsage, cpuToMillicores)
              : undefined;
            const nodeMemory = nodeUsage?.memory
              ? nodeUsageCell(nodeUsage.memory, row.allocatableMemory, formatMemoryUsage, memoryToBytes)
              : undefined;
            return (
              <div
                role="row"
                aria-rowindex={virtualRow.index + 2}
                aria-selected={active}
                data-row-index={virtualRow.index}
                tabIndex={virtualRow.index === clampedFocus ? 0 : -1}
                className={`table-row resource-grid ${usageColumns && !customColumns ? "pod-metrics-grid" : ""} ${customColumns ? "table-grid-custom" : clusterLabel ? "cluster-grid" : ""} ${active ? "selected" : ""} ${checked ? "checked" : ""}`}
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
                {customColumns ? (
                  <>
                    {customColumns.map((column, index) => (
                      <Fragment key={column.id}>
                        {clusterLabel && index === clusterInsertIndex(customColumns) && <span role="gridcell" className="cluster-cell">{clusterLabel(row)}</span>}
                        {usageColumns && index === metricsInsertIndex(customColumns) ? (
                          <>
                            <span role="gridcell" className="tabular pod-usage-cell">
                              {nodeMetrics ? nodeCpu?.text ?? "—" : usage?.cpu ? formatCpuUsage(usage.cpu) : "—"}
                            </span>
                            <span role="gridcell" className="tabular pod-usage-cell">
                              {nodeMetrics ? nodeMemory?.text ?? "—" : usage?.memory ? formatMemoryUsage(usage.memory) : "—"}
                            </span>
                          </>
                        ) : null}
                        {column.id === "name" ? (
                          <span role="gridcell" className="primary-cell"><StatusDot status={row.status} />{column.value(row)}</span>
                        ) : (
                          <span role="gridcell" className={customCellClass(column)}>{column.value(row)}</span>
                        )}
                      </Fragment>
                    ))}
                    {clusterLabel && clusterInsertIndex(customColumns) >= customColumns.length && <span role="gridcell" className="cluster-cell">{clusterLabel(row)}</span>}
                    {usageColumns && metricsInsertIndex(customColumns) >= customColumns.length ? (
                      <>
                        <span role="gridcell" className="tabular pod-usage-cell">
                          {nodeMetrics ? nodeCpu?.text ?? "—" : usage?.cpu ? formatCpuUsage(usage.cpu) : "—"}
                        </span>
                        <span role="gridcell" className="tabular pod-usage-cell">
                          {nodeMetrics ? nodeMemory?.text ?? "—" : usage?.memory ? formatMemoryUsage(usage.memory) : "—"}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span role="gridcell" className="primary-cell"><StatusDot status={row.status} />{row.name}</span>
                    {clusterLabel && <span role="gridcell" className="cluster-cell">{clusterLabel(row)}</span>}
                    <span role="gridcell">{row.namespace || "Cluster-scoped"}</span>
                    <span role="gridcell">{row.status || "Unknown"}</span>
                    {usageColumns && (
                      <>
                        <span role="gridcell" className="tabular pod-usage-cell">
                          {nodeMetrics ? nodeCpu?.text ?? "—" : usage?.cpu ? formatCpuUsage(usage.cpu) : "—"}
                        </span>
                        <span role="gridcell" className="tabular pod-usage-cell">
                          {nodeMetrics ? nodeMemory?.text ?? "—" : usage?.memory ? formatMemoryUsage(usage.memory) : "—"}
                        </span>
                      </>
                    )}
                    <span role="gridcell" className="tabular">{formatReady(row)}</span>
                    <span role="gridcell" className="tabular">{formatAge(row.createdAt)}</span>
                  </>
                )}
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

/** Formats one node usage cell: the humanized value plus its share of the
 * node's allocatable capacity ("620m · 16%"), falling back to the bare value
 * when capacity is missing or unparsable. */
function nodeUsageCell(
  used: string,
  allocatable: string | undefined,
  format: (value: string) => string,
  toNumber: (value: string) => number | undefined,
): { text: string; title: string } {
  const formatted = format(used);
  const percent = usagePercent(toNumber(used), allocatable === undefined ? undefined : toNumber(allocatable));
  if (percent === undefined) {
    return { text: formatted, title: formatted };
  }
  const share = Math.round(percent);
  return {
    text: `${formatted} · ${share}%`,
    title: `${share}% of ${format(allocatable!)} allocatable`,
  };
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
