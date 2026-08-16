import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type {
  AppearanceTheme,
  ContextInfo,
  DiscoveredResource,
  NamespaceInfo,
  PodMetric,
  PodPortForward,
  RelatedResource,
  ResourceEvent,
  ResourceGetResponse,
  ResourceListResponse,
  PodExecResponse,
  PodLogsResponse,
  ResourceMutationResponse,
} from "../shared/types";
import type { CoreTransport, LogFollowSupervisor, WatchSupervisor } from "./core-transport";
import type { Sidecar } from "./sidecar";
import {
  discoveredResourceList,
  gvr,
  normalizeRow,
  podExecRequest,
  podLogsRequest,
  podMetricList,
  portForwardStartRequest,
  portForwardStopRequest,
  readOnlyFlagValue,
  relatedResourceList,
  resourceGetRequest,
  resourceListRequest,
  resourceMutationRequest,
  resourceSearchRequest,
  requiredTextField,
  themeSourceValue,
  type CoreListResponse,
} from "./validation";
import type { WriteSafetyPolicy } from "./write-safety";
import type { SettingsFile } from "./settings";
import { normalizeSources } from "./settings";
import type { AppUpdater } from "./updater";
import type { AsterSettings, UpdaterSnapshot } from "../shared/types";

const updaterStateChannel = "updater:state-changed";

export interface IpcDeps {
  getWindow(): BrowserWindow | undefined;
  sidecar: Sidecar;
  transport: CoreTransport;
  watches: WatchSupervisor;
  logsFollow: LogFollowSupervisor;
  writeSafety: WriteSafetyPolicy;
  setThemeSource(theme: AppearanceTheme): void;
  appVersion(): string;
  updater?: AppUpdater;
  /** Settings persistence + apply (restarts the core with new sources). */
  settingsFile: SettingsFile;
  applySettings(settings: AsterSettings): void;
  pickFile(window: BrowserWindow | undefined): Promise<string | null>;
  pickFolder(window: BrowserWindow | undefined): Promise<string | null>;
}

/**
 * Registers every IPC channel. validateSender runs inside the handle/on
 * wrappers below, so no handler can be reached by an untrusted frame without
 * going through this module — keep it that way when adding channels.
 */
export function registerIpc(deps: IpcDeps): void {
  const { sidecar, transport, watches, logsFollow, writeSafety, settingsFile, applySettings, pickFile, pickFolder } = deps;

  function validateSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
    const window = deps.getWindow();
    if (!window || event.sender.id !== window.webContents.id) throw new Error("Untrusted IPC sender");
    if (!event.senderFrame || event.senderFrame !== window.webContents.mainFrame) throw new Error("Untrusted IPC frame");
    const url = new URL(event.senderFrame.url);
    if (url.protocol === "file:") return;
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.origin === new URL(devServer).origin) return;
    throw new Error("Untrusted IPC origin");
  }

  function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, async (event, ...args) => {
      validateSender(event);
      return listener(event, ...args);
    });
  }

  function on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void {
    ipcMain.on(channel, (event, ...args) => {
      validateSender(event);
      listener(event, ...args);
    });
  }

  handle("core:status", () => sidecar.status);

  handle("app:version", () => deps.appVersion());

  if (deps.updater) {
    const updater = deps.updater;
    const forwardState = (snapshot: UpdaterSnapshot) => {
      const contents = deps.getWindow()?.webContents;
      if (contents && !contents.isDestroyed()) contents.send(updaterStateChannel, snapshot);
    };
    updater.on("state-changed", forwardState);

    handle("updater:state", () => updater.currentState());
    handle("updater:check", () => updater.check());
    handle("updater:download", () => updater.download());
    handle("updater:install", () => updater.install());
  }

  handle("appearance:set-theme-source", (_event, rawTheme: unknown) => {
    deps.setThemeSource(themeSourceValue(rawTheme));
  });

  handle("safety:set-read-only", (_event, rawContextId: unknown, rawReadOnly: unknown) => {
    const contextId = requiredContextId(rawContextId);
    writeSafety.setReadOnly(contextId, readOnlyFlagValue(rawReadOnly));
  });

  handle("contexts:list", async () => {
    const value = await transport.request<{ contexts: ContextInfo[] }>("/v1/contexts");
    return value.contexts;
  });

  handle("settings:get", async (): Promise<AsterSettings> => settingsFile.read());

  handle("settings:set-kubeconfig-sources", async (_event, input: unknown): Promise<AsterSettings> => {
    const settings = { kubeconfigSources: normalizeSources(input) };
    settingsFile.write(settings);
    return settings;
  });

  handle("settings:apply-kubeconfig-sources", async (_event, input: unknown): Promise<void> => {
    const settings = { kubeconfigSources: normalizeSources(input) };
    settingsFile.write(settings);
    applySettings(settings);
  });

  handle("settings:pick-kubeconfig-file", async (event): Promise<string | null> => {
    const window = getWindowForPicker(event);
    return pickFile(window);
  });

  handle("settings:pick-kubeconfig-folder", async (event): Promise<string | null> => {
    const window = getWindowForPicker(event);
    return pickFolder(window);
  });

  handle("namespaces:list", async (_event, contextId: unknown): Promise<NamespaceInfo[]> => {
    const validContext = requiredContextId(contextId);
    // Follow continueToken until the list is complete: clusters can have far
    // more than one page (500) of namespaces, and the picker must see them all.
    const namespaces: NamespaceInfo[] = [];
    let continueToken = "";
    for (let page = 0; page < 40; page++) {
      const query = `contextId=${encodeURIComponent(validContext)}&limit=500${continueToken ? `&continueToken=${encodeURIComponent(continueToken)}` : ""}`;
      const value = await transport.request<CoreListResponse>(`/v1/namespaces?${query}`);
      namespaces.push(...value.items.map((item) => ({ name: item.name, ...(item.status ? { status: item.status } : {}) })));
      if (!value.continueToken) return namespaces;
      continueToken = value.continueToken;
    }
    return namespaces;
  });

  handle("discovery:list", async (_event, contextId: unknown): Promise<DiscoveredResource[]> => {
    const validContext = requiredContextId(contextId);
    const value = await transport.request<unknown>(`/v1/discovery?contextId=${encodeURIComponent(validContext)}`);
    return discoveredResourceList(value);
  });

  handle("resources:related", async (_event, input: unknown): Promise<RelatedResource[]> => {
    const request = resourceGetRequest(input);
    const response = await transport.request<unknown>("/v1/resources/related", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      name: request.name,
    });
    return relatedResourceList(response);
  });

  handle("resources:search", async (_event, input: unknown): Promise<RelatedResource[]> => {
    const request = resourceSearchRequest(input);
    const response = await transport.request<unknown>("/v1/resources/search", {
      contextId: request.contextId,
      query: request.query,
      namespace: request.namespace,
    });
    return relatedResourceList(response);
  });

  handle("resources:list", async (_event, input: unknown): Promise<ResourceListResponse> => {
    const request = resourceListRequest(input);
    const response = await transport.request<CoreListResponse>("/v1/resources/list", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      limit: request.limit,
      continueToken: request.continueToken,
      labelSelector: request.labelSelector,
      fieldSelector: request.fieldSelector,
    });
    return { ...response, items: response.items.map(normalizeRow) };
  });

  handle("resources:get", async (_event, input: unknown): Promise<ResourceGetResponse> => {
    const request = resourceGetRequest(input);
    const response = await transport.request<{ resource: Parameters<typeof normalizeRow>[0]; yaml: string }>("/v1/resources/get", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      name: request.name,
    });
    return { row: normalizeRow(response.resource), yaml: response.yaml };
  });

  handle("resources:events", async (_event, input: unknown): Promise<ResourceEvent[]> => {
    const request = resourceGetRequest(input);
    const response = await transport.request<CoreListResponse>("/v1/resources/list", {
      contextId: request.contextId,
      gvr: { group: "", version: "v1", resource: "events" },
      namespace: request.namespace,
      limit: 100,
      fieldSelector: `involvedObject.name=${request.name}`,
    });
    return response.items.map((item) => ({
      name: item.name,
      namespace: item.namespace || "",
      reason: item.reason,
      message: item.message,
      type: item.type,
      count: item.count,
      lastTimestamp: item.lastTimestamp,
    }));
  });

  handle("pods:logs", async (_event, input: unknown): Promise<PodLogsResponse> => {
    return transport.request<PodLogsResponse>("/v1/pods/logs", podLogsRequest(input));
  });

  handle("pods:exec", async (_event, input: unknown): Promise<PodExecResponse> => {
    const request = podExecRequest(input);
    writeSafety.assertWriteAllowed(request.contextId, "Pod exec");
    return transport.request<PodExecResponse>("/v1/pods/exec", request);
  });

  handle("resources:mutate", async (_event, input: unknown): Promise<ResourceMutationResponse> => {
    const request = resourceMutationRequest(input);
    writeSafety.assertWriteAllowed(request.contextId, `Resource ${request.operation}`);
    return transport.request<ResourceMutationResponse>("/v1/resources/mutate", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      name: request.name,
      operation: request.operation,
      replicas: request.replicas,
      image: request.image,
      container: request.container,
      yaml: request.yaml,
      dryRun: request.dryRun,
      resourceVersion: request.resourceVersion,
    });
  });

  on("resources:watch-start", (event, rawSubscriptionId: unknown, input: unknown) => {
    const subscriptionId = requiredSubscriptionId(rawSubscriptionId);
    const request = resourceListRequest(input);
    watches.start(subscriptionId, request, event.sender);
  });

  on("resources:watch-stop", (event, rawSubscriptionId: unknown) => {
    watches.stop(requiredSubscriptionId(rawSubscriptionId), event.sender.id);
  });

  on("pods:logs-follow-start", (event, rawSubscriptionId: unknown, input: unknown) => {
    const subscriptionId = requiredSubscriptionId(rawSubscriptionId);
    const request = podLogsRequest(input);
    logsFollow.start(subscriptionId, request, event.sender);
  });

  on("pods:logs-follow-stop", (event, rawSubscriptionId: unknown) => {
    logsFollow.stop(requiredSubscriptionId(rawSubscriptionId), event.sender.id);
  });

  handle("metrics:pods", async (_event, contextId: unknown, namespace: unknown): Promise<PodMetric[]> => {
    const validContext = requiredContextId(contextId);
    const value = await transport.request<unknown>("/v1/metrics/pods", {
      contextId: validContext,
      namespace: namespace === undefined ? undefined : requiredTextField(namespace, "namespace", 253),
    });
    return podMetricList(value);
  });

  handle("pods:portforward-start", async (_event, input: unknown): Promise<PodPortForward> => {
    const request = portForwardStartRequest(input);
    writeSafety.assertWriteAllowed(request.contextId, "Pod port forward");
    return transport.request<PodPortForward>("/v1/pods/portforward", {
      contextId: request.contextId,
      namespace: request.namespace,
      name: request.name,
      podPort: request.podPort,
    });
  });

  handle("pods:portforward-stop", async (_event, input: unknown): Promise<void> => {
    const id = portForwardStopRequest(input);
    await transport.request<unknown>("/v1/pods/portforward/stop", { id });
  });
}

function getWindowForPicker(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  // Only attach the sheet to a window we already trust; the sender check in
  // the handle() wrapper already proved this frame is the main window.
  return window && !window.isDestroyed() ? window : undefined;
}

function requiredContextId(value: unknown): string {
  return requiredTextField(value, "contextId", 512);
}

function requiredSubscriptionId(value: unknown): string {
  return requiredTextField(value, "subscriptionId", 160);
}
