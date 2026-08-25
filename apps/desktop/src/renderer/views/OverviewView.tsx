import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Folder,
  Info,
  Network,
  Server,
  XCircle,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAge } from "../lib/format";
import type { Overview as OverviewData, OverviewEvent, OverviewUsage } from "../../shared/types";

export interface OverviewProps {
  overview?: OverviewData;
  loading: boolean;
  error: string;
  contextName?: string;
  onRefresh(): void;
  /** Navigates to a resource kind by its catalog id (nodes, pods, …). */
  onNavigate(kindId: string): void;
}

interface StatCardConfig {
  kindId: string;
  label: string;
  value: number;
  ready?: number;
  icon: ComponentType<LucideProps>;
  accent: string;
}

/**
 * Cluster dashboard rendered as a workbench pane: like a resource kind in the
 * sidebar, the source list and toolbar stay in place and only the content
 * area swaps to the summary. The pane heading is fixed; the cards scroll.
 */
export function OverviewView({
  overview,
  loading,
  error,
  contextName,
  onRefresh,
  onNavigate,
}: OverviewProps) {
  const skeleton = loading || !overview;
  // RBAC-denied clusters (e.g. namespace-scoped sealos accounts) fail with the
  // Kubernetes "is forbidden" wording; surface that as a permission message
  // instead of the raw API error.
  const forbidden = /forbidden/i.test(error);

  return (
    <section aria-label="Cluster overview" className="overview-pane" data-testid="overview-view">
      <div className="pane-heading">
        <div>
          <h1>Overview</h1>
          <p>
            {contextName ? `${contextName} · Cluster summary` : "Cluster summary"}
            {overview?.truncated ? " · counts capped at 10,000 (large cluster)" : ""}
          </p>
        </div>
        <div className="resource-summary">
          <button className="load-more" data-testid="overview-refresh" disabled={loading} onClick={onRefresh} type="button">
            Refresh
          </button>
        </div>
      </div>

      <div className="overview-scroll">
        {error ? (
          <div className="overview-error" role="alert" data-testid="overview-error">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <span className="overview-error-body">
              <span>
                {forbidden
                  ? "This account doesn't have permission to view the cluster overview. It requires cluster-scoped read access, which namespace-scoped accounts (like sealos) don't have."
                  : error}
              </span>
              {forbidden ? <span className="overview-error-detail">{error}</span> : null}
            </span>
          </div>
        ) : skeleton ? (
          <OverviewSkeleton />
        ) : (
          <>
            <StatCards overview={overview} onNavigate={onNavigate} />
            <ResourceUsage resource={overview.resource} truncated={overview.truncated} />
            <RecentEvents events={overview.events} />
          </>
        )}
      </div>
    </section>
  );
}

function StatCards({ overview, onNavigate }: { overview: OverviewData; onNavigate(kindId: string): void }) {
  const cards: StatCardConfig[] = [
    { kindId: "nodes", label: "Nodes", value: overview.nodes.total, ready: overview.nodes.ready, icon: Server, accent: "overview-icon-blue" },
    { kindId: "pods", label: "Pods", value: overview.pods.total, ready: overview.pods.ready, icon: Boxes, accent: "overview-icon-blue" },
    { kindId: "namespaces", label: "Namespaces", value: overview.namespaces, icon: Folder, accent: "overview-icon-purple" },
    { kindId: "services", label: "Services", value: overview.services, icon: Network, accent: "overview-icon-blue" },
  ];

  return (
    <div className="overview-cards" data-testid="overview-cards">
      {cards.map((card) => {
        const Icon = card.icon;
        const allReady = card.ready !== undefined && card.ready === card.value;
        return (
          <button
            aria-label={`Open ${card.label}`}
            className="overview-card"
            data-testid={`overview-card-${card.kindId}`}
            key={card.kindId}
            onClick={() => onNavigate(card.kindId)}
            type="button"
          >
            <span className={cn("overview-card-icon", card.accent)}>
              <Icon aria-hidden="true" />
            </span>
            <span className="overview-card-metrics">
              <span className="overview-card-value tabular">{card.value.toLocaleString()}</span>
              <span className="overview-card-label">{card.label}</span>
              {card.ready !== undefined ? (
                <span className="overview-card-ready">
                  {allReady ? (
                    <>
                      <CheckCircle2 aria-hidden="true" className="size-3.5 text-[var(--healthy)]" />
                      All ready
                    </>
                  ) : (
                    <>
                      <XCircle aria-hidden="true" className="size-3.5 text-[var(--failed)]" />
                      {card.value - card.ready} not ready
                    </>
                  )}
                </span>
              ) : (
                <span className="overview-card-ready" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ResourceUsage({ resource, truncated }: { resource: OverviewData["resource"]; truncated?: boolean }) {
  return (
    <div className="overview-usage-grid">
      <UsageCard title="CPU" usage={resource.cpu} formatValue={formatCores} />
      <UsageCard title="Memory" usage={resource.memory} formatValue={formatBytes} />
      {truncated ? (
        <p className="overview-usage-note">
          Capacity and requests are aggregated from the first 10,000 pods — values are approximate in this cluster.
        </p>
      ) : null}
    </div>
  );
}

function UsageCard({
  title,
  usage,
  formatValue,
}: {
  title: string;
  usage: OverviewUsage;
  formatValue(value: number): string;
}) {
  const requested = percent(usage.requested, usage.allocatable);
  const limited = percent(usage.limited, usage.allocatable);
  return (
    <div className="overview-card overview-usage-card" data-testid={`overview-usage-${title.toLowerCase()}`}>
      <div className="overview-usage-header">
        <span className="overview-card-label">{title}</span>
        <span className="overview-usage-total tabular">
          {formatValue(usage.requested)} / {formatValue(usage.limited)} / {formatValue(usage.allocatable)}
        </span>
      </div>
      <div className="overview-usage-row">
        <span className="overview-usage-caption">Requests</span>
        <span className="overview-bar">
          <span className={cn("overview-bar-fill", barTone(requested))} style={{ width: `${Math.min(requested, 100)}%` }} />
        </span>
        <span className="overview-usage-value tabular">{formatValue(usage.requested)}</span>
      </div>
      <div className="overview-usage-row">
        <span className="overview-usage-caption">Limits</span>
        <span className="overview-bar">
          <span className={cn("overview-bar-fill", barTone(limited))} style={{ width: `${Math.min(limited, 100)}%` }} />
        </span>
        <span className="overview-usage-value tabular">{formatValue(usage.limited)}</span>
      </div>
      <div className="overview-usage-footer tabular">
        {requested.toFixed(1)}% of allocatable capacity
      </div>
    </div>
  );
}

function RecentEvents({ events }: { events: OverviewEvent[] }) {
  return (
    <div className="overview-card overview-events-card" data-testid="overview-events">
      <div className="overview-events-heading">
        <span className="overview-card-label">Recent events</span>
        <span className="overview-events-count tabular">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="overview-events-empty">No recent events</div>
      ) : (
        <ul className="overview-events-list">
          {events.map((event, index) => (
            <li className="overview-event" key={`${event.namespace}/${event.name}/${index}`}>
              <span className={cn("overview-event-icon", eventTypeTone(event.type))}>
                <EventIcon type={event.type} />
              </span>
              <div className="overview-event-body">
                <div className="overview-event-line">
                  <Badge className="shrink-0" variant={eventBadgeVariant(event.type)}>
                    {event.type || "Normal"}
                  </Badge>
                  <span className="overview-event-reason">{event.reason}</span>
                </div>
                {event.message ? <p className="overview-event-message">{event.message}</p> : null}
                <div className="overview-event-meta">
                  {event.namespace ? <span>{event.namespace}/</span> : null}
                  {event.name}
                  {event.lastTimestamp ? (
                    <span className="overview-event-time">{formatAge(event.lastTimestamp)}</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventIcon({ type }: { type?: string }) {
  switch ((type || "").toLowerCase()) {
    case "warning":
      return <AlertTriangle aria-hidden="true" className="size-3.5" />;
    case "error":
      return <XCircle aria-hidden="true" className="size-3.5" />;
    default:
      return <Info aria-hidden="true" className="size-3.5" />;
  }
}

function eventBadgeVariant(type?: string): "default" | "secondary" | "destructive" {
  switch ((type || "").toLowerCase()) {
    case "warning":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

function eventTypeTone(type?: string): string {
  switch ((type || "").toLowerCase()) {
    case "warning":
      return "overview-event-warning";
    case "error":
      return "overview-event-error";
    default:
      return "overview-event-normal";
  }
}

function OverviewSkeleton() {
  return (
    <div aria-hidden="true" className="overview-skeleton">
      <div className="overview-cards">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="overview-card" key={index}>
            <span className="overview-skeleton-chip" />
            <span className="overview-skeleton-lines">
              <span className="overview-skeleton-line w-1/2" />
              <span className="overview-skeleton-line w-2/3" />
            </span>
          </div>
        ))}
      </div>
      <div className="overview-usage-grid">
        {Array.from({ length: 2 }).map((_, index) => (
          <div className="overview-card overview-skeleton-block" key={index} />
        ))}
      </div>
      <div className="overview-card overview-skeleton-block overview-skeleton-events" />
    </div>
  );
}

function percent(requested: number, allocatable: number): number {
  return allocatable > 0 ? (requested / allocatable) * 100 : 0;
}

function barTone(percentage: number): string {
  if (percentage >= 90) return "overview-bar-failed";
  if (percentage >= 60) return "overview-bar-warning";
  return "overview-bar-healthy";
}

/** Milli-cores to decimal cores. */
function formatCores(value: number): string {
  return `${(value / 1000).toFixed(2)} cores`;
}

/** Bytes to a rounded binary unit. */
function formatBytes(value: number): string {
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (value >= gib) return `${(value / gib).toFixed(1)} GiB`;
  if (value >= mib) return `${(value / mib).toFixed(1)} MiB`;
  return `${(value / 1024).toFixed(1)} KiB`;
}
