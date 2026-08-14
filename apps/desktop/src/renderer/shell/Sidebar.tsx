import type { ComponentType } from "react";
import {
  Boxes,
  ChevronDown,
  CircleDot,
  Gauge,
  Pin,
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
import type { ContextInfo, ResourceKind } from "../../shared/types";

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
}: SidebarProps) {
  return (
    <aside
      aria-label="Kubernetes source list"
      className={cn("source-list", className)}
      data-testid="source-list"
    >
      <div className="source-list-titlebar">
        <span className="source-list-wordmark">
          <span className="brand-mark">
            <Gauge aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
          </span>
          <strong>Aster</strong>
        </span>
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
            <span className="min-w-0 flex-1">
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
            Overview
          </Button>
        </div>
      ) : null}

      <nav
        aria-label="Kubernetes resources"
        className="source-list-navigation"
        data-testid="resource-navigation"
      >
        {resourceGroups.map((group) => (
          <section className="source-list-group" key={group.label}>
            <h2 className="source-list-group-label">
              {group.label}
            </h2>
            <div className="source-list-group-items grid gap-0.5">
              {group.items.map((item) => {
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
                      {item.pinned || group.label.toLowerCase() === "pinned" ? (
                        <Pin aria-hidden="true" className="size-2.5 text-muted-foreground" />
                      ) : null}
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {enabled ? label : `${label} is unavailable`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <footer className="source-list-footer">
        <CircleDot aria-hidden="true" className="size-2.5 fill-emerald-500 text-emerald-500" />
        <span className="min-w-0 flex-1 truncate">Core runs locally</span>
        <Badge variant="outline">Local</Badge>
      </footer>
    </aside>
  );
}

function toResourceKind(item: SidebarResourceItem): ResourceKind {
  const { icon: _icon, label: _label, enabled: _enabled, pinned: _pinned, ...kind } = item;
  return kind;
}

function safeTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

