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
}

export interface NamespaceInfo {
  name: string;
  status?: string;
  reason?: string;
  message?: string;
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
}

export interface PodLogsResponse {
  text: string;
  truncated: boolean;
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
  | { subscriptionId: string; type: "line"; text?: string }
  | { subscriptionId: string; type: "error"; message?: string };

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
  core: {
    status(): Promise<CoreStatus>;
    onStatus(listener: (status: CoreStatus) => void): () => void;
  };
  safety: {
    setReadOnly(contextId: string, readOnly: boolean): Promise<void>;
  };
  contexts: {
    list(): Promise<ContextInfo[]>;
  };
  settings: {
    get(): Promise<AsterSettings>;
    setKubeconfigSources(sources: string[]): Promise<AsterSettings>;
    pickKubeconfigFile(): Promise<string | null>;
    pickKubeconfigFolder(): Promise<string | null>;
    applyKubeconfigSources(sources: string[]): Promise<void>;
  };
  discovery: {
    list(contextId: string): Promise<DiscoveredResource[]>;
  };
  namespaces: {
    list(contextId: string): Promise<NamespaceInfo[]>;
  };
  metrics: {
    pods(contextId: string, namespace?: string): Promise<PodMetric[]>;
  };
  resources: {
    list(request: ResourceListRequest): Promise<ResourceListResponse>;
    get(request: ResourceGetRequest): Promise<ResourceGetResponse>;
    events(request: ResourceGetRequest): Promise<ResourceEvent[]>;
    related(request: ResourceGetRequest): Promise<RelatedResource[]>;
    search(request: ResourceSearchRequest): Promise<RelatedResource[]>;
    logs(request: PodLogsRequest): Promise<PodLogsResponse>;
    followLogs(request: PodLogsRequest, listener: (batch: LogStreamBatch) => void): () => void;
    portForwardStart(request: PortForwardStartRequest): Promise<PodPortForward>;
    portForwardStop(id: string): Promise<void>;
    exec(request: PodExecRequest): Promise<PodExecResponse>;
    mutate(request: ResourceMutationRequest): Promise<ResourceMutationResponse>;
    watch(request: ResourceListRequest, listener: (batch: ResourceWatchBatch) => void): () => void;
  };
}
