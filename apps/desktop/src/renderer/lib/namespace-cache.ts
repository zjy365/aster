// SPDX-License-Identifier: Apache-2.0

/**
 * Session-scoped namespace lists, keyed by cluster (contextId).
 *
 * Kubernetes namespaces are effectively stable in a working session: they are
 * created and deleted rarely compared with how often an operator switches
 * between clusters. Re-fetching a 100k-namespace cluster's inventory is tens of
 * pages of API traffic every time the user comes back to it, so the renderer
 * keeps the last list per cluster in memory — stale-while-revalidate with a TTL
 * (see TTL_MS), the same shape kubernetes/dashboard uses for resource lists.
 *
 * Renderer memory only: no Go-side cache, no informers, nothing persists
 * across launches — the lazy, scoped-to-explicit-views boundary is kept.
 * Only the namespace names are retained; the shell never reads the other
 * NamespaceInfo fields, and keeping strings instead of objects is what keeps a
 * 100k-name cluster at tens of MB instead of hundreds.
 */
export const NAMESPACE_CACHE_TTL_MS = 30 * 60 * 1000;
/** Clusters a user actually toggles between are few; 4 covers A↔B↔C with room. */
export const NAMESPACE_CACHE_MAX_ENTRIES = 4;

export interface NamespaceCacheEntry {
  names: string[];
  truncated: boolean;
  fetchedAt: number;
}

const entries = new Map<string, NamespaceCacheEntry>();

function touch(key: string): void {
  const hit = entries.get(key);
  if (hit) {
    // Reinsert so eviction drops the least recently revisited cluster.
    entries.delete(key);
    entries.set(key, hit);
  }
}

/**
 * Returns the retained namespace names for a cluster if they exist and are
 * still fresh, and always touches the entry so a hot cluster survives
 * eviction. A stale entry is still returned (stale-while-revalidate); the
 * caller re-fetches in the background and the result replaces it.
 */
export function readNamespaceCache(contextId: string): NamespaceCacheEntry | undefined {
  const hit = entries.get(contextId);
  if (!hit) return undefined;
  touch(contextId);
  return hit;
}

export function writeNamespaceCache(
  contextId: string,
  names: string[],
  truncated: boolean,
): void {
  const entry: NamespaceCacheEntry = { names, truncated, fetchedAt: Date.now() };
  entries.delete(contextId);
  entries.set(contextId, entry);
  while (entries.size > NAMESPACE_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Test hook: drop every retained cluster list. */
export function clearNamespaceCache(): void {
  entries.clear();
}
