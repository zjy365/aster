import { AlertTriangle, Check, Copy, Info, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { RelatedResource, ResourceEvent, ResourceRow } from "../../shared/types";
import { Button } from "../components/ui/button";
import { StatusDot } from "../components/ResourceTable";
import { PortForwardSection } from "./PortForwardSection";
import type { ForwardPort } from "./port-forward-ports";
import { formatReady } from "../lib/format";
import { formatAge, formatTimestamp } from "./resource-format";
import type { WorkloadCondition, WorkloadDetails } from "./workload-detail";
import type { PodMetricsState } from "../hooks/usePodMetrics";
import { PodUsageChart } from "./PodUsageChart";
/** How many aside entries preview before deferring to the dedicated tab. */
const EVENT_PREVIEW = 3;
const RELATED_PREVIEW = 5;
const POD_PREVIEW = 5;

export interface PodsPreview {
  rows: ResourceRow[];
  loading: boolean;
  hasMore: boolean;
  /** Selector carries matchExpressions this projection cannot express. */
  partial: boolean;
  /** Detail or pods fetch failed; shown instead of a misleading empty state. */
  error?: string;
}

export interface OverviewTabProps {
  row: ResourceRow;
  /** Structured facts parsed from the live YAML; undefined until it arrives. */
  details?: WorkloadDetails;
  journal: string[];
  events: ResourceEvent[];
  related: RelatedResource[];
  /** Present for workload kinds that can resolve a pod selector. */
  pods?: PodsPreview;
  /** Live CPU/memory sampling; present for Pod details. */
  metrics?: PodMetricsState;
  onOpenEvents(): void;
  onOpenRelated(): void;
  onOpenPods?(): void;
  onOpenPod?(pod: ResourceRow): void;
  onNavigateRelated(item: RelatedResource): void;
  onScale?(): void;
  onUpdateImage?(): void;
}

export function OverviewTab({
  row,
  details,
  journal,
  events,
  related,
  pods,
  metrics,
  onOpenEvents,
  onOpenRelated,
  onOpenPods,
  onOpenPod,
  onNavigateRelated,
  onScale,
  onUpdateImage,
}: OverviewTabProps) {
  const vitals = workloadVitals(row, onScale);
  const labels = Object.entries(row.labels ?? {});
  const annotations = details?.annotations ?? [];
  const hasAside =
    events.length > 0 || related.length > 0 || labels.length > 0
    || annotations.length > 0 || journal.length > 0;

  return (
    <div
      className="resource-overview"
      data-aside={hasAside ? "on" : "off"}
      data-testid="resource-overview"
    >
      {vitals.length > 0 && (
        <dl className="resource-vitals" data-testid="resource-vitals">
          {vitals.map((vital) => (
            <div key={vital.label}>
              <dd data-tone={vital.tone ?? "neutral"}>
                {vital.dot && <StatusDot status={vital.dot} />}
                {vital.onClick ? (
                  <button
                    type="button"
                    className="resource-vital-action"
                    title="Scale this workload"
                    onClick={vital.onClick}
                  >
                    {vital.value}
                  </button>
                ) : (
                  vital.value
                )}
              </dd>
              <dt>{vital.label}</dt>
            </div>
          ))}
        </dl>
      )}

      <div className="resource-overview-body">
        <div className="resource-overview-main">
          {metrics && (
            <PodUsageChart metrics={metrics} />
          )}

          {details && details.conditions.length > 0 && (
            <section className="resource-detail-section">
              <div className="resource-section-heading">
                <h2>Conditions</h2>
              </div>
              <div className="resource-condition-list" data-testid="resource-conditions">
                {details.conditions.map((condition) => (
                  <ConditionRow key={condition.type} condition={condition} />
                ))}
              </div>
            </section>
          )}

          {pods && (
            <section className="resource-detail-section">
              <div className="resource-section-heading">
                <h2>
                  Pods{" "}
                  <span className="resource-section-count">
                    {pods.rows.length}{pods.hasMore ? "+" : ""}
                  </span>
                </h2>
                {onOpenPods && pods.rows.length > 0 && (
                  <button type="button" className="resource-aside-more" onClick={onOpenPods}>
                    All pods
                  </button>
                )}
              </div>
              <PodsPreviewList pods={pods} onOpenPod={onOpenPod} />
            </section>
          )}

          <section className="resource-detail-section">
            <div className="resource-section-heading">
              <h2>Resource information</h2>
            </div>
            <dl className="resource-definition-list">
              <Definition label="Kind" value={row.kind} />
              <Definition label="Namespace" value={row.namespace || "Cluster scoped"} />
              <Definition label="Created" value={formatTimestamp(row.createdAt)} />
              {details?.selector ? <Definition label="Selector" value={details.selector} mono /> : null}
              {details?.strategy ? <Definition label="Strategy" value={details.strategy} /> : null}
              {details?.revision ? <Definition label="Revision" value={details.revision} mono /> : null}
              {details?.serviceAccount ? <Definition label="Service account" value={details.serviceAccount} /> : null}
              {details?.minReadySeconds !== undefined ? (
                <Definition label="Min ready seconds" value={String(details.minReadySeconds)} />
              ) : null}
              <Definition label="Resource version" value={row.resourceVersion || "—"} mono />
              <Definition label="UID" value={row.uid || "—"} mono />
            </dl>
          </section>

          <ContainersSection row={row} details={details} onUpdateImage={onUpdateImage} />

          {row.dataKeys?.length ? (
            <section className="resource-detail-section">
              <div className="resource-section-heading">
                <h2>Keys</h2>
              </div>
              <div className="resource-code-list">
                {row.dataKeys.map((key) => (
                  <code key={key}>{key}</code>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {hasAside && (
          <aside className="resource-overview-aside">
            {events.length > 0 && (
              <AsideBlock
                title="Recent events"
                count={events.length}
                onViewAll={events.length > EVENT_PREVIEW ? onOpenEvents : undefined}
                viewAllLabel="All events"
              >
                <div className="resource-aside-events" data-testid="overview-events">
                  {events.slice(0, EVENT_PREVIEW).map((event, index) => (
                    <article key={`${event.name}-${event.lastTimestamp || index}`}>
                      <span className={`resource-aside-event-icon ${eventTone(event.type)}`} aria-hidden="true">
                        <AsideEventIcon type={event.type} />
                      </span>
                      <div className="resource-aside-event-body">
                        <div>
                          <strong>{event.reason || event.type || "Event"}</strong>
                          <time>{event.lastTimestamp ? formatAge(event.lastTimestamp) : ""}</time>
                        </div>
                        <p>{event.message || "No event message"}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </AsideBlock>
            )}

            {related.length > 0 && (
              <AsideBlock
                title="Related"
                count={related.length}
                onViewAll={related.length > RELATED_PREVIEW ? onOpenRelated : undefined}
                viewAllLabel="All related"
              >
                <GroupedRelated
                  related={related.slice(0, RELATED_PREVIEW)}
                  onNavigate={onNavigateRelated}
                />
              </AsideBlock>
            )}

            {labels.length > 0 && (
              <AsideBlock title="Labels" count={labels.length}>
                <dl className="resource-aside-kv" data-testid="overview-labels">
                  {labels.map(([key, value]) => (
                    <div key={key} title={`${key}: ${value}`}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </AsideBlock>
            )}

            {annotations.length > 0 && (
              <AsideBlock title="Annotations" count={annotations.length}>
                <dl className="resource-aside-kv resource-aside-annotations" data-testid="overview-annotations">
                  {annotations.map(([key, value]) => (
                    <div key={key} title={`${key}: ${value}`}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </AsideBlock>
            )}

            {journal.length > 0 && (
              <AsideBlock title="Session activity" count={journal.length}>
                <div className="resource-aside-journal" data-testid="overview-journal">
                  {journal.map((entry, index) => (
                    <code key={`${entry}-${index}`}>{entry}</code>
                  ))}
                </div>
              </AsideBlock>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function AsideEventIcon({ type }: { type?: string }) {
  switch ((type || "").toLowerCase()) {
    case "warning":
      return <AlertTriangle aria-hidden="true" />;
    case "error":
      return <XCircle aria-hidden="true" />;
    default:
      return <Info aria-hidden="true" />;
  }
}

function eventTone(type?: string): string {
  switch ((type || "").toLowerCase()) {
    case "warning":
      return "warning";
    case "error":
      return "failed";
    default:
      return "normal";
  }
}

function ConditionRow({ condition }: { condition: WorkloadCondition }) {
  // Failure-type conditions invert the usual mapping: True there is the bad
  // news. Tone always rides alongside the status text, never color alone.
  const failureType = /failure|pressure|stalled/i.test(condition.type);
  const tone = condition.status === "True"
    ? (failureType ? "failed" : "healthy")
    : condition.status === "False"
      ? (failureType ? "healthy" : "warning")
      : "warning";
  return (
    <article className="resource-condition-row">
      <span className={`status-dot ${tone}`} aria-hidden="true" />
      <div className="resource-condition-body">
        <div className="resource-condition-title">
          <strong>{condition.type}</strong>
          <span>{condition.status}{condition.reason ? ` · ${condition.reason}` : ""}</span>
          <time>{condition.lastTransitionTime ? formatAge(condition.lastTransitionTime) : ""}</time>
        </div>
        {condition.message && <p>{condition.message}</p>}
      </div>
    </article>
  );
}

function PodsPreviewList({ pods, onOpenPod }: { pods: PodsPreview; onOpenPod?(pod: ResourceRow): void }) {
  if (pods.partial) {
    return (
      <p className="resource-section-note">
        This workload's selector uses matchExpressions, so its pods can't be listed here.
      </p>
    );
  }
  if (pods.error) {
    return <p className="resource-section-note" role="alert">{pods.error}</p>;
  }
  if (pods.loading) {
    return <p className="resource-section-note">Loading pods…</p>;
  }
  if (pods.rows.length === 0) {
    return <p className="resource-section-note">No pods match this workload's selector.</p>;
  }
  return (
    <div className="resource-pods-preview" data-testid="overview-pods">
      {pods.rows.slice(0, POD_PREVIEW).map((pod) => (
        <button
          type="button"
          key={pod.uid || pod.name}
          data-testid={`overview-pod-${pod.name}`}
          disabled={!onOpenPod}
          onClick={() => onOpenPod?.(pod)}
        >
          <span className="resource-pods-name"><StatusDot status={pod.status} />{pod.name}</span>
          <span className="resource-pods-status">{pod.status || "Unknown"}</span>
          <span className="tabular">{formatReady(pod)}</span>
          <span className="tabular resource-pods-age">{formatAge(pod.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}

function ContainersSection({
  row,
  details,
  onUpdateImage,
}: {
  row: ResourceRow;
  details?: WorkloadDetails;
  onUpdateImage?(): void;
}) {
  const containers = details?.containers.length
    ? details.containers
    : (row.images ?? []).map((image) => ({ name: "", image }));
  if (containers.length === 0) return null;

  return (
    <section className="resource-detail-section">
      <div className="resource-section-heading">
        <h2>Containers</h2>
        {onUpdateImage && (
          <Button variant="outline" size="sm" data-testid="overview-update-image" onClick={onUpdateImage}>
            Update image
          </Button>
        )}
      </div>
      <div className="resource-container-list" data-testid="overview-containers">
        {containers.map((container) => (
          <div className="resource-container-row" key={container.name || container.image}>
            {container.name && <span className="resource-container-name">{container.name}</span>}
            <code title={container.image}>{container.image}</code>
            <CopyImageButton image={container.image} />
          </div>
        ))}
      </div>
    </section>
  );
}

function CopyImageButton({ image }: { image: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="resource-copy-button"
      aria-label={`Copy image ${image}`}
      title={copied ? "Copied" : "Copy image reference"}
      onClick={() => {
        void navigator.clipboard?.writeText(image).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => undefined);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}

/** Related objects grouped by kind so the aside reads as structure, not a flat link dump. */
function GroupedRelated({
  related,
  onNavigate,
}: {
  related: RelatedResource[];
  onNavigate(item: RelatedResource): void;
}) {
  const groups = useMemo(() => {
    const byKind = new Map<string, RelatedResource[]>();
    for (const item of related) {
      byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    }
    return [...byKind.entries()];
  }, [related]);

  return (
    <div className="resource-aside-related" data-testid="overview-related">
      {groups.map(([kind, items]) => (
        <div className="resource-aside-related-group" key={kind}>
          <h3>{kind} <span>{items.length}</span></h3>
          {items.map((item) => (
            <button
              type="button"
              key={`${item.relation}-${item.kind}-${item.namespace || ""}-${item.name}`}
              data-testid={`overview-related-${item.kind}-${item.name}`}
              onClick={() => onNavigate(item)}
            >
              <span className="resource-aside-name">{item.name}</span>
              <span className="resource-aside-kind">{item.relation}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Vital {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "caution";
  /** Renders a status dot before the value. */
  dot?: string;
  onClick?(): void;
}

/**
 * Replica counters only. Kinds without them (Pod, ConfigMap, Service…) render no
 * strip at all rather than an empty row of dashes — status and age already lead
 * in the identity header and the information grid.
 */
function workloadVitals(row: ResourceRow, onScale?: () => void): Vital[] {
  const hasCounters =
    row.desired !== undefined ||
    row.ready !== undefined ||
    row.available !== undefined ||
    row.updated !== undefined;
  if (!hasCounters) return [];

  const vitals: Vital[] = [];
  if (row.status) {
    vitals.push({ label: "Status", value: row.status, dot: row.status });
  }
  if (row.ready !== undefined && row.desired !== undefined) {
    vitals.push({
      label: "Ready",
      value: `${row.ready}/${row.desired}`,
      tone: row.ready >= row.desired ? "positive" : "caution",
    });
  } else if (row.ready !== undefined) {
    vitals.push({ label: "Ready", value: String(row.ready) });
  }
  if (row.desired !== undefined) {
    vitals.push({ label: "Desired", value: String(row.desired), onClick: onScale });
  }
  if (row.updated !== undefined) vitals.push({ label: "Updated", value: String(row.updated) });
  if (row.available !== undefined) vitals.push({ label: "Available", value: String(row.available) });
  vitals.push({ label: "Age", value: formatAge(row.createdAt) });
  return vitals;
}

function AsideBlock({
  title,
  count,
  viewAllLabel,
  onViewAll,
  children,
}: {
  title: string;
  count: number;
  viewAllLabel?: string;
  onViewAll?(): void;
  children: ReactNode;
}) {
  return (
    <section className="resource-aside-block">
      <div className="resource-aside-heading">
        <h2>
          {title} <span>{count}</span>
        </h2>
        {onViewAll && (
          <button type="button" className="resource-aside-more" onClick={onViewAll}>
            {viewAllLabel ?? "View all"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Definition({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "resource-mono-value" : undefined}>{value}</dd>
    </div>
  );
}
