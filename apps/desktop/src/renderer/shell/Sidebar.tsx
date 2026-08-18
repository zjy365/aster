import { useEffect, useState, type ComponentType } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Gauge,
  type LucideProps,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pluralize } from "../lib/format";
import type { ContextInfo, ResourceKind } from "../../shared/types";

export type SidebarIcon = ComponentType<LucideProps>;

export interface SidebarResourceItem extends ResourceKind {
  icon: SidebarIcon;
  label?: string;
  enabled?: boolean;
}

export interface SidebarResourceGroup {
  label: string;
  items: SidebarResourceItem[];
  children?: SidebarResourceGroup[];
}

/** A non-resource tool (e.g. Helm releases) surfaced as a sidebar group. */
export interface SidebarToolItem {
  id: string;
  label: string;
  icon: SidebarIcon;
}

export interface SidebarToolGroup {
  label: string;
  items: SidebarToolItem[];
}

export interface SidebarProps {
  context?: Pick<ContextInfo, "name" | "cluster">;
  resourceGroups: SidebarResourceGroup[];
  activeKind: ResourceKind;
  onSelectKind(kind: ResourceKind): void;
  onShowContexts(): void;
  className?: string;
  overviewActive?: boolean;
  onSelectOverview?: () => void;
  toolGroups?: SidebarToolGroup[];
  activeToolId?: string;
  onSelectTool?(id: string): void;
}

const GROUP_COLLAPSE_STORAGE_KEY = "aster.sidebar.groupCollapsed";

/** Explicit per-group expand/collapse preferences, keyed by group label. */
type GroupCollapsePrefs = Record<string, boolean>;

function readGroupCollapsePrefs(): GroupCollapsePrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(GROUP_COLLAPSE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as GroupCollapsePrefs : {};
  } catch {
    return {};
  }
}

/** Custom-resource API subgroups start collapsed so busy clusters stay tidy. */
function defaultCollapsed(group: SidebarResourceGroup, nested: boolean): boolean {
  return nested && (group.items[0]?.category === "Custom" || group.children?.some((child) => child.items[0]?.category === "Custom") === true);
}

export function Sidebar({
  context,
  resourceGroups,
  activeKind,
  onSelectKind,
  onShowContexts,
  className,
  overviewActive = false,
  onSelectOverview,
  toolGroups,
  activeToolId,
  onSelectTool,
}: SidebarProps) {
  const [groupPrefs, setGroupPrefs] = useState<GroupCollapsePrefs>(readGroupCollapsePrefs);

  const setGroupCollapsed = (key: string, collapsedValue: boolean) => {
    setGroupPrefs((prefs) => {
      const next = { ...prefs, [key]: collapsedValue };
      localStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Navigation into a folded group (palette, related resources) expands it
  // once so the target is never hidden; after that the fold belongs to the
  // user — an explicit collapse always wins, even over the active item.
  useEffect(() => {
    setGroupPrefs((prefs) => {
      const keys = closedGroupKeysContaining(resourceGroups, activeKind.id, prefs);
      if (keys.length === 0) return prefs;
      const next = { ...prefs };
      for (const key of keys) next[key] = false;
      localStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [resourceGroups, activeKind.id]);

  const isGroupOpen = (group: SidebarResourceGroup, nested: boolean, key: string): boolean => {
    const pref = groupPrefs[key];
    return pref === undefined ? !defaultCollapsed(group, nested) : !pref;
  };

  const renderItem = (item: SidebarResourceItem) => {
    // The kind highlight only applies while the resource table is the active
    // pane; the overview and tool panes highlight their own sidebar entries.
    const active = !overviewActive && !activeToolId && activeKind.id === item.id;
    const enabled = item.enabled !== false;
    const ItemIcon = item.icon;
    const label = item.label || pluralize(item.kind);

    return (
      <Tooltip key={item.id}>
        <TooltipTrigger
          render={
            <Button
              aria-current={active ? "page" : undefined}
              className={cn("source-list-item", active && "active")}
              data-testid={`resource-nav-${safeTestId(item.id)}`}
              disabled={!enabled}
              onClick={() => onSelectKind(toResourceKind(item))}
              variant="ghost"
            />
          }
        >
          <ItemIcon aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="right">
          {enabled ? label : `${label} is unavailable`}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderGroup = (group: SidebarResourceGroup, nested: boolean, parentLabel?: string) => {
    const key = parentLabel ? `${parentLabel}/${group.label}` : group.label;
    const open = isGroupOpen(group, nested, key);

    return (
      <section className={cn("source-list-group", nested && "source-list-subgroup")} key={key}>
        <button
          aria-expanded={open}
          className="source-list-group-label"
          data-testid={`group-toggle-${safeTestId(key)}`}
          onClick={() => setGroupCollapsed(key, open)}
          type="button"
        >
          {/* Finder section-header semantics: top-level groups trail the
              chevron on the right (revealed on hover, persistent when
              collapsed); nested API subgroups are an outline, so they keep
              the leading disclosure triangle. */}
          {nested ? (
            <ChevronRight aria-hidden="true" className={cn("source-list-group-chevron", open && "open")} />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
          {/* A folded API subgroup surfaces what it hides; the count
              disappears once the group is open and the items are visible. */}
          {nested && !open ? (
            <span className="source-list-group-count tabular-nums">{groupItemCount(group)}</span>
          ) : null}
          {nested ? null : (
            <ChevronRight aria-hidden="true" className={cn("source-list-group-chevron trailing", open && "open")} />
          )}
        </button>
        {open ? (
          <div className="source-list-group-items grid gap-0.5">
            {group.items.map((item) => renderItem(item))}
            {(group.children ?? []).map((child) => renderGroup(child, true, group.label))}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <aside
      aria-label="Kubernetes source list"
      className={cn("source-list", className)}
      data-testid="source-list"
    >
      {/* The hidden-inset titlebar stays empty like Finder: the window title
          lives in the document title, brand belongs to the picker screen. */}
      <div className="source-list-titlebar" data-tauri-drag-region />

      <div className="source-list-context">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Change Kubernetes context"
                className="context-switcher"
                data-testid="change-context"
                onClick={onShowContexts}
                variant="ghost"
              />
            }
          >
            <Boxes aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 context-switcher-text">
              <span className="block truncate text-sm font-medium">
                {context?.name || "Choose a cluster"}
              </span>
              <span className="mt-0.5 block truncate text-[0.6875rem] font-normal text-muted-foreground">
                {context?.cluster || "No context connected"}
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="right">Change Kubernetes context</TooltipContent>
        </Tooltip>
      </div>

      <nav
        aria-label="Kubernetes resources"
        className="source-list-navigation"
        data-testid="resource-navigation"
      >
        {/* Overview and tools scroll with the resource groups — nothing in
            the list is pinned above the fold. */}
        {onSelectOverview ? (
          <div className="source-list-overview pb-1">
            <Button
              aria-current={overviewActive ? "page" : undefined}
              className={cn("source-list-item", overviewActive && "active")}
              data-testid="source-list-overview"
              onClick={onSelectOverview}
              variant="ghost"
            >
              <Gauge aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">Overview</span>
            </Button>
          </div>
        ) : null}

        {toolGroups?.length ? (
          <div className="source-list-tools pb-1" data-testid="source-list-tools">
            {toolGroups.map((group) => (
              <section className="source-list-group" key={group.label}>
                <div className="source-list-group-label" data-testid={`group-toggle-${safeTestId(group.label)}`}>
                  <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                </div>
                <div className="source-list-group-items grid gap-0.5">
                  {group.items.map((item) => {
                    const active = activeToolId === item.id;
                    const ItemIcon = item.icon;
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger
                          render={
                            <Button
                              aria-current={active ? "page" : undefined}
                              className={cn("source-list-item", active && "active")}
                              data-testid={`tool-nav-${safeTestId(item.id)}`}
                              onClick={() => onSelectTool?.(item.id)}
                              variant="ghost"
                            />
                          }
                        >
                          <ItemIcon aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {resourceGroups.map((group) => renderGroup(group, false))}
      </nav>
    </aside>
  );
}

function groupContainsKind(group: SidebarResourceGroup, kindId: string): boolean {
  return group.items.some((item) => item.id === kindId)
    || (group.children ?? []).some((child) => groupContainsKind(child, kindId));
}

/** Total selectable items in a group, descending into nested subgroups. */
function groupItemCount(group: SidebarResourceGroup): number {
  return group.items.length
    + (group.children ?? []).reduce((sum, child) => sum + groupItemCount(child), 0);
}

/** Keys of every folded group on the path to `kindId`, deepest included. */
function closedGroupKeysContaining(
  groups: SidebarResourceGroup[],
  kindId: string,
  prefs: GroupCollapsePrefs,
  parentLabel?: string,
  nested = false,
): string[] {
  const keys: string[] = [];
  for (const group of groups) {
    if (!groupContainsKind(group, kindId)) continue;
    const key = parentLabel ? `${parentLabel}/${group.label}` : group.label;
    const pref = prefs[key];
    const open = pref === undefined ? !defaultCollapsed(group, nested) : !pref;
    if (!open) keys.push(key);
    keys.push(...closedGroupKeysContaining(group.children ?? [], kindId, prefs, group.label, true));
  }
  return keys;
}

function toResourceKind(item: SidebarResourceItem): ResourceKind {
  const { icon: _icon, label: _label, enabled: _enabled, ...kind } = item;
  return kind;
}

function safeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}
