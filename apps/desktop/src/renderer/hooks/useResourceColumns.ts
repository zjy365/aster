// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useState } from "react";
import type { ResourceKind, ResourceRow } from "../../shared/types";
import { resolveColumns, DEFAULT_COLUMN_IDS, type TableColumn } from "../lib/table-columns";
import {
  columnOrderFor,
  loadTableColumnPrefs,
  saveTableColumnPrefs,
  withColumnOrder,
  withoutColumnOrder,
} from "../lib/table-column-preferences";

/**
 * Owns the configurable table columns of the active resource kind: derives
 * the available/visible sets from the loaded rows (see table-columns.ts)
 * and persists visibility + order per kind in localStorage. Column data
 * comes from the rows the list already carries — no extra requests.
 */
export function useResourceColumns(kind: ResourceKind, rows: readonly ResourceRow[]) {
  const [prefs, setPrefs] = useState(loadTableColumnPrefs);

  const { visible, hidden, customized } = useMemo(
    () => resolveColumns(kind.id, rows, columnOrderFor(prefs, kind.id)),
    [kind.id, rows, prefs],
  );

  /** Toggles one column's visibility; the last visible column stays on. */
  const toggleColumn = useCallback((id: string) => {
    setPrefs((current) => {
      // An uncustomized kind starts from the default set, not from nothing,
      // so the first toggle does not blank the table.
      const order = columnOrderFor(current, kind.id) ?? [...DEFAULT_COLUMN_IDS];
      const next = order.includes(id)
        ? order.filter((item) => item !== id)
        : [...order, id];
      if (next.length === 0) return current;
      const updated = withColumnOrder(current, kind.id, next);
      saveTableColumnPrefs(updated);
      return updated;
    });
  }, [kind.id]);

  /** Moves one visible column by delta positions, clamped to the ends. */
  const moveColumn = useCallback((id: string, delta: number) => {
    setPrefs((current) => {
      const order = [...(columnOrderFor(current, kind.id) ?? [...DEFAULT_COLUMN_IDS])];
      const from = order.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= order.length) return current;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      const updated = withColumnOrder(current, kind.id, order);
      saveTableColumnPrefs(updated);
      return updated;
    });
  }, [kind.id]);

  /** Reset to default for this kind: the stored entry is dropped. */
  const resetColumns = useCallback(() => {
    setPrefs((current) => {
      const next = withoutColumnOrder(current, kind.id);
      saveTableColumnPrefs(next);
      return next;
    });
  }, [kind.id]);

  return {
    visible: visible as readonly TableColumn[],
    hidden: hidden as readonly TableColumn[],
    customized,
    toggleColumn,
    moveColumn,
    resetColumns,
  };
}
