import { useState, type ComponentType } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideProps,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pluralize } from "../lib/format";
import type { ContextInfo, CoreStatus, ResourceKind } from "../../shared/types";

export type SidebarIcon = ComponentType<LucideProps>;

export interface SidebarResourceItem extends ResourceKind {
  icon: SidebarIcon;
  label?: string;
  enabled?: boolean;
  pinned?: boolean;
}

export interface SidebarResourceGroup {
  label: string;
  items: SidebarResourceItem[];
  children?: SidebarResourceGroup[];
}

export interface SidebarProps {
  context?: Pick<ContextInfo, "name" | "cluster">;
  coreState: CoreStatus["state"];
  resourceGroups: SidebarResourceGroup[];
  activeKind: ResourceKind;
  onSelectKind(kind: ResourceKind): void;
  onShowContexts(): void;
  className?: string;
  overviewActive?: boolean;
  onSelectOverview?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const GROUP_COLLAPSE_STORAGE_KEY = "aster.sidebar.groupCollapsed";

const CORE_STATE_LABELS: Record<CoreStatus["state"], string> = {
  ready: "Core running",
  starting: "Starting core",
  error: "Core error",
  stopped: "Core stopped",
};

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
  coreState,
  resourceGroups,
  activeKind,
  onSelectKind,
  onShowContexts,
  className,
  overviewActive = false,
  onSelectOverview,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const [groupPrefs, setGroupPrefs] = useState<GroupCollapsePrefs>(readGroupCollapsePrefs);

  const setGroupCollapsed = (key: string, collapsedValue: boolean) => {
    setGroupPrefs((prefs) => {
      const next = { ...prefs, [key]: collapsedValue };
      localStorage.setItem(GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // A group containing the active kind always renders expanded: navigation
  // targets (palette, related resources) must never be hidden by a fold.
  const isGroupOpen = (group: SidebarResourceGroup, nested: boolean, key: string): boolean => {
    if (groupContainsKind(group, activeKind.id)) return true;
    const pref = groupPrefs[key];
    return pref === undefined ? !defaultCollapsed(group, nested) : !pref;
  };

  const renderItem = (item: SidebarResourceItem) => {
    const active = activeKind.id === item.id;
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
        {collapsed ? (
          <div aria-hidden="true" className="source-list-group-divider" />
        ) : (
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
            {nested ? null : (
              <ChevronRight aria-hidden="true" className={cn("source-list-group-chevron trailing", open && "open")} />
            )}
          </button>
        )}
        {open || collapsed ? (
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
      className={cn("source-list", collapsed && "source-list-collapsed", className)}
      data-collapsed={collapsed || undefined}
      data-testid="source-list"
    >
      <div className="source-list-titlebar">
        {/* The hidden-inset titlebar stays empty like Finder: the window title
            lives in the document title, brand belongs to the picker screen. */}
        {onToggleCollapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="source-list-rail-toggle"
                  data-testid="toggle-sidebar"
                  onClick={onToggleCollapsed}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

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
              <span className="block truncate text-xs font-medium">
                {context?.name || "Choose a cluster"}
              </span>
              <span className="mt-0.5 block truncate text-[0.625rem] font-normal text-muted-foreground">
                {context?.cluster || "No context connected"}
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent side="right">Change Kubernetes context</TooltipContent>
        </Tooltip>
      </div>

      {onSelectOverview ? (
        <div className="source-list-overview shrink-0 px-2 pb-1">
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

      <nav
        aria-label="Kubernetes resources"
        className="source-list-navigation"
        data-testid="resource-navigation"
      >
        {resourceGroups.map((group) => renderGroup(group, false))}
      </nav>

      <footer className="source-list-footer" data-core-state={coreState}>
        <span aria-hidden="true" className="source-list-core-dot" />
        <span className="min-w-0 flex-1 truncate">{CORE_STATE_LABELS[coreState]}</span>
        <Badge variant="outline">Local</Badge>
      </footer>
    </aside>
  );
}

function groupContainsKind(group: SidebarResourceGroup, kindId: string): boolean {
  return group.items.some((item) => item.id === kindId)
    || (group.children ?? []).some((child) => groupContainsKind(child, kindId));
}

function toResourceKind(item: SidebarResourceItem): ResourceKind {
  const { icon: _icon, label: _label, enabled: _enabled, pinned: _pinned, ...kind } = item;
  return kind;
}

function safeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}
