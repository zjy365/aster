// SPDX-License-Identifier: Apache-2.0

/**
 * Sidebar quick-access bookkeeping: the kinds the operator stars (Favorites)
 * and the kinds they actually open (Most used). Both are renderer-side UI
 * preferences persisted in localStorage like the sidebar fold prefs — no
 * cluster data, no shell involvement.
 */

/** Toggles one kind in the starred list; order is the starring order. */
export function toggleFavoriteKind(favorites: string[], id: string): string[] {
  return favorites.includes(id)
    ? favorites.filter((item) => item !== id)
    : [...favorites, id];
}

/** Bumps one kind's open counter. */
export function recordKindUsage(
  usage: Record<string, number>,
  id: string,
): Record<string, number> {
  return { ...usage, [id]: (usage[id] ?? 0) + 1 };
}

/**
 * The most-opened kinds, best first, capped and with already-starred kinds
 * filtered out (a Favorited kind needs no second entry pointing at it).
 * Ties resolve to the lexicographically smaller id so the list is stable
 * across restarts.
 */
export function mostUsedKindIds(
  usage: Record<string, number>,
  exclude: ReadonlySet<string>,
  limit: number,
): string[] {
  return Object.entries(usage)
    .filter(([id, count]) => count > 0 && !exclude.has(id))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id);
}
