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
import { YamlEditor } from "../components/YamlEditor";
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
import { usePodMetrics } from "../hooks/usePodMetrics";
import { useNodeMetrics } from "../hooks/useNodeMetrics";
import { useResourceList } from "../hooks/useResourceList";
import { findEnabledResourceKind } from "../lib/resource-catalog";
import { desktop } from "../lib/desktop";
import { messageOf } from "../lib/format";
import { newestEventsFirst } from "../lib/resource-events";
import { DetailHeader } from "./DetailHeader";
import { AddDebugContainerDialog } from "./AddDebugContainerDialog";
import { LogViewer } from "./LogViewer";
import { MutationDiffView } from "./MutationDiffView";
import { NodeDrainDialog } from "./NodeDrainDialog";
import { parseNodeUnschedulable } from "./node-detail";
import { OverviewTab, type PodsPreview } from "./OverviewTab";
import { PortForwardSection } from "./PortForwardSection";
import { extractForwardPorts } from "./port-forward-ports";
import { resourceActionsFor, type ResourceActionId } from "./resource-actions";
import { formatTimestamp } from "./resource-format";
import { HighlightedYaml } from "./yaml-highlight";
import { parseWorkloadDetails, podSelector, rolloutStatus } from "./workload-detail";
import { WorkloadPodsPanel } from "./WorkloadPodsPanel";
import { usePodEvents } from "../hooks/usePodEvents";

type MutationDraft = Omit<
  ResourceMutationRequest,
  "contextId" | "resourceKind" | "namespace" | "name"
>;

type DetailTab = "overview" | "ports" | "pods" | "yaml" | "events" | "related" | "logs";
type OperationDialog = "image" | null;
type NodeOperation = "cordon" | "uncordon" | "drain" | null;

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
  /** Explicit action target when inspecting a row from an aggregate view. */
  sourceClusterLabel?: string;
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
  /** Records a successful debug-container injection (journal + refresh). */
  onDebugContainerAdded(name: string): void;
  onNavigateRelated(item: RelatedResource): void;
  /** Records node operations in the context journal, like scale/delete. */
  onRecordJournal(entry: string): void;
  /** Node cordon/uncordon/drain changed cluster state; refetch the object. */
  onNodeChanged(): void;
  onBack(): void;
}

export function ResourceDetailView({
  contextId,
  sourceClusterLabel,
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
  onDebugContainerAdded,
  onNavigateRelated,
  onRecordJournal,
  onNodeChanged,
  onBack,
}: ResourceDetailViewProps) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const [operationDialog, setOperationDialog] = useState<OperationDialog>(null);
  const [operationValue, setOperationValue] = useState("");
  const [debugDialogOpen, setDebugDialogOpen] = useState(false);
  const [podsError, setPodsError] = useState("");
  // Node operations: which confirm/dialog is open plus its live feedback.
  const [nodeOperation, setNodeOperation] = useState<NodeOperation>(null);
  const [nodeOpBusy, setNodeOpBusy] = useState(false);
  const [nodeOpMessage, setNodeOpMessage] = useState("");
  // Lifted from the YAML tab so the header Edit action can drive it.
  const [yamlEditing, setYamlEditing] = useState(false);

  useEffect(() => {
    setTab("overview");
    setOperationDialog(null);
    setDebugDialogOpen(false);
    setYamlEditing(false);
    setNodeOperation(null);
    setNodeOpMessage("");
  }, [row?.uid]);

  // Object-scoped keyboard shortcuts (Linear-style single letters). They run
  // while a detail is open and no modal or input owns the focus, and mirror
  // the kbd hints shown on the header actions and More menu.
  useEffect(() => {
    if (!row) return;
    const actions = new Set(resourceActionsFor(row.kind).map((action) => action.id));
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      // pendingMutation: the dry-run review modal is up — re-firing a shortcut
      // behind it would re-tab to YAML editing or overwrite the staged mutation.
      // Node dialogs and in-flight scheduling changes also own keyboard input.
      if (operationDialog || debugDialogOpen || nodeOperation || nodeOpBusy || mutationBusy || pendingMutation) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return;
      // ⌘⌫ for delete (standard macOS destructive gesture). Checked before the
      // modifier guard below — single-letter shortcuts ignore modifiers.
      if (event.metaKey && event.key === "Backspace") {
        if (actions.has("delete")) {
          event.preventDefault();
          void onMutate({ operation: "delete" });
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "i" && actions.has("image")) {
        event.preventDefault();
        openOperation("image");
      } else if (key === "r" && actions.has("restart")) {
        event.preventDefault();
        void onMutate({ operation: "restart" });
      } else if (key === "e" && actions.has("edit")) {
        event.preventDefault();
        openYamlEditor();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, operationDialog, debugDialogOpen, nodeOperation, nodeOpBusy, mutationBusy, pendingMutation, onMutate]);

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
    namespaceScope: row?.namespace ? [row.namespace] : [],
    coreReady,
    setError: setPodsError,
    labelSelector: selector,
    enabled: Boolean(workload && selector),
  });
  // Live CPU/memory for a single Pod; the hook idles (no polls) for other kinds.
  const isPod = row?.kind === "Pod";
  const metrics = usePodMetrics(
    contextId,
    isPod ? row?.namespace ?? "" : "",
    isPod ? row?.name ?? "" : "",
  );
  // Live CPU/memory for a single Node, same lazy semantics as the pod hook.
  const isNode = row?.kind === "Node";
  const nodeMetrics = useNodeMetrics(contextId, isNode ? row?.name ?? "" : "");
  // The Ports tab serves every kind whose forward the core can resolve; it
  // stays visible even without declared ports (manual input covers those).
  const canForward = Boolean(row && isPortForwardKind(row.kind));
  // Forwardable TCP ports from the live YAML; service and workload targets
  // resolve to a backing pod in the core before the SPDY dial.
  const forwardPorts = useMemo(
    () => (detail && row && isPortForwardKind(row.kind) ? extractForwardPorts(row.kind, detail.yaml) : []),
    [detail, row],
  );
  // The rollout's child pod events (Pulling / Created / Started / Killing),
  // joined to this workload's own pods; one polled list request, never a
  // watch stream or a per-pod fan-out.
  const podNames = useMemo(() => pods.visibleRows.map((pod) => pod.name), [pods.visibleRows]);
  const podEvents = usePodEvents({
    contextId,
    namespace: row?.namespace ?? "",
    names: podNames,
    enabled: Boolean(workload && selector),
  });
  // The Events surface merges the object's own events (ScalingReplicaSet)
  // with its pods' events, newest first, so a rollout reads as one timeline.
  const allEvents = useMemo(() => mergeEvents(events, podEvents), [events, podEvents]);

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
  // Node scheduling state from the live YAML picks the Cordon/Uncordon label.
  const nodeUnschedulable = isNode ? parseNodeUnschedulable(detail?.yaml) : false;
  // Called after the early return above, so it must stay a plain call — not a hook.
  const actions = resourceActionsFor(currentRow.kind, isNode ? { nodeUnschedulable } : undefined);
  const actionIds = new Set(actions.map((action) => action.id));
  const showLogs = currentRow.kind === "Pod" || isWorkloadLogKind(currentRow.kind);
  // At-a-glance rollout state (in progress / complete / stuck) from the live
  // Progressing condition plus the replica counters.
  const rollout = rolloutStatus(details, currentRow);
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
    setOperationValue(currentRow.images?.[0] || "");
    setOperationDialog(kind);
  }

  function openYamlEditor() {
    setTab("yaml");
    setYamlEditing(true);
  }

  function runAction(id: ResourceActionId) {
    if (id === "image") {
      openOperation(id);
      return;
    }
    if (id === "debug-container") {
      setDebugDialogOpen(true);
      return;
    }
    if (id === "edit") {
      openYamlEditor();
      return;
    }
    if (id === "cordon" || id === "uncordon" || id === "drain") {
      setNodeOpMessage("");
      setNodeOperation(id);
      return;
    }
    void onMutate({ operation: id });
  }

  async function applyCordon(unschedulable: boolean) {
    if (!contextId) return;
    setNodeOpBusy(true);
    setNodeOpMessage(unschedulable ? "Cordoning…" : "Uncordoning…");
    try {
      const result = await desktop.resources.nodeCordon({
        contextId,
        nodeName: currentRow.name,
        unschedulable,
      });
      setNodeOpMessage(result.changed
        ? unschedulable ? "Node cordoned — new pods will not schedule here" : "Node uncordoned"
        : unschedulable ? "Node was already cordoned" : "Node was already schedulable");
      onRecordJournal(`${unschedulable ? "cordon" : "uncordon"} ${currentRow.name}`);
      setNodeOperation(null);
      onNodeChanged();
    } catch (cause) {
      setNodeOpMessage(messageOf(cause));
    } finally {
      setNodeOpBusy(false);
    }
  }

  async function prepareOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operationDialog || mutationBusy || !canMutate) return;

    const image = operationValue.trim();
    if (!image) return;
    await onMutate({ operation: "image", image });
    setOperationDialog(null);
  }

  return (
    <section className="resource-detail-view" data-testid="resource-detail-view">
      <DetailHeader
        row={currentRow}
        sourceClusterLabel={sourceClusterLabel}
        rollout={rollout}
        actions={actions}
        canMutate={canMutate}
        mutationBusy={mutationBusy || nodeOpBusy}
        statusMessage={mutationMessage || nodeOpMessage}
        onAction={runAction}
      />

      <Tabs
        className="resource-detail-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
      >
        <TabsList className="resource-detail-tab-list" aria-label="Resource details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {canForward && <TabsTrigger value="ports">Ports</TabsTrigger>}
          {workload && (
            <TabsTrigger value="pods">
              Pods{podCount ? ` (${podCount}${pods.list.continueToken ? "+" : ""})` : ""}
            </TabsTrigger>
          )}
          {showLogs && <TabsTrigger value="logs">Logs</TabsTrigger>}
          <TabsTrigger value="yaml">YAML</TabsTrigger>
          <TabsTrigger value="events">
            Events{allEvents.length ? ` (${allEvents.length})` : ""}
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
              events={allEvents}
              related={related}
              pods={podsPreview}
              metrics={isPod ? metrics : undefined}
              nodeMetrics={isNode ? nodeMetrics : undefined}
              onOpenEvents={() => setTab("events")}
              onOpenRelated={() => setTab("related")}
              onOpenPods={workload ? () => setTab("pods") : undefined}
              onOpenPod={openPod}
              onNavigateRelated={onNavigateRelated}
              onUpdateImage={canMutate && actionIds.has("image") ? () => openOperation("image") : undefined}
            />
          </TabsContent>

          {canForward && (
            <TabsContent value="ports" className="resource-detail-padded-tab">
              <PortForwardSection
                  contextId={contextId}
                  namespace={row!.namespace}
                  name={row!.name}
                  kind={row!.kind}
                ports={forwardPorts}
              />
            </TabsContent>
          )}

          {workload && (
            <TabsContent value="pods" className="resource-detail-padded-tab">
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

          <TabsContent value="yaml" className="resource-detail-padded-tab">
            <ResourceYamlTab
              key={row.uid || `${row.namespace}/${row.name}`}
              kind={row.kind}
              detail={detail}
              detailError={detailError}
              canMutate={canMutate}
              mutationBusy={mutationBusy}
              mutationMessage={mutationMessage}
              editing={yamlEditing}
              onEditingChange={setYamlEditing}
              onMutate={onMutate}
            />
          </TabsContent>

          <TabsContent value="events" className="resource-detail-padded-tab">
            <EventsView events={allEvents} />
          </TabsContent>

          <TabsContent value="related" className="resource-detail-padded-tab">
            <RelatedView related={related} onNavigate={onNavigateRelated} />
          </TabsContent>

          {showLogs && (
            <TabsContent value="logs" className="resource-detail-padded-tab">
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

      {isPod && (
        <AddDebugContainerDialog
          contextId={contextId}
          namespace={currentRow.namespace}
          podName={currentRow.name}
          containers={details?.containers.map((container) => container.name).filter(Boolean) ?? []}
          open={debugDialogOpen}
          onOpenChange={setDebugDialogOpen}
          onAdded={onDebugContainerAdded}
        />
      )}

      <AlertDialog
        open={nodeOperation === "cordon" || nodeOperation === "uncordon"}
        onOpenChange={(open) => {
          if (!open && !nodeOpBusy) setNodeOperation(null);
        }}
      >
        <AlertDialogContent data-testid="node-cordon-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {nodeUnschedulable ? `Uncordon ${currentRow.name}?` : `Cordon ${currentRow.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {nodeUnschedulable
                ? "The node will accept newly scheduled pods again."
                : "The node stops accepting new pods. Existing pods keep running until the node is drained or restarted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={nodeOpBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={nodeOpBusy || !canMutate}
              data-testid="node-cordon-confirm"
              onClick={() => void applyCordon(!nodeUnschedulable)}
            >
              {nodeOpBusy && <LoaderCircle className="spin" data-icon="inline-start" />}
              {nodeUnschedulable ? "Uncordon" : "Cordon"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isNode && (
        <NodeDrainDialog
          contextId={contextId}
          nodeName={currentRow.name}
          open={nodeOperation === "drain"}
          busy={nodeOpBusy}
          onOpenChange={(open) => {
            if (!open) setNodeOperation(null);
          }}
          onRecordJournal={onRecordJournal}
          onDrainFinished={onNodeChanged}
        />
      )}

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

function isPortForwardKind(kind: string): boolean {
  return ["Pod", "Service", "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"].includes(kind);
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
  editing,
  onEditingChange,
  onMutate,
}: {
  kind: string;
  detail?: ResourceGetResponse;
  detailError: string;
  canMutate: boolean;
  mutationBusy: boolean;
  mutationMessage: string;
  /** Controlled by the parent so the header Edit action can open the editor. */
  editing: boolean;
  onEditingChange(editing: boolean): void;
  onMutate(request: MutationDraft): Promise<void>;
}) {
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
            <Button variant="outline" disabled={!canMutate} data-testid="yaml-edit" onClick={() => onEditingChange(true)}>
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
      onClose={() => onEditingChange(false)}
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
      <YamlEditor
        value={yaml}
        readOnly={!canMutate || mutationBusy}
        aria-label={`${kind} YAML`}
        data-testid="resource-yaml-editor"
        onChange={setYaml}
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

/** Bound of the merged events timeline; matches the events one-shot's page cap. */
const MERGED_EVENT_LIMIT = 100;

/**
 * Merges the open object's own events with its child pods' events, newest
 * first. The object's one-shot fetch and the pod-events poll replace their
 * halves wholesale, so a plain dedupe-and-sort keeps the timeline stable.
 */
function mergeEvents(objectEvents: ResourceEvent[], podEvents: ResourceEvent[]): ResourceEvent[] {
  const seen = new Set<string>();
  const deduped: ResourceEvent[] = [];
  for (const event of [...objectEvents, ...podEvents]) {
    const key = `${event.namespace}/${event.name}|${event.reason || ""}|${event.lastTimestamp || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return newestEventsFirst(deduped, MERGED_EVENT_LIMIT);
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
  const valid = Boolean(value.trim());

  return (
    <Dialog open={Boolean(kind)} onOpenChange={onOpenChange}>
      <DialogContent className="resource-operation-dialog" data-testid="resource-operation-dialog">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Update container image</DialogTitle>
            <DialogDescription>
              Enter the complete image reference. A dry-run diff will be shown before apply.
            </DialogDescription>
          </DialogHeader>
          <label className="resource-operation-field">
            <span>Container image</span>
            <input
              autoFocus
              type="text"
              value={value}
              aria-label="Container image"
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
