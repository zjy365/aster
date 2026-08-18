import { ArrowLeft, LoaderCircle, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HelmReleaseDetail, HelmReleaseSummary } from "../../shared/types";
import { formatAge } from "../lib/format";

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
  onSelect(name: string): void;
  onBack(): void;
  onUninstall(name: string): void;
  onRollback(name: string, revision?: number): void;
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
  onBack,
  onUninstall,
  onRollback,
}: HelmViewProps) {
  return (
    <section aria-label="Helm releases" className="helm-pane" data-testid="helm-view">
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

      {message ? (
        <div className="helm-message" data-testid="helm-message" role="status">
          {message}
        </div>
      ) : null}

      {selected ? (
        <ReleaseDetail
          detail={selected}
          detailLoading={detailLoading}
          detailError={detailError}
          busy={busy}
          onBack={onBack}
          onUninstall={onUninstall}
          onRollback={onRollback}
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
  onSelect(name: string): void;
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
            onClick={() => onSelect(release.name)}
            type="button"
          >
            <span className="primary-cell">{release.name}</span>
            <span className={`status-dot ${statusTone(release.status)}`}>{release.status}</span>
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

function helmStatusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "deployed") return "status-dot healthy";
  if (normalized === "failed" || normalized === "uninstalled" || normalized === "uninstalling") return "status-dot failed";
  if (normalized === "superseded") return "status-dot neutral";
  return "status-dot warning";
}

function ReleaseDetail({
  detail,
  detailLoading,
  detailError,
  busy,
  onBack,
  onUninstall,
  onRollback,
}: {
  detail: HelmReleaseDetail;
  detailLoading: boolean;
  detailError: string;
  busy: boolean;
  onBack(): void;
  onUninstall(name: string): void;
  onRollback(name: string, revision?: number): void;
}) {
  return (
    <div className="helm-detail" data-testid="helm-detail">
      <header className="resource-detail-header">
        <Button
          aria-label="Back to releases"
          data-testid="helm-back"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="resource-detail-identity">
          <span className="resource-detail-breadcrumb">
            Helm · {detail.namespace} · {detail.chart} {detail.chartVersion}
          </span>
          <div className="resource-detail-title-row">
            <h1>{detail.name}</h1>
            <span className={`status-dot ${statusTone(detail.status)}`}>{detail.status}</span>
          </div>
        </div>
        <div className="resource-summary">
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
        <>
          <ReleaseMeta detail={detail} />
          <RevisionHistory history={detail.history} />
          <CodeBlock title="Values" body={detail.values} placeholder="No custom values" dataTestid="helm-values" />
          <CodeBlock title="Manifest" body={detail.manifest} placeholder="No manifest" dataTestid="helm-manifest" truncated={detail.truncated} />
          <CodeBlock title="Notes" body={detail.notes} placeholder="No notes" dataTestid="helm-notes" />
        </>
      )}
    </div>
  );
}

function ReleaseMeta({ detail }: { detail: HelmReleaseDetail }) {
  return (
    <div className="helm-meta-grid" data-testid="helm-meta">
      <Meta label="Status" value={detail.status} />
      <Meta label="Revision" value={String(detail.version)} />
      <Meta label="Chart" value={`${detail.chart} ${detail.chartVersion}`} />
      <Meta label="App version" value={detail.appVersion || "—"} />
      <Meta label="Updated" value={detail.updatedAt ? formatAge(detail.updatedAt) : "—"} />
      {detail.description ? <Meta label="Description" value={detail.description} /> : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="helm-meta">
      <span className="helm-meta-label">{label}</span>
      <span className="helm-meta-value">{value}</span>
    </div>
  );
}

function RevisionHistory({ history }: { history: HelmReleaseSummary[] }) {
  const revisions = [...history].sort((a, b) => b.version - a.version);
  return (
    <div className="helm-revisions" data-testid="helm-history">
      <h2>Revision history</h2>
      {revisions.length === 0 ? (
        <div className="helm-revisions-empty">No history</div>
      ) : (
        <ul>
          {revisions.map((item) => (
            <li key={item.version}>
              <span className="tabular">v{item.version}</span>
              <span className={`status-dot ${statusTone(item.status)}`}>{item.status}</span>
              <span>{item.description || "—"}</span>
              <span className="tabular">{item.updatedAt ? formatAge(item.updatedAt) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
