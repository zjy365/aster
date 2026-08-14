// SPDX-License-Identifier: Apache-2.0
import type { AppearanceTheme, ContextInfo, NamespaceInfo, RelatedResource } from "../../shared/types";

export type PaletteGroupId = "search" | "actions" | "contexts" | "resources" | "namespaces" | "appearance";

export type CommandAction =
  | { type: "refresh" }
  | { type: "show-contexts" }
  | { type: "connect-context"; contextId: string }
  | { type: "select-kind"; kindId: string }
  | { type: "select-namespace"; namespace: string }
  | { type: "set-theme"; theme: AppearanceTheme }
  | { type: "open-resource"; group: string; version: string; resource: string; name: string; namespace?: string };

export interface CommandItem {
  id: string;
  group: PaletteGroupId;
  label: string;
  hint?: string;
  keywords: string[];
  disabled?: boolean;
  current?: boolean;
  action: CommandAction;
}

export interface CommandGroup {
  id: PaletteGroupId;
  heading: string;
  items: CommandItem[];
}

export interface PaletteResourceGroup {
  label: string;
  items: {
    id: string;
    kind: string;
    category: string;
    label?: string;
    enabled?: boolean;
  }[];
}

export interface CommandPaletteState {
  coreReady: boolean;
  contexts: ContextInfo[];
  activeContextId: string;
  resourceGroups: PaletteResourceGroup[];
  activeKindId: string;
  namespaces: NamespaceInfo[];
  activeNamespace: string;
  theme: AppearanceTheme;
}

const GROUP_ORDER: { id: PaletteGroupId; heading: string }[] = [
  { id: "search", heading: "Search results" },
  { id: "actions", heading: "Actions" },
  { id: "contexts", heading: "Contexts" },
  { id: "resources", heading: "Resources" },
  { id: "namespaces", heading: "Namespaces" },
  { id: "appearance", heading: "Appearance" },
];

/**
 * Pure command construction for the ⌘K palette: which commands exist and how
 * they are grouped is derived here so it can be tested without rendering.
 * Matching stays in commandFilter; execution stays in the composition root.
 */
export function buildCommandItems(state: CommandPaletteState): CommandItem[] {
  const items: CommandItem[] = [
    {
      id: "action:refresh",
      group: "actions",
      label: "Refresh resource list",
      keywords: ["reload", "refetch", "update"],
      disabled: !state.coreReady,
      action: { type: "refresh" },
    },
    {
      id: "action:choose-cluster",
      group: "actions",
      label: "Choose cluster…",
      keywords: ["context", "picker", "switch", "back"],
      action: { type: "show-contexts" },
    },
  ];

  for (const context of state.contexts) {
    items.push({
      id: `context:${context.id}`,
      group: "contexts",
      label: context.name,
      hint: context.cluster || undefined,
      keywords: ["context", "cluster", "switch", context.name, context.cluster],
      disabled: Boolean(context.error) || !state.coreReady,
      current: context.id === state.activeContextId,
      action: { type: "connect-context", contextId: context.id },
    });
  }

  for (const group of state.resourceGroups) {
    for (const item of group.items) {
      if (item.enabled === false) continue;
      items.push({
        id: `kind:${item.id}`,
        group: "resources",
        label: item.label || item.kind,
        hint: group.label,
        keywords: [item.kind, item.id, "resource", group.label],
        current: item.id === state.activeKindId,
        action: { type: "select-kind", kindId: item.id },
      });
    }
  }

  items.push({
    id: "namespace:all",
    group: "namespaces",
    label: "All namespaces",
    keywords: ["namespace", "all", "clear"],
    current: state.activeNamespace === "",
    action: { type: "select-namespace", namespace: "" },
  });
  for (const namespace of state.namespaces) {
    items.push({
      id: `namespace:${namespace.name}`,
      group: "namespaces",
      label: namespace.name,
      keywords: ["namespace", namespace.name],
      current: namespace.name === state.activeNamespace,
      action: { type: "select-namespace", namespace: namespace.name },
    });
  }

  for (const theme of ["system", "light", "dark"] as const) {
    items.push({
      id: `theme:${theme}`,
      group: "appearance",
      label: `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`,
      keywords: ["theme", "appearance", theme, theme === "dark" ? "mode" : ""],
      current: state.theme === theme,
      action: { type: "set-theme", theme },
    });
  }

  return items;
}

/**
 * Maps server search results into palette items. The query is included in the
 * keywords so the shared commandFilter keeps these pre-matched rows visible.
 */
export function searchResultItems(results: RelatedResource[], query: string): CommandItem[] {
  return results.map((result) => ({
    id: `search:${result.group}/${result.version}/${result.resource}:${result.namespace || ""}/${result.name}`,
    group: "search",
    label: result.name,
    hint: `${result.kind}${result.namespace ? ` · ${result.namespace}` : ""}`,
    keywords: [result.name, result.kind, query],
    action: {
      type: "open-resource",
      group: result.group,
      version: result.version,
      resource: result.resource,
      name: result.name,
      namespace: result.namespace,
    },
  }));
}

export function groupCommandItems(items: CommandItem[]): CommandGroup[] {  return GROUP_ORDER
    .map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length > 0);
}

function scoreCandidate(candidate: string, search: string): number {
  const value = candidate.trim().toLowerCase();
  if (!value) return 0;
  if (value === search) return 1;
  if (value.startsWith(search)) return 0.9;
  if (value.includes(search)) return 0.6;
  return 0;
}

/**
 * cmdk filter callback: ranks an item by its best keyword. A score of 0 hides
 * the item; an empty search keeps everything visible in group order.
 */
export function commandFilter(value: string, search: string, keywords: string[] = []): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  const candidates = keywords.length > 0 ? keywords : [value];
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, scoreCandidate(candidate, query));
    if (best === 1) break;
  }
  return best;
}
