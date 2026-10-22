// SPDX-License-Identifier: Apache-2.0

import type { ResourceRow } from "../../shared/types";
import { formatAge, formatReady } from "./format";

/**
 * User-configurable table columns, per resource kind. The wire rows already
 * carry more fields than the fixed table shows (the core projects a flat
 * summary per object); this module turns that row JSON into a column model:
 * the built-in fixed set, a small curated registry of commonly-wanted
 * fields, and cheap client-side discovery of extra scalar fields (including
 * nested spec/status paths) from the currently loaded rows only. Preferences
 * (visibility + order) are just ordered id lists — see
 * table-column-preferences.ts.
 */

/** Where a column definition comes from; drives picker grouping/labels. */
export type TableColumnSource = "builtin" | "curated" | "discovered";

export interface TableColumn {
  /** Stable identity persisted in preferences ("status", "spec.replicas"). */
  id: string;
  /** Header and picker label. */
  label: string;
  /** Grid track hint for the dynamic column template. */
  width: string;
  source: TableColumnSource;
  /** Cell text; missing values render empty, never throw. */
  value(row: ResourceRow): string;
}

/** Today's fixed column set, in order — the per-kind default. */
export const DEFAULT_COLUMN_IDS: readonly string[] = ["name", "namespace", "status", "ready", "age"];

const BUILTIN_COLUMNS: TableColumn[] = [
  {
    id: "name",
    label: "Name",
    width: "minmax(180px, 2fr)",
    source: "builtin",
    value: (row) => row.name,
  },
  {
    id: "namespace",
    label: "Namespace",
    width: "minmax(110px, 1.15fr)",
    source: "builtin",
    value: (row) => row.namespace || "Cluster-scoped",
  },
  {
    id: "status",
    label: "Status",
    width: "minmax(100px, 1fr)",
    source: "builtin",
    value: (row) => row.status || "Unknown",
  },
  {
    id: "ready",
    label: "Ready",
    width: "minmax(64px, 0.7fr)",
    source: "builtin",
    value: (row) => formatReady(row),
  },
  {
    id: "age",
    label: "Age",
    width: "minmax(56px, 0.6fr)",
    source: "builtin",
    value: (row) => formatAge(row.createdAt),
  },
];

/** Trims a scalar so one huge string cannot blow up a cell. */
function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Joins list-ish fields compactly: first items then "+N more". */
function joinCapped(values: readonly string[], max = 3): string {
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max} more`;
}

/** Labels rendered as sorted k=v pairs so the text is stable across rows. */
function labelsText(labels: Record<string, string> | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return clip(keys.slice(0, 4).map((key) => `${key}=${labels[key]}`).join(" ") + (keys.length > 4 ? ` +${keys.length - 4} more` : ""));
}

function numberText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function ageText(value: string | undefined): string {
  return value ? formatAge(value) : "";
}

/**
 * Curated extra columns: fields the core already projects but the fixed
 * table never showed. Offered for a kind when at least one loaded row has a
 * value, so the picker stays honest about what the list can actually show.
 */
const CURATED_COLUMNS: readonly TableColumn[] = [
  { id: "images", label: "Images", width: "minmax(150px, 1.3fr)", source: "curated", value: (row) => clip(row.images && row.images.length > 0 ? joinCapped(row.images) : "") },
  { id: "labels", label: "Labels", width: "minmax(170px, 1.5fr)", source: "curated", value: (row) => labelsText(row.labels) },
  { id: "type", label: "Type", width: "minmax(90px, 0.8fr)", source: "curated", value: (row) => row.type || "" },
  { id: "addresses", label: "Addresses", width: "minmax(130px, 1.1fr)", source: "curated", value: (row) => clip(row.addresses && row.addresses.length > 0 ? joinCapped(row.addresses) : "") },
  { id: "ports", label: "Ports", width: "minmax(110px, 1fr)", source: "curated", value: (row) => clip(row.ports && row.ports.length > 0 ? joinCapped(row.ports, 6) : "") },
  { id: "version", label: "Version", width: "minmax(100px, 0.9fr)", source: "curated", value: (row) => row.version || "" },
  { id: "reason", label: "Reason", width: "minmax(110px, 1fr)", source: "curated", value: (row) => row.reason || "" },
  { id: "message", label: "Message", width: "minmax(200px, 1.8fr)", source: "curated", value: (row) => clip(row.message || "") },
  { id: "involvedObject", label: "Object", width: "minmax(130px, 1.1fr)", source: "curated", value: (row) => row.involvedObject || "" },
  { id: "count", label: "Count", width: "minmax(56px, 0.6fr)", source: "curated", value: (row) => numberText(row.count) },
  { id: "lastTimestamp", label: "Last Seen", width: "minmax(56px, 0.6fr)", source: "curated", value: (row) => ageText(row.lastTimestamp) },
  { id: "dataKeys", label: "Data", width: "minmax(130px, 1.1fr)", source: "curated", value: (row) => clip(row.dataKeys && row.dataKeys.length > 0 ? joinCapped(row.dataKeys, 6) : "") },
  { id: "rules", label: "Rules", width: "minmax(150px, 1.3fr)", source: "curated", value: (row) => clip(row.rules && row.rules.length > 0 ? joinCapped(row.rules) : "") },
  { id: "roleRef", label: "Role Ref", width: "minmax(110px, 1fr)", source: "curated", value: (row) => row.roleRef || "" },
  { id: "subjects", label: "Subjects", width: "minmax(130px, 1.1fr)", source: "curated", value: (row) => clip(row.subjects && row.subjects.length > 0 ? joinCapped(row.subjects) : "") },
  { id: "related", label: "Owners", width: "minmax(140px, 1.2fr)", source: "curated", value: (row) => clip(row.related && row.related.length > 0 ? joinCapped(row.related) : "") },
  { id: "desired", label: "Desired", width: "minmax(60px, 0.65fr)", source: "curated", value: (row) => numberText(row.desired) },
  { id: "available", label: "Available", width: "minmax(70px, 0.75fr)", source: "curated", value: (row) => numberText(row.available) },
  { id: "updated", label: "Updated", width: "minmax(64px, 0.7fr)", source: "curated", value: (row) => numberText(row.updated) },
  { id: "apiVersion", label: "API Version", width: "minmax(110px, 0.95fr)", source: "curated", value: (row) => row.apiVersion || "" },
  { id: "resourceVersion", label: "RV", width: "minmax(72px, 0.7fr)", source: "curated", value: (row) => row.resourceVersion || "" },
];

/** Kinds whose rows carry a known useful field the fixed table hides. */
const CURATED_BY_KIND: Record<string, readonly string[]> = {
  pods: ["images"],
  deployments: ["images"],
  statefulsets: ["images"],
  daemonsets: ["images"],
  jobs: ["images"],
  cronjobs: ["images"],
  services: ["type", "addresses", "ports"],
  ingresses: ["type", "addresses"],
  nodes: ["version", "addresses"],
  configmaps: ["dataKeys"],
  secrets: ["type", "dataKeys"],
  roles: ["rules"],
  clusterroles: ["rules"],
  rolebindings: ["roleRef", "subjects"],
  clusterrolebindings: ["roleRef", "subjects"],
};

/** Offered for every kind (custom resources included). */
const GENERIC_CURATED: readonly string[] = ["labels", "apiVersion"];

const CURATED_BY_ID = new Map(CURATED_COLUMNS.map((column) => [column.id, column]));

/** Discovery bounds: cheap by construction — loaded rows only, capped hard. */
export const DISCOVERY_ROW_LIMIT = 100;
export const DISCOVERY_COLUMN_CAP = 10;
/** Strings longer than this are prose, not column material. */
const DISCOVERY_MAX_TEXT = 128;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Scalar cell material only: short strings, numbers, booleans. */
function isScalarValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return typeof value === "string" && value.trim().length > 0 && value.length <= DISCOVERY_MAX_TEXT;
}

function scalarText(value: unknown): string {
  return isScalarValue(value) ? String(value) : "";
}

/** Reads a dotted path ("status.phase") off a row; missing → "". */
function pathValue(row: ResourceRow, path: string): string {
  let current: unknown = row;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) return "";
    current = current[segment];
  }
  return scalarText(current);
}

/**
 * Extra scalar field ids found in the loaded rows, best frequency first,
 * capped at DISCOVERY_COLUMN_CAP. Scans the first DISCOVERY_ROW_LIMIT rows'
 * own top-level keys plus one level into spec/status objects — exactly the
 * shape a CRD's spec/status carries — and skips every id the built-in and
 * curated sets already cover.
 */
export function discoverColumnIds(
  rows: readonly ResourceRow[],
  known: ReadonlySet<string>,
  cap: number = DISCOVERY_COLUMN_CAP,
): string[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const tally = (id: string, value: unknown) => {
    if (known.has(id) || seen.has(id)) return;
    if (!isScalarValue(value)) return;
    seen.add(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const row of rows.slice(0, DISCOVERY_ROW_LIMIT)) {
    seen.clear();
    const record = row as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      tally(key, value);
    }
    for (const section of ["spec", "status"]) {
      const nested = record[section];
      if (!isPlainObject(nested)) continue;
      for (const [key, value] of Object.entries(nested)) {
        tally(`${section}.${key}`, value);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, cap)
    .map(([id]) => id);
}

const DISCOVERED_WIDTH = "minmax(110px, 1fr)";

/** A discovered column reads its own (dotted) id as a path off each row. */
function discoveredColumn(id: string): TableColumn {
  return {
    id,
    label: id,
    width: DISCOVERED_WIDTH,
    source: "discovered",
    value: (row) => clip(pathValue(row, id)),
  };
}

/** True when at least one sampled row would render a non-empty cell. */
function columnHasData(column: TableColumn, rows: readonly ResourceRow[]): boolean {
  const sample = rows.slice(0, DISCOVERY_ROW_LIMIT);
  return sample.some((row) => column.value(row) !== "");
}

/** Row keys that are already covered (built-ins + curated + bookkeeping). */
const KNOWN_ROW_KEYS = new Set([
  ...DEFAULT_COLUMN_IDS,
  ...CURATED_COLUMNS.map((column) => column.id),
  "uid",
  "kind",
  "createdAt",
  "deleting",
]);

/**
 * Every column the picker may offer for this kind right now: the built-in
 * set, the kind's curated fields that loaded rows actually carry, generic
 * curated fields with data, and discovered extras (capped). Canonical order
 * for anything not yet positioned by the user.
 */
export function availableColumns(kindId: string, rows: readonly ResourceRow[]): TableColumn[] {
  const columns: TableColumn[] = [...BUILTIN_COLUMNS];
  const pushWith = (id: string) => {
    const column = CURATED_BY_ID.get(id);
    if (column && !columns.some((existing) => existing.id === id) && columnHasData(column, rows)) {
      columns.push(column);
    }
  };
  for (const id of CURATED_BY_KIND[kindId] ?? []) pushWith(id);
  for (const id of GENERIC_CURATED) pushWith(id);
  // Discovery skips every registry id — including curated fields this kind
  // does not offer — so a suggestion can never duplicate a known column.
  for (const id of discoverColumnIds(rows, KNOWN_ROW_KEYS)) columns.push(discoveredColumn(id));
  return columns;
}

export interface ResolvedColumns {
  /** Ordered columns to render. */
  visible: TableColumn[];
  /** Offered but currently hidden, in canonical order. */
  hidden: TableColumn[];
  /** True when a stored order is in effect for this kind. */
  customized: boolean;
}

/**
 * Applies the persisted order to the available set: unknown ids (fields the
 * current rows no longer carry) drop out silently, and a stored order that
 * matches nothing falls back to the default set so the table never renders
 * empty. No stored order → the built-in default.
 */
export function resolveColumns(
  kindId: string,
  rows: readonly ResourceRow[],
  storedOrder: readonly string[] | undefined,
): ResolvedColumns {
  const available = availableColumns(kindId, rows);
  if (!storedOrder || storedOrder.length === 0) {
    return {
      visible: available.filter((column) => column.source === "builtin"),
      hidden: available.filter((column) => column.source !== "builtin"),
      customized: false,
    };
  }
  const byId = new Map(available.map((column) => [column.id, column]));
  const ordered = storedOrder
    .map((id) => byId.get(id))
    .filter((column): column is TableColumn => Boolean(column));
  const chosen = ordered.length > 0 ? ordered : available.filter((column) => column.source === "builtin");
  const chosenIds = new Set(chosen.map((column) => column.id));
  return {
    visible: chosen,
    hidden: available.filter((column) => !chosenIds.has(column.id)),
    customized: ordered.length > 0,
  };
}
