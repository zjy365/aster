// SPDX-License-Identifier: Apache-2.0

import type { ResourceListResponse, ResourceRow } from "../../shared/types";

/**
 * The namespace scope of a list view: an ordered set of selected namespace
 * names, where the empty array is the "All namespaces" cluster-wide scope.
 * Order is the user's selection order and drives merged-row grouping; the
 * canonical key (namespaceScopeKey) is order-insensitive and identifies the
 * scope wherever an identity is needed (snapshot cache, reset effects).
 * The wire format stays single-namespace: every fan-out request is an
 * ordinary one-namespace call.
 */

/** Bounds the per-namespace fan-out: worst case 32 list + 32 metrics requests per refresh. */
export const MAX_NAMESPACE_SELECTION = 32;

/** Sentinel continue token marking "some namespace in a multi scope has another page". */
export const MULTI_SCOPE_CONTINUE = "\u0000multi-scope";

export interface NamespaceToggle {
  scope: string[];
  /** False when adding would exceed MAX_NAMESPACE_SELECTION; scope is unchanged. */
  accepted: boolean;
}

/** Toggles one namespace in the selection; removing is always allowed. */
export function toggleNamespace(scope: string[], name: string): NamespaceToggle {
  if (scope.includes(name)) {
    return { scope: scope.filter((item) => item !== name), accepted: true };
  }
  if (scope.length >= MAX_NAMESPACE_SELECTION) {
    return { scope, accepted: false };
  }
  return { scope: [...scope, name], accepted: true };
}

/**
 * Order-insensitive identity of a scope: the sorted names joined with \u001f
 * (a character namespace names cannot contain), "" meaning All namespaces.
 * Used for snapshot-cache keys and reset effects, where [a, b] and [b, a]
 * are the same scope.
 */
export function namespaceScopeKey(scope: string[]): string {
  return [...scope].sort().join("\u001f");
}

/**
 * Trigger summary: "" for All, the name alone for one selection, two names
 * joined, and a "+N" overflow from three on so long names cannot push the
 * toolbar's search and actions out of reach.
 */
export function namespaceScopeSummary(scope: string[]): string {
  if (scope.length === 0) return "";
  if (scope.length <= 2) return scope.join(", ");
  return `${scope.slice(0, 2).join(", ")} +${scope.length - 2}`;
}

export interface MergedNamespacePages {
  /** Rows concatenated in selection order, one namespace after another. */
  items: ResourceRow[];
  /** True when any namespace still has a server page to load. */
  hasMore: boolean;
}

/**
 * Merges one snapshot page per selected namespace into the ordered view.
 * Missing pages (a namespace still loading or failed) contribute nothing
 * rather than stalling the merge.
 */
export function mergeNamespacePages(
  scope: string[],
  pages: Readonly<Record<string, ResourceListResponse | undefined>>,
): MergedNamespacePages {
  const items: ResourceRow[] = [];
  let hasMore = false;
  for (const namespace of scope) {
    const page = pages[namespace];
    if (!page) continue;
    items.push(...page.items);
    if (page.continueToken) hasMore = true;
  }
  return { items, hasMore };
}

/** Returns a new pages record with one namespace's next page appended. */
export function appendNamespacePage(
  pages: Readonly<Record<string, ResourceListResponse>>,
  namespace: string,
  response: ResourceListResponse,
): Record<string, ResourceListResponse> {
  const current = pages[namespace];
  return {
    ...pages,
    [namespace]: {
      ...response,
      items: [...(current?.items ?? []), ...response.items],
    },
  };
}
