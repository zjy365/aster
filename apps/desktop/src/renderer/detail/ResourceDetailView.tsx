import { AlertCircle, ArrowLeft, Box, Clock3, FileCode2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  ResourceKind,
  WorkloadKind,
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
import { useResourceList } from "../hooks/useResourceList";
import { findEnabledResourceKind } from "../lib/resource-catalog";
import { DetailHeader } from "./DetailHeader";
import { LogViewer } from "./LogViewer";
import { MutationDiffView } from "./MutationDiffView";
import { OverviewTab, type PodsPreview } from "./OverviewTab";
import { resourceActionsFor, type ResourceActionId } from "./resource-actions";
import { formatTimestamp } from "./resource-format";
import { HighlightedYaml } from "./yaml-highlight";
import { parseWorkloadDetails, podSelector } from "./workload-detail";
import { WorkloadPodsPanel } from "./WorkloadPodsPanel";

type MutationDraft = Omit<
  ResourceMutationRequest,
  "contextId" | "resourceKind" | "namespace" | "name"
>;

type DetailTab = "overview" | "pods" | "yaml" | "events" | "related" | "logs";
type OperationDialog = "scale" | "image" | null;

/** Static catalog entry; module-level so the pods hook sees a stable reference. */
const POD_KIND: ResourceKind = findEnabledResourceKind("pods") ?? {
  id: "pods",
  group: "",
  version: "v1",
  resource: "pods",
  kind: "Pod",
  namespaced: true,
  category: "Workloads",
};

export interface ResourceDetailViewProps {
  contextId: string;
  /** True when the local core is ready; gates the scoped pods watch. */
  coreReady: boolean;
  row?: ResourceRow;
  detail?: ResourceGetResponse;
  detailError: string;
  canMutate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  mutationPreview: string;
  pendingMutation?: ResourceMutationRequest;
  journal: string[];
  events: ResourceEvent[];
  related: RelatedResource[];
  onMutate(request: MutationDraft): Promise<void>;
  onApplyMutation(): Promise<void>;
  onCancelMutation(): void;
  onNavigateRelated(item: RelatedResource): void;
  onBack(): void;
}

export function ResourceDetailView({
  contextId,
  coreReady,
  row,
  detail,
  detailError,
  canMutate,
  mutationBusy,
  mutationMessage,
  mutationPreview,
  pendingMutation,
  journal,
  events,
  related,
  onMutate,
  onApplyMutation,
  onCancelMutation,
  onNavigateRelated,
  onBack,
}: ResourceDetailViewProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [operationDialog, setOperationDialog] = useState<OperationDialog>(null);
  const [operationValue, setOperationValue] = useState("");
  const [podsError, setPodsError] = useState("");

  useEffect(() => {
    setTab("overview");
    setOperationDialog(null);
  }, [row?.uid]);

  // Object-scoped keyboard shortcuts (Linear-style single letters). They run
  // while a detail is open and no modal or input owns the focus, and mirror
  // the kbd hints shown on the header actions and More menu.
  useEffect(() => {
    if (!row) return;
    const actions = new Set(resourceActionsFor(row.kind).map((action) => action.id));
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (operationDialog || mutationBusy) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      // ⌘⌫ for delete (standard macOS destructive gesture).
      if (event.metaKey && event.key === "Backspace") {
        if (actions.has("delete")) {
          event.preventDefault();
          void onMutate({ operation: "delete" });
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "s" && actions.has("scale")) {
        event.preventDefault();
        openOperation("scale");
      } else if (key === "i" && actions.has("image")) {
        event.preventDefault();
        openOperation("image");
      } else if (key === "r" && actions.has("restart")) {
        event.preventDefault();
        void onMutate({ operation: "restart" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, operationDialog, mutationBusy, onMutate]);

  // Workload facts parsed from the live YAML the core already shipped; powers
  // the conditions/strategy/selector rows, annotations, and the pods list.
  const workload = Boolean(row && isWorkloadLogKind(row.kind));
  const details = useMemo(
    () => (detail ? parseWorkloadDetails(detail.yaml) : undefined),
    [detail],
  );
  const selector = workload ? podSelector(details) : undefined;
  const pods = useResourceList({
    contextId,
    kind: POD_KIND,
    namespace: row?.namespace ?? "",
    coreReady,
    setError: setPodsError,
    labelSelector: selector,
    enabled: Boolean(workload && selector),
  });

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
  // Called after the early return above, so it must stay a plain call — not a hook.
  const actions = resourceActionsFor(currentRow.kind);
  const actionIds = new Set(actions.map((action) => action.id));
  const showLogs = currentRow.kind === "Pod" || isWorkloadLogKind(currentRow.kind);
  const podsLoading = (!detail && !detailError) || pods.loading;
  const podsFailure = detailError || podsError;
  const podsPreview: PodsPreview | undefined = !workload ? undefined : {
    rows: pods.visibleRows,
    loading: podsLoading,
    hasMore: Boolean(pods.list.continueToken),
    partial: Boolean(details?.selectorPartial),
    error: podsFailure || undefined,
  };
  const podCount = pods.visibleRows.length;

  function openPod(pod: ResourceRow) {
    onNavigateRelated({
      group: "",
      version: "v1",
      resource: "pods",
      kind: "Pod",
      namespace: pod.namespace,
      name: pod.name,
      relation: "owned",
    });
  }
  const reviewOpen = Boolean(pendingMutation && (detail || pendingMutation?.operation === "delete"));
  const diffBefore = detail?.yaml ?? "";
  const diffAfter =
    pendingMutation?.operation === "delete" ? "" : mutationPreview || detail?.yaml || "";

  function openOperation(kind: Exclude<OperationDialog, null>) {
    setOperationValue(kind === "scale" ? String(currentRow.desired ?? 1) : currentRow.images?.[0] || "");
    setOperationDialog(kind);
  }

  function runAction(id: ResourceActionId) {
    if (id === "scale" || id === "image") {
      openOperation(id);
      return;
    }
    void onMutate({ operation: id });
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
      <DetailHeader
        row={currentRow}
        actions={actions}
        canMutate={canMutate}
        mutationBusy={mutationBusy}
        statusMessage={mutationMessage}
        onAction={runAction}
      />

      <Tabs
        className="resource-detail-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
      >
        <TabsList className="resource-detail-tab-list" aria-label="Resource details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {workload && (
            <TabsTrigger value="pods">
              Pods{podCount ? ` (${podCount}${pods.list.continueToken ? "+" : ""})` : ""}
            </TabsTrigger>
          )}
          {showLogs && <TabsTrigger value="logs">Logs</TabsTrigger>}
          <TabsTrigger value="yaml">YAML</TabsTrigger>
          <TabsTrigger value="events">
            Events{events.length ? ` (${events.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="related">
            Related{related.length ? ` (${related.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <div className="resource-detail-scroll">
          <TabsContent value="overview">
            <OverviewTab
              row={currentRow}
              details={details}
              journal={journal}
              events={events}
              related={related}
              pods={podsPreview}
              onOpenEvents={() => setTab("events")}
              onOpenRelated={() => setTab("related")}
              onOpenPods={workload ? () => setTab("pods") : undefined}
              onOpenPod={openPod}
              onNavigateRelated={onNavigateRelated}
              onScale={canMutate && actionIds.has("scale") ? () => openOperation("scale") : undefined}
              onUpdateImage={canMutate && actionIds.has("image") ? () => openOperation("image") : undefined}
            />
          </TabsContent>

          {workload && (
            <TabsContent value="pods">
              {details?.selectorPartial ? (
                <EmptyTab
                  icon={<Box />}
                  title="Pods can't be listed"
                  detail="This workload's selector uses matchExpressions, which this view cannot translate into a pod query. The owning ReplicaSet's pods are listed under Related instead."
                />
              ) : (
                <WorkloadPodsPanel
                  rows={pods.visibleRows}
                  loading={podsLoading}
                  loadingMore={pods.loadingMore}
                  hasMore={Boolean(pods.list.continueToken)}
                  error={podsFailure}
                  onLoadMore={() => void pods.loadMore()}
                  onOpen={openPod}
                />
              )}
            </TabsContent>
          )}

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
              <section className="resource-detail-section log-viewer-section">
                <LogViewer
                  contextId={contextId}
                  namespace={row.namespace}
                  name={row.name}
                  workload={currentRow.kind === "Pod" ? undefined : (currentRow.kind as WorkloadKind)}
                />
              </section>
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
          <MutationDiffView
            name={currentRow.name}
            beforeYaml={diffBefore}
            afterYaml={diffAfter}
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

function isWorkloadLogKind(kind: string): kind is WorkloadKind {
  return kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet" || kind === "Job";
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
          <p aria-live="polite">{canMutate ? mutationMessage || "Edits are dry-run before apply." : "Secrets can't be edited — their data never leaves the cluster."}</p>
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
