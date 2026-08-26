import { CircleArrowUp, LoaderCircle, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import type { HelmReleaseDetail, HelmReleaseSummary } from "../../shared/types";
import type { HelmUpgradeInput } from "../hooks/useHelm";
import { formatAge } from "../lib/format";
import { HelmUpgradeDialog } from "./HelmUpgradeDialog";

export interface HelmViewProps {
  contextName?: string;
  namespace: string;
  releases: HelmReleaseSummary[];
  loading: boolean;
  error: string;
  selected?: HelmReleaseDetail;
  detailLoading: boolean;
  detailError: string;
  busy: boolean;
  message: string;
  onRefresh(): void;
  onSelect(name: string, namespace: string): void;
  onUninstall(name: string): void;
  onRollback(name: string, revision?: number): void;
  onUpgrade(input: HelmUpgradeInput): Promise<boolean>;
}

const STATUS_TONE: Record<string, string> = {
  deployed: "healthy",
  failed: "failed",
  uninstalled: "failed",
  uninstalling: "failed",
  superseded: "neutral",
  "pending-install": "warning",
  "pending-upgrade": "warning",
  "pending-rollback": "warning",
};

function statusTone(status: string): string {
  return STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

export function HelmView({
  contextName,
  namespace,
  releases,
  loading,
  error,
  selected,
  detailLoading,
  detailError,
  busy,
  message,
  onRefresh,
  onSelect,
  onUninstall,
  onRollback,
  onUpgrade,
}: HelmViewProps) {
  return (
    <section aria-label="Helm releases" className="helm-pane" data-testid="helm-view">
      {selected ? null : (
        <div className="pane-heading">
          <div>
            <h1>Releases</h1>
            <p>Helm · {contextName ? `${contextName} · ` : ""}{namespace}</p>
          </div>
          <div className="resource-summary">
            <span>{releases.length} loaded</span>
            <button className="load-more" data-testid="helm-refresh" disabled={loading || busy} onClick={onRefresh} type="button">
              Refresh
            </button>
          </div>
        </div>
      )}

      {message ? (
        <div className="helm-message" data-testid="helm-message" role="status">
          {message}
        </div>
      ) : null}

      {selected ? (
        <ReleaseDetail
          key={`${selected.namespace}/${selected.name}`}
          detail={selected}
          detailLoading={detailLoading}
          detailError={detailError}
          busy={busy}
          onUninstall={onUninstall}
          onRollback={onRollback}
          onUpgrade={onUpgrade}
        />
      ) : (
        <ReleaseTable
          releases={releases}
          loading={loading}
          error={error}
          namespace={namespace}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

function ReleaseTable({
  releases,
  loading,
  error,
  namespace,
  onSelect,
}: {
  releases: HelmReleaseSummary[];
  loading: boolean;
  error: string;
  namespace: string;
  onSelect(name: string, namespace: string): void;
}) {
  if (loading) {
    return (
      <div className="table-state" data-testid="helm-loading">
        <LoaderCircle aria-hidden="true" className="spin size-5" />
        <span>Loading releases…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="table-state error" data-testid="helm-error" role="alert">
        <TriangleAlert aria-hidden="true" className="size-5" />
        <span>{error}</span>
      </div>
    );
  }
  if (releases.length === 0) {
    return (
      <div className="table-state" data-testid="helm-empty">
        <span>No releases in {namespace}</span>
      </div>
    );
  }
  return (
    <div className="table-frame" data-testid="helm-table">
      <div className="table-header helm-grid" role="row" aria-rowindex={1}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Chart</span>
        <span role="columnheader">Chart version</span>
        <span role="columnheader">App version</span>
        <span role="columnheader">Revision</span>
        <span role="columnheader">Updated</span>
      </div>
      <div className="table-viewport">
        {releases.map((release) => (
          <button
            aria-label={`Open ${release.name}`}
            className="table-row helm-grid"
            data-testid={`helm-release-${release.name}`}
            key={release.name}
            onClick={() => onSelect(release.name, release.namespace)}
            type="button"
          >
            <span className="primary-cell">{release.name}</span>
            <span className="status-cell"><span className={`status-dot ${statusTone(release.status)}`} aria-hidden="true" />{release.status}</span>
            <span>{release.chart}</span>
            <span>{release.chartVersion}</span>
            <span>{release.appVersion}</span>
            <span className="tabular">{release.version}</span>
            <span className="tabular">{release.updatedAt ? formatAge(release.updatedAt) : "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type HelmDetailTab = "overview" | "values" | "manifest";

function ReleaseDetail({
  detail,
  detailLoading,
  detailError,
  busy,
  onUninstall,
  onRollback,
  onUpgrade,
}: {
  detail: HelmReleaseDetail;
  detailLoading: boolean;
  detailError: string;
  busy: boolean;
  onUninstall(name: string): void;
  onRollback(name: string, revision?: number): void;
  onUpgrade(input: HelmUpgradeInput): Promise<boolean>;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [tab, setTab] = useState<HelmDetailTab>("overview");
  return (
    <div className="helm-detail" data-testid="helm-detail">
      <header className="resource-detail-header">
        <div className="resource-detail-identity">
          <span className="resource-detail-breadcrumb">
            Helm · {detail.namespace} · {detail.chart} {detail.chartVersion}
          </span>
          <div className="resource-detail-title-row">
            <h1>{detail.name}</h1>
            <span className="status-cell"><span className={`status-dot ${statusTone(detail.status)}`} aria-hidden="true" />{detail.status}</span>
          </div>
        </div>
        <div className="resource-summary">
          <button
            className="load-more"
            data-testid="helm-upgrade"
            disabled={busy || detailLoading}
            onClick={() => setUpgradeOpen(true)}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="spin size-3.5" /> : <CircleArrowUp aria-hidden="true" className="size-3.5" />}
            Upgrade
          </button>
          <button
            className="load-more"
            data-testid="helm-rollback"
            disabled={busy || detailLoading || detail.version <= 1}
            onClick={() => onRollback(detail.name)}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="spin size-3.5" /> : <RotateCcw aria-hidden="true" className="size-3.5" />}
            Rollback
          </button>
          <button
            className="load-more helm-danger"
            data-testid="helm-uninstall"
            disabled={busy || detailLoading}
            onClick={() => onUninstall(detail.name)}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden="true" className="spin size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
            Uninstall
          </button>
        </div>
      </header>

      {detailError ? (
        <div className="table-state error" data-testid="helm-detail-error" role="alert">
          <TriangleAlert aria-hidden="true" className="size-5" />
          <span>{detailError}</span>
        </div>
      ) : detailLoading ? (
        <div className="table-state" data-testid="helm-detail-loading">
          <LoaderCircle aria-hidden="true" className="spin size-5" />
          <span>Loading release…</span>
        </div>
      ) : (
        <Tabs
          className="resource-detail-tabs"
          value={tab}
          onValueChange={(value) => setTab(value as HelmDetailTab)}
        >
          <TabsList className="resource-detail-tab-list" aria-label="Release details">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="values">Values</TabsTrigger>
            <TabsTrigger value="manifest">Manifest</TabsTrigger>
          </TabsList>

          <div className="resource-detail-scroll">
            <TabsContent value="overview">
              <ReleaseOverview detail={detail} />
            </TabsContent>
            <TabsContent value="values">
              <CodeBlock title="Values" body={detail.values} placeholder="No custom values" dataTestid="helm-values" />
            </TabsContent>
            <TabsContent value="manifest">
              <CodeBlock title="Manifest" body={detail.manifest} placeholder="No manifest" dataTestid="helm-manifest" truncated={detail.truncated} />
            </TabsContent>
          </div>
        </Tabs>
      )}
      <HelmUpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        detail={detail}
        busy={busy}
        onUpgrade={onUpgrade}
      />
    </div>
  );
}

/** Overview speaks the resource detail's card language: a vitals strip of
 * headline facts, then bordered cards for information, history, and notes. */
function ReleaseOverview({ detail }: { detail: HelmReleaseDetail }) {
  return (
    <div className="resource-overview" data-aside="off" data-testid="helm-overview">
      <dl className="resource-vitals" data-testid="helm-vitals">
        <div>
          <dd>
            <span className={`status-dot ${statusTone(detail.status)}`} aria-hidden="true" />
            {detail.status}
          </dd>
          <dt>Status</dt>
        </div>
        <div><dd>{detail.version}</dd><dt>Revision</dt></div>
        <div><dd>{detail.chartVersion}</dd><dt>Chart version</dt></div>
        <div><dd>{detail.appVersion || "—"}</dd><dt>App version</dt></div>
        <div><dd>{detail.updatedAt ? formatAge(detail.updatedAt) : "—"}</dd><dt>Updated</dt></div>
      </dl>

      <div className="resource-overview-body">
        <div className="resource-overview-main">
          <section className="resource-detail-section">
            <div className="resource-section-heading">
              <h2>Release information</h2>
            </div>
            <dl className="resource-definition-list" data-testid="helm-meta">
              <Definition label="Chart" value={detail.chart} />
              <Definition label="Namespace" value={detail.namespace} />
              <Definition label="Updated" value={detail.updatedAt ? formatAge(detail.updatedAt) : "—"} />
              {detail.description ? <Definition label="Description" value={detail.description} /> : null}
            </dl>
          </section>

          <RevisionHistory history={detail.history} />

          {detail.notes ? (
            <section className="resource-detail-section" data-testid="helm-notes">
              <div className="resource-section-heading">
                <h2>Notes</h2>
              </div>
              <pre className="helm-code-body">{detail.notes}</pre>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RevisionHistory({ history }: { history: HelmReleaseSummary[] }) {
  const revisions = [...history].sort((a, b) => b.version - a.version);
  return (
    <section className="resource-detail-section">
      <div className="resource-section-heading">
        <h2>
          Revision history{" "}
          <span className="resource-section-count">{revisions.length}</span>
        </h2>
      </div>
      {revisions.length === 0 ? (
        <div className="helm-revisions-empty">No history</div>
      ) : (
        <ul className="helm-revisions" data-testid="helm-history">
          {revisions.map((item) => (
            <li key={item.version}>
              <span className="tabular">v{item.version}</span>
              <span className="status-cell"><span className={`status-dot ${statusTone(item.status)}`} aria-hidden="true" />{item.status}</span>
              <span>{item.description || "—"}</span>
              <span className="tabular">{item.updatedAt ? formatAge(item.updatedAt) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CodeBlock({
  title,
  body,
  placeholder,
  truncated,
  dataTestid,
}: {
  title: string;
  body?: string;
  placeholder: string;
  truncated?: boolean;
  dataTestid: string;
}) {
  return (
    <div className="helm-code" data-testid={dataTestid}>
      <div className="helm-code-heading">
        <h2>{title}</h2>
        {truncated ? <span className="helm-truncated">Truncated</span> : null}
      </div>
      {body ? <pre className="helm-code-body">{body}</pre> : <div className="helm-code-empty">{placeholder}</div>}
    </div>
  );
}
