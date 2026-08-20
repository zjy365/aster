// SPDX-License-Identifier: Apache-2.0

/**
 * Progressive prefix search over a sorted namespace array.
 *
 * The core returns namespaces in etcd's lexical order, so the array stays
 * sorted and every keystroke is two binary searches — O(log n) — instead of a
 * linear scan. The match window is a constant slice, so rendering cost never
 * grows with the cluster size; the "N matches" hint comes from the exact
 * interval size. Candidates inside the window are ordered by (name length,
 * lexical) so a "ns-123456" query surfaces ns-123456, ns-1234560, ns-12345600
 * first instead of the lexical-first 100 (ns-1234560000…).
 *
 * This is the "progressive narrowing" strategy: a short prefix on a 200k
 * namespace cluster yields a huge interval → the palette shows a count hint
 * and no rows; as the user types, the interval shrinks and concrete rows
 * appear, and a complete name matches exactly.
 */

/** Above this match count the pickers show a hint instead of concrete rows. */
export const NAMESPACE_SHOW_ROW_LIMIT = 50;
/** Rows rendered under the hint cap (constant, independent of cluster size). */
export const NAMESPACE_ROW_WINDOW = 100;

export interface NamespaceMatch {
  /** Names that are shown, ordered (shortest-first then lexical). */
  shown: string[];
  /** Exact interval size; the picker's "N matches" hint. */
  total: number;
  /** True when total exceeds NAMESPACE_SHOW_ROW_LIMIT and rows were hidden. */
  narrowed: boolean;
}

/** lowerBound: first index whose element is >= needle (on a sorted array). */
function lowerBound(names: string[], needle: string): number {
  let lo = 0;
  let hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (names[mid] < needle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** All strings that start with prefix, in lexical order (the array is sorted). */
function prefixInterval(names: string[], prefix: string): { lo: number; hi: number } {
  const lo = lowerBound(names, prefix);
  // The upper bound is the first name that no longer starts with prefix:
  // prefix + "\uffff" is the last possible continuation in UTF-16 order.
  const hi = lowerBound(names, prefix + "\uffff");
  return { lo, hi };
}

/** Length-first, then lexical — the "shortest complete match" ordering. */
function byLengthThenLexical(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Searches `names` for everything starting with `query`. The array is sorted
 * lexically (etcd List order), so the common path is two binary searches —
 * O(log n) on a 200k cluster. A case-insensitive query on a mixed-case array
 * would break binary search, so when the interval comes back empty the search
 * falls back to a linear scan; correctness is cheap and the hot path stays
 * logarithmic.
 */
export function searchNamespaces(names: string[], query: string): NamespaceMatch {
  const prefix = query.trim().toLowerCase();
  if (!prefix) {
    return {
      shown: names.slice(0, NAMESPACE_ROW_WINDOW),
      total: names.length,
      narrowed: names.length > NAMESPACE_ROW_WINDOW,
    };
  }
  const { lo, hi } = prefixInterval(names, prefix);
  let total = hi - lo;
  let shown = names.slice(lo, hi);
  if (total === 0) {
    // Case-insensitive fallback: scan for names that start with the prefix.
    shown = names.filter((name) => name.toLowerCase().startsWith(prefix));
    total = shown.length;
  }
  if (total <= NAMESPACE_SHOW_ROW_LIMIT) {
    return { shown, total, narrowed: false };
  }
  // Big interval: a tiny lexical-first window would surface only the longest
  // names (ns-1234560000…); the shortest complete prefixes are more useful.
  const windowEnd = Math.min(lo + NAMESPACE_ROW_WINDOW, hi);
  const sorted = names.slice(lo, windowEnd).sort(byLengthThenLexical);
  return { shown: sorted, total, narrowed: true };
}
