// SPDX-License-Identifier: Apache-2.0

/**
 * Persistence for user-configurable table columns: one ordered list of
 * visible column ids per resource kind, stored in localStorage like the
 * other renderer-side UI preferences (sidebar folds, favorites). Cluster
 * data never crosses into this store; unknown kinds simply have no entry
 * and resolve to the default column set.
 */

import { DEFAULT_COLUMN_IDS } from "./table-columns";

export const TABLE_COLUMNS_STORAGE_KEY = "aster.table.columns";

/** kind id → ordered ids of the visible columns. */
export type TableColumnPrefs = Record<string, string[]>;

/**
 * Validates a stored payload: an object whose values are non-empty arrays
 * of strings. Corrupt or foreign payloads degrade to empty preferences;
 * empty arrays are dropped (a kind with no columns is the default, not a
 * preference).
 */
export function parseTableColumnPrefs(stored: unknown): TableColumnPrefs {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const prefs: TableColumnPrefs = {};
  for (const [kindId, order] of Object.entries(stored as Record<string, unknown>)) {
    // A literal "__proto__" key must not leak into the prototype.
    if (kindId === "__proto__") continue;
    if (!Array.isArray(order)) continue;
    const ids = order.filter((id): id is string => typeof id === "string");
    if (ids.length === 0) continue;
    prefs[kindId] = normalizeColumnOrder(ids);
  }
  return prefs;
}

/** Deduplicates while keeping first-seen order. */
export function normalizeColumnOrder(order: readonly string[]): string[] {
  return [...new Set(order)];
}

export function loadTableColumnPrefs(): TableColumnPrefs {
  try {
    return parseTableColumnPrefs(JSON.parse(localStorage.getItem(TABLE_COLUMNS_STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

export function saveTableColumnPrefs(prefs: TableColumnPrefs): void {
  try {
    localStorage.setItem(TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or unavailable: the in-memory preference still applies
    // for this session.
  }
}

/** The stored order for one kind; undefined means "use the default set". */
export function columnOrderFor(prefs: TableColumnPrefs, kindId: string): string[] | undefined {
  return prefs[kindId];
}

/** Sets one kind's order; an empty order removes the kind (reset to default). */
export function withColumnOrder(prefs: TableColumnPrefs, kindId: string, order: readonly string[]): TableColumnPrefs {
  const ids = normalizeColumnOrder(order.filter((id) => typeof id === "string"));
  if (ids.length === 0) return withoutColumnOrder(prefs, kindId);
  return { ...prefs, [kindId]: ids };
}

/** "Reset to default": the kind's entry is dropped entirely. */
export function withoutColumnOrder(prefs: TableColumnPrefs, kindId: string): TableColumnPrefs {
  if (!(kindId in prefs)) return prefs;
  const next = { ...prefs };
  delete next[kindId];
  return next;
}

/**
 * The order a kind should render with: the stored preference when present,
 * otherwise (unknown kind, never customized, reset) the default column set.
 */
export function effectiveColumnOrder(prefs: TableColumnPrefs, kindId: string): string[] {
  return columnOrderFor(prefs, kindId) ?? [...DEFAULT_COLUMN_IDS];
}
