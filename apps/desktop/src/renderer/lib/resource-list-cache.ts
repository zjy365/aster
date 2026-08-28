import type { ResourceListResponse } from "../../shared/types";

/**
 * Session-scoped snapshots of recently viewed resource lists, keyed by view
 * (context, kind, namespace, selector). Revisiting a namespace renders the
 * last snapshot instantly while a fresh snapshot + watch runs behind it
 * (stale-while-revalidate), so A↔B switching skips the full-pane spinner.
 * Renderer memory only: no Go-side cache, no informers, nothing persists
 * across launches — the lazy, scoped-to-explicit-views boundary is kept.
 */
// The retained unit is a view (kind × namespace × selector), not a
// namespace: a plain A↔B switch across two kinds already holds 4 entries, so
// 8 covers roughly 2 namespaces × 4 kinds before eviction.
const MAX_ENTRIES = 8;

export function resourceListCacheKey(
  contextId: string,
  kindId: string,
  namespace: string,
  labelSelector?: string,
): string {
  return [contextId, kindId, namespace, labelSelector ?? ""].join("\n");
}

const snapshots = new Map<string, ResourceListResponse>();

export function readResourceListSnapshot(key: string): ResourceListResponse | undefined {
  const hit = snapshots.get(key);
  if (hit) {
    // Touch: reinsert so eviction drops the least recently revisited view.
    snapshots.delete(key);
    snapshots.set(key, hit);
  }
  return hit;
}

export function writeResourceListSnapshot(key: string, snapshot: ResourceListResponse): void {
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > MAX_ENTRIES) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}

/** Drops every retained snapshot. Called on context switch (and by tests). */
export function clearResourceListSnapshots(): void {
  snapshots.clear();
}
