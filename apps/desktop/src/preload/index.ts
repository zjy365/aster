import { contextBridge, ipcRenderer } from "electron";
import type {
  AppCommand,
  AsterSettings,
  ContextInfo,
  CoreStatus,
  DesktopApi,
  DiscoveredResource,
  LogStreamBatch,
  NamespaceInfo,
  PodExecRequest,
  PodExecResponse,
  PodLogsRequest,
  PodLogsResponse,
  PodMetric,
  PodPortForward,
  PortForwardStartRequest,
  RelatedResource,
  ResourceEvent,
  ResourceGetRequest,
  ResourceGetResponse,
  ResourceListRequest,
  ResourceListResponse,
  ResourceMutationRequest,
  ResourceMutationResponse,
  ResourceSearchRequest,
  ResourceWatchBatch,
  UpdaterSnapshot,
} from "../shared/types";

const channels = {
  appVersion: "app:version",
  appCommand: "app:command",
  updaterState: "updater:state",
  updaterCheck: "updater:check",
  updaterDownload: "updater:download",
  updaterInstall: "updater:install",
  updaterStateChanged: "updater:state-changed",
  setThemeSource: "appearance:set-theme-source",
  coreStatus: "core:status",
  coreStatusChanged: "core:status-changed",
  setReadOnly: "safety:set-read-only",
  contextsList: "contexts:list",
  settingsGet: "settings:get",
  settingsSetSources: "settings:set-kubeconfig-sources",
  settingsApplySources: "settings:apply-kubeconfig-sources",
  settingsPickFile: "settings:pick-kubeconfig-file",
  settingsPickFolder: "settings:pick-kubeconfig-folder",
  discoveryList: "discovery:list",
  namespacesList: "namespaces:list",
  metricsPods: "metrics:pods",
  resourcesList: "resources:list",
  resourcesGet: "resources:get",
  resourcesEvents: "resources:events",
  resourcesRelated: "resources:related",
  resourcesSearch: "resources:search",
  podLogs: "pods:logs",
  podLogsFollowStart: "pods:logs-follow-start",
  podLogsFollowStop: "pods:logs-follow-stop",
  podLogsFollowEvent: "pods:logs-follow-event",
  podExec: "pods:exec",
  portForwardStart: "pods:portforward-start",
  portForwardStop: "pods:portforward-stop",
  resourcesMutate: "resources:mutate",
  resourceWatchStart: "resources:watch-start",
  resourceWatchStop: "resources:watch-stop",
  resourceWatchEvent: "resources:watch-event",
} as const;

type StopListening = () => void;
let subscriptionSequence = 0;

function invoke<Result>(channel: string, ...arguments_: unknown[]): Promise<Result> {
  return ipcRenderer.invoke(channel, ...arguments_) as Promise<Result>;
}

function listen<Payload>(channel: string, listener: (payload: Payload) => void): StopListening {
  const forward = (_event: Electron.IpcRendererEvent, payload: Payload) => listener(payload);
  ipcRenderer.on(channel, forward);
  return () => ipcRenderer.removeListener(channel, forward);
}

interface StreamChannels {
  start: string;
  stop: string;
  event: string;
  prefix: string;
}

function startStream<Request, Batch extends { subscriptionId: string }>(
  streamChannels: StreamChannels,
  request: Request,
  listener: (batch: Batch) => void,
): StopListening {
  const subscriptionId = `${streamChannels.prefix}-${process.pid}-${++subscriptionSequence}`;
  const removeEventListener = listen<Batch>(streamChannels.event, (batch) => {
    if (batch.subscriptionId === subscriptionId) listener(batch);
  });
  ipcRenderer.send(streamChannels.start, subscriptionId, request);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    removeEventListener();
    ipcRenderer.send(streamChannels.stop, subscriptionId);
  };
}

const resourceWatchChannels: StreamChannels = {
  start: channels.resourceWatchStart,
  stop: channels.resourceWatchStop,
  event: channels.resourceWatchEvent,
  prefix: "resource-watch",
};
const logFollowChannels: StreamChannels = {
  start: channels.podLogsFollowStart,
  stop: channels.podLogsFollowStop,
  event: channels.podLogsFollowEvent,
  prefix: "logs-follow",
};

const api: DesktopApi = {
  platform: process.platform,
  app: {
    version: () => invoke<string>(channels.appVersion),
    onCommand: (listener) => listen<AppCommand>(channels.appCommand, listener),
  },
  updater: {
    state: () => invoke<UpdaterSnapshot>(channels.updaterState),
    check: () => invoke<void>(channels.updaterCheck),
    download: () => invoke<void>(channels.updaterDownload),
    install: () => invoke<void>(channels.updaterInstall),
    onState: (listener) => listen<UpdaterSnapshot>(channels.updaterStateChanged, listener),
  },
  appearance: {
    setThemeSource: (theme) => invoke<void>(channels.setThemeSource, theme),
  },
  core: {
    status: () => invoke<CoreStatus>(channels.coreStatus),
    onStatus: (listener) => listen<CoreStatus>(channels.coreStatusChanged, listener),
  },
  safety: {
    setReadOnly: (contextId, readOnly) => invoke<void>(channels.setReadOnly, contextId, readOnly),
  },
  contexts: {
    list: () => invoke<ContextInfo[]>(channels.contextsList),
  },
  settings: {
    get: () => invoke<AsterSettings>(channels.settingsGet),
    setKubeconfigSources: (sources) => invoke<AsterSettings>(channels.settingsSetSources, sources),
    applyKubeconfigSources: (sources) => invoke<void>(channels.settingsApplySources, sources),
    pickKubeconfigFile: () => invoke<string | null>(channels.settingsPickFile),
    pickKubeconfigFolder: () => invoke<string | null>(channels.settingsPickFolder),
  },
  discovery: {
    list: (contextId) => invoke<DiscoveredResource[]>(channels.discoveryList, contextId),
  },
  namespaces: {
    list: (contextId) => invoke<NamespaceInfo[]>(channels.namespacesList, contextId),
  },
  metrics: {
    pods: (contextId, namespace) => invoke<PodMetric[]>(channels.metricsPods, contextId, namespace),
  },
  resources: {
    list: (request: ResourceListRequest) => invoke<ResourceListResponse>(channels.resourcesList, request),
    get: (request: ResourceGetRequest) => invoke<ResourceGetResponse>(channels.resourcesGet, request),
    events: (request: ResourceGetRequest) => invoke<ResourceEvent[]>(channels.resourcesEvents, request),
    related: (request: ResourceGetRequest) => invoke<RelatedResource[]>(channels.resourcesRelated, request),
    search: (request: ResourceSearchRequest) => invoke<RelatedResource[]>(channels.resourcesSearch, request),
    logs: (request: PodLogsRequest) => invoke<PodLogsResponse>(channels.podLogs, request),
    followLogs: (request: PodLogsRequest, listener: (batch: LogStreamBatch) => void) => (
      startStream<PodLogsRequest, LogStreamBatch>(logFollowChannels, request, listener)
    ),
    exec: (request: PodExecRequest) => invoke<PodExecResponse>(channels.podExec, request),
    portForwardStart: (request: PortForwardStartRequest) => (
      invoke<PodPortForward>(channels.portForwardStart, request)
    ),
    portForwardStop: (id: string) => invoke<void>(channels.portForwardStop, id),
    mutate: (request: ResourceMutationRequest) => (
      invoke<ResourceMutationResponse>(channels.resourcesMutate, request)
    ),
    watch: (request: ResourceListRequest, listener: (batch: ResourceWatchBatch) => void) => (
      startStream<ResourceListRequest, ResourceWatchBatch>(resourceWatchChannels, request, listener)
    ),
  },
};

contextBridge.exposeInMainWorld("aster", api);
