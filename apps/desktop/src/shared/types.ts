export type CoreState = "starting" | "ready" | "error" | "stopped";
export type AppCommand = "show-contexts" | "go-back" | "focus-filter" | "refresh";
export type AppearanceTheme = "system" | "light" | "dark";

export interface CoreStatus {
  state: CoreState;
  version?: string;
  message?: string;
}

export interface ContextInfo {
  id: string;
  name: string;
  cluster: string;
  server: string;
  user: string;
  namespace: string;
  current: boolean;
  source?: string;
  error?: string;
}

export interface AsterSettings {
  kubeconfigSources: string[];
  /**
   * The standard chain ($KUBECONFIG + ~/.kube/config) is a default, not a
   * privilege: it participates unless the user turns it off. With it off and
   * no configured sources the app simply has no clusters.
   */
  includeStandardChain: boolean;
}

/**
 * Per-source kubeconfig load report from the core: paths and counts only —
 * file contents and credentials never cross into the renderer. A directory
 * source lists the files its content sniff admitted.
 */
export interface SourceReport {
  path: string;
  kind: "file" | "directory";
  files: number;
  contexts: number;
  /** True for the standard ~/.kube/config entry of the chain. */
  default?: boolean;
  /** True when a configured source is already covered by the chain. */
  inChain?: boolean;
  error?: string;
  entries?: SourceReport[];
}

export interface SourcesReport {
  /** Default location + $KUBECONFIG chain; empty when the user turned it off. */
  chain: SourceReport[];
  /** User-configured sources from settings; removable. */
  configured: SourceReport[];
}

export interface NamespaceInfo {
  name: string;
  status?: string;
  reason?: string;
  message?: string;
}

/**
 * A hard cap keeps a 100k-namespace cluster from streaming its whole
 * inventory into the renderer. `truncated` is explicit so pickers can
 * degrade honestly (type-to-filter) instead of showing a partial list
 * as if it were complete.
 */
export interface NamespaceListResult {
  namespaces: NamespaceInfo[];
  truncated: boolean;
}

export interface ResourceKind {
  id: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
  category: string;
}

export interface ResourceRow {
  uid: string;
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  resourceVersion: string;
  createdAt: string;
  deleting?: boolean;
  labels?: Record<string, string>;
  status?: string;
  desired?: number;
  ready?: number;
  available?: number;
  updated?: number;
  images?: string[];
  dataKeys?: string[];
  count?: number;
  lastTimestamp?: string;
  related?: string[];
}

export interface ResourceListRequest {
  contextId: string;
  resourceKind: ResourceKind;
  namespace?: string;
  limit?: number;
  continueToken?: string;
  labelSelector?: string;
  fieldSelector?: string;
}

export interface ResourceListResponse {
  items: ResourceRow[];
  continueToken?: string;
  resourceVersion?: string;
}

export interface ResourceGetRequest {
  contextId: string;
  resourceKind: ResourceKind;
  namespace?: string;
  name: string;
}

export interface ResourceGetResponse {
  row: ResourceRow;
  yaml: string;
}

export interface ResourceEvent {
  name: string;
  namespace: string;
  reason?: string;
  message?: string;
  type?: string;
  count?: number;
  lastTimestamp?: string;
}

export interface PodLogsRequest {
  contextId: string;
  namespace: string;
  name: string;
  container?: string;
  tailLines?: number;
  previous?: boolean;
  timestamps?: boolean;
}

export interface PodLogsResponse {
  text: string;
  truncated: boolean;
  containers?: string[];
}

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "Job";

export interface WorkloadLogsRequest {
  contextId: string;
  namespace: string;
  kind: WorkloadKind;
  name: string;
  container?: string;
  tailLines?: number;
}

export interface WorkloadLogLine {
  pod: string;
  text: string;
}

export interface WorkloadLogsResponse {
  lines: WorkloadLogLine[];
  pods?: string[];
  containers?: string[];
  truncated: boolean;
  note?: string;
}

export interface PodExecRequest {
  contextId: string;
  namespace: string;
  name: string;
  container?: string;
  command: string[];
}

export interface PodExecResponse {
  stdout: string;
  stderr: string;
}

export type LogStreamBatch =
  | { subscriptionId: string; type: "line"; text?: string; pod?: string }
  | { subscriptionId: string; type: "error"; message?: string; pod?: string }
  | { subscriptionId: string; type: "note"; message?: string };

export interface ContainerMetric {
  name: string;
  cpu: string;
  memory: string;
}

export interface PodMetric {
  name: string;
  namespace?: string;
  containers: ContainerMetric[];
}

export interface PodPortForward {
  id: string;
  localPort: number;
}

export interface PortForwardStartRequest {
  contextId: string;
  namespace: string;
  name: string;
  podPort: number;
}

export type MutationOperation = "scale" | "image" | "restart" | "yaml" | "create" | "delete";

export interface ResourceMutationRequest {
  contextId: string;
  resourceKind: ResourceKind;
  namespace?: string;
  name: string;
  operation: MutationOperation;
  replicas?: number;
  image?: string;
  container?: string;
  yaml?: string;
  dryRun?: boolean;
  resourceVersion?: string;
}

export interface ResourceMutationResponse {
  operation: MutationOperation;
  dryRun: boolean;
  changed: boolean;
  resourceVersion?: string;
  yaml?: string;
  name?: string;
}

export type ResourceWatchEvent =
  | { type: "added" | "modified"; row: ResourceRow }
  | { type: "deleted"; key: string };

export type ResourceWatchBatch =
  | {
      subscriptionId: string;
      kind: "snapshot";
      items: ResourceRow[];
      continueToken?: string;
      resourceVersion?: string;
    }
  | {
      subscriptionId: string;
      kind: "delta";
      events: ResourceWatchEvent[];
      continueToken?: string;
      resourceVersion?: string;
    }
  | {
      subscriptionId: string;
      kind: "error";
      message: string;
    };

export interface DiscoveredResource {
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
}

export interface RelatedResource {
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespace?: string;
  name: string;
  relation: string;
}

export interface ResourceSearchRequest {
  contextId: string;
  query: string;
  namespace?: string;
}

/** Row of the Helm releases table; never carries values or manifests. */
export interface HelmReleaseSummary {
  name: string;
  namespace: string;
  version: number;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  updatedAt?: string;
  description?: string;
}

/**
 * Full release read. Values are user-authored chart input and travel
 * unredacted; rendered manifests have Secret data masked by the core.
 */
export interface HelmReleaseDetail extends HelmReleaseSummary {
  notes?: string;
  values?: string;
  manifest?: string;
  /** True when the core truncated values or manifest to the size cap. */
  truncated?: boolean;
  history: HelmReleaseSummary[];
}

export interface HelmGetRequest {
  contextId: string;
  namespace: string;
  name: string;
}

export interface HelmUninstallRequest {
  contextId: string;
  namespace: string;
  name: string;
}

export interface HelmRollbackRequest {
  contextId: string;
  namespace: string;
  name: string;
  /** Target revision; zero rolls back to the previous revision. */
  revision?: number;
}

export interface OverviewCount {
  total: number;
  ready: number;
}

export interface OverviewUsage {
  requested: number;
  limited: number;
  allocatable: number;
}

export interface OverviewResource {
  cpu: OverviewUsage;
  memory: OverviewUsage;
}

export interface OverviewEvent {
  namespace: string;
  name: string;
  reason?: string;
  message?: string;
  type?: string;
  count?: number;
  lastTimestamp?: string;
}

/**
 * Cluster-wide dashboard snapshot computed by the core: counts are paged to
 * a bounded maximum, resource usage aggregates node allocatable capacity
 * versus pod requests/limits, and events are the newest twenty. `truncated`
 * is set when any count hit the page cap, so a 100k-namespace cluster shows
 * the bound honestly instead of a silent undercount.
 */
export interface Overview {
  nodes: OverviewCount;
  pods: OverviewCount;
  namespaces: number;
  services: number;
  resource: OverviewResource;
  events: OverviewEvent[];
  truncated?: boolean;
}

export type UpdaterState =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdaterSnapshot {
  state: UpdaterState;
  currentVersion: string;
  version?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progressPercent?: number;
  message?: string;
}

export interface DesktopApi {
  platform: NodeJS.Platform;
  app: {
    version(): Promise<string>;
    onCommand(listener: (command: AppCommand) => void): () => void;
    /** Opens an https URL in the system browser; the shell rejects other schemes. */
    openExternal(url: string): Promise<void>;
  };
  updater: {
    state(): Promise<UpdaterSnapshot>;
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    onState(listener: (snapshot: UpdaterSnapshot) => void): () => void;
  };
  appearance: {
    setThemeSource(theme: AppearanceTheme): Promise<void>;
  };
  files: {
    /** Saves text via a native save dialog; resolves to the path or null when cancelled. */
    saveTextFile(defaultName: string, content: string): Promise<string | null>;
  };
  core: {
    status(): Promise<CoreStatus>;
    onStatus(listener: (status: CoreStatus) => void): () => void;
  };
  contexts: {
    list(): Promise<ContextInfo[]>;
    sourcesReport(): Promise<SourcesReport>;
  };
  settings: {
    get(): Promise<AsterSettings>;
    setKubeconfigSources(sources: string[], includeStandardChain: boolean): Promise<AsterSettings>;
    pickKubeconfigFile(): Promise<string | null>;
    pickKubeconfigFolder(): Promise<string | null>;
    applyKubeconfigSources(sources: string[], includeStandardChain: boolean): Promise<void>;
  };
  discovery: {
    list(contextId: string): Promise<DiscoveredResource[]>;
  };
  namespaces: {
    list(contextId: string): Promise<NamespaceListResult>;
  };
  metrics: {
    pods(contextId: string, namespace?: string): Promise<PodMetric[]>;
  };
  overview: {
    get(contextId: string): Promise<Overview>;
  };
  helm: {
    list(contextId: string, namespace: string): Promise<HelmReleaseSummary[]>;
    get(request: HelmGetRequest): Promise<HelmReleaseDetail>;
    uninstall(request: HelmUninstallRequest): Promise<void>;
    rollback(request: HelmRollbackRequest): Promise<void>;
  };
  resources: {
    list(request: ResourceListRequest): Promise<ResourceListResponse>;
    get(request: ResourceGetRequest): Promise<ResourceGetResponse>;
    events(request: ResourceGetRequest): Promise<ResourceEvent[]>;
    related(request: ResourceGetRequest): Promise<RelatedResource[]>;
    search(request: ResourceSearchRequest): Promise<RelatedResource[]>;
    logs(request: PodLogsRequest): Promise<PodLogsResponse>;
    followLogs(request: PodLogsRequest, listener: (batch: LogStreamBatch) => void): () => void;
    workloadLogs(request: WorkloadLogsRequest): Promise<WorkloadLogsResponse>;
    followWorkloadLogs(request: WorkloadLogsRequest, listener: (batch: LogStreamBatch) => void): () => void;
    portForwardStart(request: PortForwardStartRequest): Promise<PodPortForward>;
    portForwardStop(id: string): Promise<void>;
    exec(request: PodExecRequest): Promise<PodExecResponse>;
    mutate(request: ResourceMutationRequest): Promise<ResourceMutationResponse>;
    watch(request: ResourceListRequest, listener: (batch: ResourceWatchBatch) => void): () => void;
  };
}
