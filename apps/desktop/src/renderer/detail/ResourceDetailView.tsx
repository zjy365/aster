import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  Box,
  CheckCircle2,
  Clock3,
  Container,
  FileCode2,
  LoaderCircle,
  Play,
  Radio,
  RotateCw,
  Scale3d,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  PodExecResponse,
  PodLogsResponse,
  PodMetric,
  PodPortForward,
  RelatedResource,
  ResourceEvent,
  ResourceGetResponse,
  ResourceMutationRequest,
  ResourceRow,
} from "../../shared/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { semanticDiff } from "../lib/semantic-diff";
import { HighlightedYaml } from "./yaml-highlight";

type MutationDraft = Omit<
  ResourceMutationRequest,
  "contextId" | "resourceKind" | "namespace" | "name"
>;

type DetailTab = "overview" | "yaml" | "events" | "related" | "logs";
type OperationDialog = "scale" | "image" | null;

export interface ResourceDetailViewProps {
  row?: ResourceRow;
  detail?: ResourceGetResponse;
  detailError: string;
  canMutate: boolean;
  canExec: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  mutationPreview: string;
  pendingMutation?: ResourceMutationRequest;
  journal: string[];
  events: ResourceEvent[];
  related: RelatedResource[];
  logs?: PodLogsResponse;
  following: boolean;
  followLines: string[];
  podMetric?: PodMetric;
  portForward?: PodPortForward;
  portForwardMessage: string;
  execResult?: PodExecResponse;
  onToggleFollow(): void;
  onStartPortForward(podPort: number): Promise<void>;
  onStopPortForward(): Promise<void>;
  onExec(command: string[]): Promise<void>;
  onMutate(request: MutationDraft): Promise<void>;
  onApplyMutation(): Promise<void>;
  onCancelMutation(): void;
  onNavigateRelated(item: RelatedResource): void;
  onBack(): void;
}

export function ResourceDetailView({
  row,
  detail,
  detailError,
  canMutate,
  canExec,
  mutationBusy,
  mutationMessage,
  mutationPreview,
  pendingMutation,
  journal,
  events,
  related,
  logs,
  following,
  followLines,
  podMetric,
  portForward,
  portForwardMessage,
  execResult,
  onToggleFollow,
  onStartPortForward,
  onStopPortForward,
  onExec,
  onMutate,
  onApplyMutation,
  onCancelMutation,
  onNavigateRelated,
  onBack,
}: ResourceDetailViewProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [operationDialog, setOperationDialog] = useState<OperationDialog>(null);
  const [operationValue, setOperationValue] = useState("");

  useEffect(() => {
    setTab("overview");
    setOperationDialog(null);
  }, [row?.uid]);

  if (!row) {
    return (
      <section className="resource-detail-view resource-detail-empty" data-testid="resource-detail-empty">
        <Box aria-hidden="true" size={22} />
        <h2>No resource selected</h2>
        <p>Return to the resource list and select an object to inspect.</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Back to resources
        </Button>
      </section>
    );
  }

  const currentRow = row;
  const supportsOperations = ["Deployment", "StatefulSet", "DaemonSet"].includes(currentRow.kind);
  const showLogs = currentRow.kind === "Pod";
  const reviewOpen = Boolean(pendingMutation && (detail || pendingMutation?.operation === "delete"));
  const diff = !detail
    ? mutationPreview
    : pendingMutation?.operation === "delete"
      ? semanticDiff(detail.yaml, "")
      : semanticDiff(detail.yaml, mutationPreview || detail.yaml);

  function openOperation(kind: Exclude<OperationDialog, null>) {
    setOperationValue(kind === "scale" ? String(currentRow.desired ?? 1) : currentRow.images?.[0] || "");
    setOperationDialog(kind);
  }

  async function prepareOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operationDialog || mutationBusy || !canMutate) return;

    if (operationDialog === "scale") {
      const replicas = Number(operationValue);
      if (!Number.isInteger(replicas) || replicas < 0) return;
      await onMutate({ operation: "scale", replicas });
    } else {
      const image = operationValue.trim();
      if (!image) return;
      await onMutate({ operation: "image", image });
    }
    setOperationDialog(null);
  }

  return (
    <section className="resource-detail-view" data-testid="resource-detail-view">
      <header className="resource-detail-header">
        <Button
          aria-label="Back to resource list"
          data-testid="resource-detail-back"
          size="icon"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div className="resource-detail-identity">
          <span className="resource-detail-breadcrumb">
            {row.namespace || "Cluster scoped"} · {row.kind}
          </span>
          <div className="resource-detail-title-row">
            <h1>{row.name}</h1>
            <StatusBadge status={row.status} deleting={row.deleting} />
          </div>
        </div>
      </header>

      <Tabs
        className="resource-detail-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
      >
        <TabsList className="resource-detail-tab-list" variant="line" aria-label="Resource details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="yaml">YAML</TabsTrigger>
          <TabsTrigger value="events">
            Events{events.length ? ` (${events.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="related">
            Related{related.length ? ` (${related.length})` : ""}
          </TabsTrigger>
          {showLogs && <TabsTrigger value="logs">Logs</TabsTrigger>}
        </TabsList>

        <div className="resource-detail-scroll">
          <TabsContent value="overview">
            <OverviewTab
              row={row}
              supportsOperations={supportsOperations}
              canMutate={canMutate}
              mutationBusy={mutationBusy}
              mutationMessage={mutationMessage}
              journal={journal}
              onOpenOperation={openOperation}
              onRestart={() => void onMutate({ operation: "restart" })}
              onDelete={() => void onMutate({ operation: "delete" })}
            />
          </TabsContent>

          <TabsContent value="yaml">
            <ResourceYamlTab
              key={row.uid || `${row.namespace}/${row.name}`}
              kind={row.kind}
              detail={detail}
              detailError={detailError}
              canMutate={canMutate}
              mutationBusy={mutationBusy}
              mutationMessage={mutationMessage}
              onMutate={onMutate}
            />
          </TabsContent>

          <TabsContent value="events">
            <EventsView events={events} />
          </TabsContent>

          <TabsContent value="related">
            <RelatedView related={related} onNavigate={onNavigateRelated} />
          </TabsContent>

          {showLogs && (
            <TabsContent value="logs">
              <PodLogsAndTerminal
                logs={logs}
                following={following}
                followLines={followLines}
                onToggleFollow={onToggleFollow}
                podMetric={podMetric}
                portForward={portForward}
                portForwardMessage={portForwardMessage}
                onStartPortForward={onStartPortForward}
                onStopPortForward={onStopPortForward}
                canExec={canExec}
                execResult={execResult}
                onExec={onExec}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>

      <OperationInputDialog
        kind={operationDialog}
        value={operationValue}
        busy={mutationBusy}
        onValueChange={setOperationValue}
        onSubmit={prepareOperation}
        onOpenChange={(open) => {
          if (!open) setOperationDialog(null);
        }}
      />

      <AlertDialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!open && !mutationBusy) onCancelMutation();
        }}
      >
        <AlertDialogContent className="mutation-review-dialog" data-testid="mutation-review-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Review dry-run changes</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMutation?.operation === "delete"
                ? `Kubernetes accepted the dry-run. Review the object that will be deleted from ${row.name ? `namespace ${row.namespace || "cluster scope"}` : "the cluster"} — this cannot be undone.`
                : `Kubernetes accepted the dry-run. Review the exact changes before applying them to ${row.name}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mutation-review-status" aria-live="polite">
            {mutationMessage || "Dry-run ready"}
          </div>
          <HighlightedYaml
            code={diff || "No changes were returned by the dry-run."}
            className="mutation-review-diff"
            ariaLabel="Dry-run Diff"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutationBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutationBusy || !canMutate}
              data-testid="mutation-apply"
              onClick={() => void onApplyMutation()}
            >
              {mutationBusy && <LoaderCircle className="spin" data-icon="inline-start" />}
              Apply changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function StatusBadge({ status, deleting }: { status?: string; deleting?: boolean }) {
  const normalized = (deleting ? "Terminating" : status || "Unknown").toLowerCase();
  const destructive = /(fail|error|crash|backoff|unavailable|terminat)/.test(normalized);
  const healthy = /(ready|running|active|bound|succeeded|available)/.test(normalized);
  return (
    <Badge
      className="resource-status-badge"
      variant={destructive ? "destructive" : healthy ? "secondary" : "outline"}
    >
      {healthy ? <CheckCircle2 aria-hidden="true" /> : destructive ? <AlertCircle aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
      {deleting ? "Terminating" : status || "Unknown"}
    </Badge>
  );
}

function OverviewTab({
  row,
  supportsOperations,
  canMutate,
  mutationBusy,
  mutationMessage,
  journal,
  onOpenOperation,
  onRestart,
  onDelete,
}: {
  row: ResourceRow;
  supportsOperations: boolean;
  canMutate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  journal: string[];
  onOpenOperation(kind: "scale" | "image"): void;
  onRestart(): void;
  onDelete(): void;
}) {
  return (
    <div className="resource-overview" data-testid="resource-overview">
      <section className="resource-detail-section">
        <div className="resource-section-heading">
          <h2>Resource information</h2>
        </div>
        <dl className="resource-definition-list">
          <Definition label="Kind" value={row.kind} />
          <Definition label="Namespace" value={row.namespace || "Cluster scoped"} />
          <Definition label="Created" value={formatTimestamp(row.createdAt)} />
          <Definition label="Resource version" value={row.resourceVersion || "—"} mono />
          {row.desired !== undefined && <Definition label="Desired" value={String(row.desired)} />}
          {row.ready !== undefined && <Definition label="Ready" value={String(row.ready)} />}
          {row.available !== undefined && <Definition label="Available" value={String(row.available)} />}
          {row.updated !== undefined && <Definition label="Updated" value={String(row.updated)} />}
        </dl>
      </section>

      {row.images?.length ? (
        <section className="resource-detail-section">
          <div className="resource-section-heading"><h2>Container images</h2></div>
          <div className="resource-code-list">
            {row.images.map((image) => <code key={image}>{image}</code>)}
          </div>
        </section>
      ) : null}

      {row.labels && Object.keys(row.labels).length ? (
        <section className="resource-detail-section">
          <div className="resource-section-heading"><h2>Labels</h2></div>
          <dl className="resource-label-list">
            {Object.entries(row.labels).map(([key, value]) => (
              <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="resource-detail-section resource-operations">
        <div className="resource-section-heading">
          <div>
            <h2>Operations</h2>
            <p aria-live="polite">{canMutate ? mutationMessage || "Changes are previewed before apply." : "Blocked by read-only mode."}</p>
          </div>
        </div>
        <div className="resource-operation-actions">
          {supportsOperations && row.kind !== "DaemonSet" && (
            <Button variant="outline" disabled={!canMutate || mutationBusy} onClick={() => onOpenOperation("scale")}>
              <Scale3d data-icon="inline-start" />
              Scale
            </Button>
          )}
          {supportsOperations && (
            <Button variant="outline" disabled={!canMutate || mutationBusy} onClick={() => onOpenOperation("image")}>
              <Container data-icon="inline-start" />
              Update image
            </Button>
          )}
          {supportsOperations && (
            <Button variant="outline" disabled={!canMutate || mutationBusy} onClick={onRestart}>
              <RotateCw data-icon="inline-start" />
              Restart
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!canMutate || mutationBusy}
            data-testid="delete-resource"
            onClick={onDelete}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
        </div>
        {journal.length > 0 && (
          <div className="resource-operation-journal">
            <h3>Recent operations</h3>
            {journal.map((entry, index) => <code key={`${entry}-${index}`}>{entry}</code>)}
          </div>
        )}
      </section>
    </div>
  );
}

function Definition({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "resource-mono-value" : undefined}>{value}</dd></div>;
}

function YamlViewer({ detail, detailError }: { detail?: ResourceGetResponse; detailError: string }) {
  return (
    <section className="resource-detail-section resource-yaml-section">
      <div className="resource-section-heading">
        <div><h2>Live YAML</h2><p>The object returned by the Kubernetes API.</p></div>
      </div>
      {detail ? (
        <HighlightedYaml code={detail.yaml} className="resource-yaml-view" testId="resource-yaml-view" />
      ) : detailError ? (
        <div className="resource-inline-state resource-inline-error" role="alert"><AlertCircle aria-hidden="true" />{detailError}</div>
      ) : (
        <div className="resource-inline-state"><LoaderCircle className="spin" aria-hidden="true" />Loading object…</div>
      )}
    </section>
  );
}

function ResourceYamlTab({
  kind,
  detail,
  detailError,
  canMutate,
  mutationBusy,
  mutationMessage,
  onMutate,
}: {
  kind: string;
  detail?: ResourceGetResponse;
  detailError: string;
  canMutate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  onMutate(request: MutationDraft): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!detail) return <YamlViewer detail={detail} detailError={detailError} />;
  if (!editing) {
    return (
      <section className="resource-detail-section resource-yaml-section">
        <div className="resource-section-heading">
          <div>
            <h2>{kind} YAML</h2>
            <p>{kind === "Secret" ? "Secret values are redacted by the local core." : "The object returned by the Kubernetes API."}</p>
          </div>
          {kind !== "Secret" && (
            <Button variant="outline" disabled={!canMutate} data-testid="yaml-edit" onClick={() => setEditing(true)}>
              <FileCode2 data-icon="inline-start" />
              Edit
            </Button>
          )}
        </div>
        <HighlightedYaml code={detail.yaml} className="resource-yaml-view" testId="resource-yaml-view" />
      </section>
    );
  }
  return (
    <YamlResourceEditor
      kind={kind}
      detail={detail}
      canMutate={canMutate}
      mutationBusy={mutationBusy}
      mutationMessage={mutationMessage}
      onMutate={onMutate}
      onClose={() => setEditing(false)}
    />
  );
}

function YamlResourceEditor({
  kind,
  detail,
  canMutate,
  mutationBusy,
  mutationMessage,
  onMutate,
  onClose,
}: {
  kind: string;
  detail: ResourceGetResponse;
  canMutate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  onMutate(request: MutationDraft): Promise<void>;
  onClose(): void;
}) {
  const [yaml, setYaml] = useState(detail.yaml);
  const dirty = yaml !== detail.yaml;

  useEffect(() => setYaml(detail.yaml), [detail.yaml]);

  return (
    <section className="resource-detail-section resource-yaml-section">
      <div className="resource-section-heading">
        <div>
          <h2>{kind} YAML</h2>
          <p aria-live="polite">{canMutate ? mutationMessage || "Edits are dry-run before apply." : "Read-only mode — editing is disabled."}</p>
        </div>
        {dirty && <Badge variant="outline">Unsaved edits</Badge>}
      </div>
      <textarea
        className="resource-yaml-editor"
        value={yaml}
        readOnly={!canMutate || mutationBusy}
        aria-readonly={!canMutate || mutationBusy}
        spellCheck={false}
        aria-label={`${kind} YAML`}
        data-testid="resource-yaml-editor"
        onChange={(event) => setYaml(event.target.value)}
      />
      <div className="resource-editor-actions">
        <Button variant="outline" disabled={mutationBusy} onClick={onClose}>View</Button>
        <Button variant="outline" disabled={!dirty || mutationBusy} onClick={() => setYaml(detail.yaml)}>Revert</Button>
        <Button
          disabled={!canMutate || mutationBusy || !dirty || !yaml.trim()}
          data-testid="yaml-prepare-dry-run"
          onClick={() => void onMutate({ operation: "yaml", yaml })}
        >
          <FileCode2 data-icon="inline-start" />
          Prepare dry-run
        </Button>
      </div>
    </section>
  );
}

function EventsView({ events }: { events: ResourceEvent[] }) {
  if (!events.length) return <EmptyTab icon={<Clock3 />} title="No recent events" detail="Kubernetes has not reported recent events for this object." />;
  return (
    <section className="resource-detail-section">
      <div className="resource-section-heading"><h2>Recent events</h2></div>
      <div className="resource-event-list" data-testid="resource-events">
        {events.map((event, index) => (
          <article className="resource-event-row" key={`${event.name}-${event.lastTimestamp || index}`}>
            <div className="resource-event-title">
              <strong>{event.reason || event.type || "Event"}</strong>
              {event.count && event.count > 1 ? <Badge variant="outline">×{event.count}</Badge> : null}
              <time>{event.lastTimestamp ? formatTimestamp(event.lastTimestamp) : ""}</time>
            </div>
            <p>{event.message || "No event message"}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RelatedView({ related, onNavigate }: { related: RelatedResource[]; onNavigate?(item: RelatedResource): void }) {
  if (!related.length) return <EmptyTab icon={<Box />} title="No related resources" detail="No owners, owned children, referenced objects, or selecting services were found." />;
  return (
    <section className="resource-detail-section">
      <div className="resource-section-heading"><h2>Related resources</h2></div>
      <div className="resource-related-list" data-testid="resource-related">
        {related.map((item) => (
          <button
            type="button"
            className="resource-related-item"
            key={`${item.relation}-${item.kind}-${item.namespace || ""}-${item.name}`}
            data-testid={`related-${item.kind}-${item.name}`}
            disabled={!onNavigate}
            onClick={() => onNavigate?.(item)}
          >
            <span className="resource-related-relation">{item.relation}</span>
            <code>{item.kind}/{item.name}</code>
          </button>
        ))}
      </div>
    </section>
  );
}

function PodLogsAndTerminal({
  logs,
  following,
  followLines,
  onToggleFollow,
  podMetric,
  portForward,
  portForwardMessage,
  onStartPortForward,
  onStopPortForward,
  canExec,
  execResult,
  onExec,
}: {
  logs?: PodLogsResponse;
  following: boolean;
  followLines: string[];
  onToggleFollow(): void;
  podMetric?: PodMetric;
  portForward?: PodPortForward;
  portForwardMessage: string;
  onStartPortForward(podPort: number): Promise<void>;
  onStopPortForward(): Promise<void>;
  canExec: boolean;
  execResult?: PodExecResponse;
  onExec(command: string[]): Promise<void>;
}) {
  const [command, setCommand] = useState("/bin/echo Aster terminal");
  const [podPort, setPodPort] = useState("8080");
  const argv = useMemo(() => command.trim().split(/\s+/).filter(Boolean), [command]);
  const parsedPodPort = Number(podPort);
  const portForwardValid = Number.isInteger(parsedPodPort) && parsedPodPort >= 1 && parsedPodPort <= 65535;
  const logsViewRef = useRef<HTMLPreElement>(null);

  // While following, the stream's own tail replaces the one-shot snapshot.
  const logText = following
    ? (followLines.length ? followLines.join("\n") : logs?.text || "")
    : logs?.text || "";

  useEffect(() => {
    if (following && logsViewRef.current) {
      logsViewRef.current.scrollTop = logsViewRef.current.scrollHeight;
    }
  }, [followLines, following]);

  return (
    <div className="pod-tools">
      <section className="resource-detail-section">
        <div className="resource-section-heading">
          <div><h2>Logs</h2><p>{following ? `Following · ${followLines.length} new lines` : `Last 2,000 lines${logs?.truncated ? " · truncated" : ""}`}</p></div>
          <Button
            variant={following ? "secondary" : "outline"}
            data-testid="logs-follow-toggle"
            onClick={onToggleFollow}
          >
            <Radio aria-hidden="true" data-icon="inline-start" />
            {following ? "Following" : "Follow"}
          </Button>
        </div>
        {logs ? <pre ref={logsViewRef} className="resource-logs-view" data-testid="pod-logs">{logText || "No log output"}</pre> : <div className="resource-inline-state"><LoaderCircle className="spin" />Loading logs…</div>}
      </section>
      {podMetric && podMetric.containers.length > 0 && (
        <section className="resource-detail-section">
          <div className="resource-section-heading">
            <div><h2>Metrics</h2><p>Live usage from metrics.k8s.io.</p></div>
          </div>
          <div className="resource-code-list" data-testid="pod-metrics">
            {podMetric.containers.map((container) => (
              <code key={container.name}>{container.name} · {container.cpu || "0"} CPU · {container.memory || "0"}</code>
            ))}
          </div>
        </section>
      )}
      <section className="resource-detail-section">
        <div className="resource-section-heading">
          <div><h2>Port forward</h2><p>{canExec ? "A random loopback port, reclaimed when stopped or the view changes." : "Blocked by read-only mode."}</p></div>
        </div>
        {portForward ? (
          <div className="resource-operation-actions">
            <code data-testid="portforward-result">http://127.0.0.1:{portForward.localPort} → pod :{podPort}</code>
            <Button variant="outline" data-testid="portforward-stop" onClick={() => void onStopPortForward()}>
              Stop
            </Button>
          </div>
        ) : (
          <form
            className="pod-terminal-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canExec && portForwardValid) void onStartPortForward(parsedPodPort);
            }}
          >
            <ArrowLeftRight aria-hidden="true" />
            <input value={podPort} onChange={(event) => setPodPort(event.target.value)} aria-label="Pod port" />
            <Button type="submit" disabled={!canExec || !portForwardValid} data-testid="portforward-start">
              <Play data-icon="inline-start" />
              Forward
            </Button>
          </form>
        )}
        {portForwardMessage && <p className="resource-inline-error" data-testid="portforward-error">{portForwardMessage}</p>}
      </section>
      <section className="resource-detail-section">
        <div className="resource-section-heading">
          <div><h2>One-shot terminal</h2><p>{canExec ? "Runs an argv command without creating Kubernetes RBAC." : "Blocked by read-only mode."}</p></div>
        </div>
        <form
          className="pod-terminal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canExec && argv.length) void onExec(argv);
          }}
        >
          <TerminalSquare aria-hidden="true" />
          <input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Pod command" />
          <Button type="submit" disabled={!canExec || !argv.length}>
            <Play data-icon="inline-start" />
            Run
          </Button>
        </form>
        {execResult && (
          <pre className="resource-terminal-result" data-testid="pod-exec-result">
            {execResult.stdout}{execResult.stderr ? `\n[stderr]\n${execResult.stderr}` : ""}
          </pre>
        )}
      </section>
    </div>
  );
}

function EmptyTab({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="resource-tab-empty">{icon}<h2>{title}</h2><p>{detail}</p></div>;
}

function OperationInputDialog({
  kind,
  value,
  busy,
  onValueChange,
  onSubmit,
  onOpenChange,
}: {
  kind: OperationDialog;
  value: string;
  busy: boolean;
  onValueChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onOpenChange(open: boolean): void;
}) {
  const scale = kind === "scale";
  const valid = scale
    ? Number.isInteger(Number(value)) && Number(value) >= 0
    : Boolean(value.trim());

  return (
    <Dialog open={Boolean(kind)} onOpenChange={onOpenChange}>
      <DialogContent className="resource-operation-dialog" data-testid="resource-operation-dialog">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{scale ? "Scale workload" : "Update container image"}</DialogTitle>
            <DialogDescription>
              {scale
                ? "Enter the desired replica count. A dry-run diff will be shown before apply."
                : "Enter the complete image reference. A dry-run diff will be shown before apply."}
            </DialogDescription>
          </DialogHeader>
          <label className="resource-operation-field">
            <span>{scale ? "Desired replicas" : "Container image"}</span>
            <input
              autoFocus
              type={scale ? "number" : "text"}
              min={scale ? 0 : undefined}
              step={scale ? 1 : undefined}
              value={value}
              aria-label={scale ? "Desired replicas" : "Container image"}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !valid} data-testid="operation-prepare-dry-run">
              {busy && <LoaderCircle className="spin" data-icon="inline-start" />}
              Prepare dry-run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatTimestamp(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
