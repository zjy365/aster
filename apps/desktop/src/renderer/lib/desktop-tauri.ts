import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppCommand,
  AsterSettings,
  ContextInfo,
  CoreStatus,
  DesktopApi,
  HelmGetRequest,
  HelmReleaseDetail,
  HelmReleaseSummary,
  HelmRollbackRequest,
  HelmUninstallRequest,
  HelmUpgradeRequest,
  HelmUpgradeResponse,
  LogStreamBatch,
  NamespaceInfo,
  Overview,
  PodLogsRequest,
  ResourceGetRequest,
  ResourceListRequest,
  ResourceWatchBatch,
  SourcesReport,
  RenameConflictRequest,
  UpdaterSnapshot,
} from "../../shared/types";
import {
  type CoreListResponse,
  type CoreOverview,
  type CoreResourceRow,
  discoveredResourceList,
  normalizeRow,
  podMetricList,
  relatedResourceList,
  resourceEventList,
} from "../../shared/normalize";

/**
 * Tauri implementation of DesktopApi. The Rust side is a thin authenticated
 * proxy over the Go core's HTTP API: request bodies are shaped here exactly
 * like the Electron main process shaped them, and responses are normalized
 * with the shared pure functions so both shells behave identically.
 */

function detectPlatform(): NodeJS.Platform {
  const agent = window.navigator.userAgent;
  if (agent.includes("Windows")) return "win32";
  if (agent.includes("Linux")) return "linux";
  return "darwin";
}

function gvr(kind: ResourceListRequest["resourceKind"]): { group: string; version: string; resource: string } {
  return { group: kind.group, version: kind.version, resource: kind.resource };
}

function listenEvent<Payload>(event: string, listener: (payload: Payload) => void): () => void {
  const unlisten = listen<Payload>(event, (emitted) => listener(emitted.payload));
  return () => void unlisten.then((dispose) => dispose());
}

let subscriptionSequence = 0;

/** Normalizes the raw core rows inside a watch batch pushed by the Rust supervisor. */
function normalizeWatchBatch(batch: ResourceWatchBatch): ResourceWatchBatch {
  if (batch.kind === "snapshot") {
    return { ...batch, items: batch.items.map((item) => normalizeRow(item as CoreResourceRow)) };
  }
  if (batch.kind === "delta") {
    return {
      ...batch,
      events: batch.events.map((event) => (
        event.type === "deleted" ? event : { ...event, row: normalizeRow(event.row as CoreResourceRow) }
      )),
    };
  }
  return batch;
}

export function createTauriDesktopApi(): DesktopApi {
  return {
    platform: detectPlatform(),
    app: {
      version: () => invoke<string>("app_version"),
      onCommand: (listener) => listenEvent<AppCommand>("app:command", listener),
      openExternal: (url) => invoke<void>("app_open_external", { url }),
    },
    updater: {
      state: () => invoke<UpdaterSnapshot>("updater_state"),
      check: () => invoke<void>("updater_check"),
      download: () => invoke<void>("updater_download"),
      install: () => invoke<void>("updater_install"),
      onState: (listener) => listenEvent<UpdaterSnapshot>("updater:state-changed", listener),
    },
    appearance: {
      setThemeSource: (theme) => invoke<void>("appearance_set_theme_source", { theme }),
    },
    files: {
      saveTextFile: (defaultName, content) => invoke<string | null>("save_text_file", { defaultName, content }),
    },
    core: {
      status: () => invoke<CoreStatus>("core_status"),
      onStatus: (listener) => listenEvent<CoreStatus>("core:status-changed", listener),
    },
    contexts: {
      list: async () => {
        const value = await invoke<{ contexts: ContextInfo[] }>("contexts_list");
        return value.contexts;
      },
      sourcesReport: () => invoke<SourcesReport>("sources_report"),
      renameConflict: async (request) => {
        await invoke("sources_rename", { request });
      },
    },
    settings: {
      get: () => invoke<AsterSettings>("settings_get"),
      setKubeconfigSources: (sources, includeStandardChain) =>
        invoke<AsterSettings>("settings_set_kubeconfig_sources", { sources, includeStandardChain }),
      applyKubeconfigSources: (sources, includeStandardChain) =>
        invoke<void>("settings_apply_kubeconfig_sources", { sources, includeStandardChain }),
      pickKubeconfigFile: () => invoke<string | null>("settings_pick_kubeconfig_file"),
      pickKubeconfigFolder: () => invoke<string | null>("settings_pick_kubeconfig_folder"),
    },
    discovery: {
      list: async (contextId) => discoveredResourceList(await invoke("discovery_list", { contextId })),
    },
    namespaces: {
      list: async (contextId) => {
        const value = await invoke<{ namespaces: NamespaceInfo[]; truncated?: boolean }>("namespaces_list", { contextId });
        return {
          namespaces: value.namespaces || [],
          truncated: Boolean(value.truncated),
        };
      },
    },
    metrics: {
      pods: async (contextId, namespace) => podMetricList(await invoke("metrics_pods", { request: { contextId, namespace } })),
    },
    overview: {
      get: async (contextId): Promise<Overview> => {
        const value = await invoke<CoreOverview>("overview_get", { contextId });
        return {
          nodes: value.nodes,
          pods: value.pods,
          namespaces: value.namespaces,
          services: value.services,
          resource: value.resource,
          events: (value.events || []).map((event) => ({ ...event, namespace: event.namespace || "" })),
          ...(value.truncated ? { truncated: true } : {}),
        };
      },
    },
    helm: {
      list: async (contextId, namespace): Promise<HelmReleaseSummary[]> => {
        const value = await invoke<{ releases: HelmReleaseSummary[] }>("helm_releases_list", { contextId, namespace });
        return value.releases;
      },
      get: async (request: HelmGetRequest): Promise<HelmReleaseDetail> => {
        const value = await invoke<{ release: HelmReleaseDetail }>("helm_releases_get", { request });
        return value.release;
      },
      uninstall: async (request: HelmUninstallRequest): Promise<void> => {
        await invoke("helm_releases_uninstall", { request });
      },
      rollback: async (request: HelmRollbackRequest): Promise<void> => {
        await invoke("helm_releases_rollback", { request });
      },
      upgrade: async (request: HelmUpgradeRequest): Promise<HelmUpgradeResponse> => {
        return invoke<HelmUpgradeResponse>("helm_releases_upgrade", { request });
      },
    },
    resources: {
      list: async (request: ResourceListRequest) => {
        const response = await invoke<CoreListResponse>("resources_list", {
          request: {
            contextId: request.contextId,
            gvr: gvr(request.resourceKind),
            namespace: request.namespace,
            limit: request.limit,
            continueToken: request.continueToken,
            labelSelector: request.labelSelector,
            fieldSelector: request.fieldSelector,
          },
        });
        return {
          items: response.items.map(normalizeRow),
          ...(response.continueToken ? { continueToken: response.continueToken } : {}),
          ...(response.resourceVersion ? { resourceVersion: response.resourceVersion } : {}),
        };
      },
      get: async (request: ResourceGetRequest) => {
        const response = await invoke<{ resource: CoreResourceRow; yaml: string }>("resources_get", {
          request: {
            contextId: request.contextId,
            gvr: gvr(request.resourceKind),
            namespace: request.namespace,
            name: request.name,
          },
        });
        return { row: normalizeRow(response.resource), yaml: response.yaml };
      },
      events: async (request: ResourceGetRequest) => {
        const response = await invoke<CoreListResponse>("resources_list", {
          request: {
            contextId: request.contextId,
            gvr: { group: "", version: "v1", resource: "events" },
            namespace: request.namespace,
            limit: 100,
            fieldSelector: `involvedObject.name=${request.name}`,
          },
        });
        return resourceEventList(response.items);
      },
      related: async (request: ResourceGetRequest) => relatedResourceList(await invoke("resources_related", {
        request: {
          contextId: request.contextId,
          gvr: gvr(request.resourceKind),
          namespace: request.namespace,
          name: request.name,
        },
      })),
      search: async (request) => relatedResourceList(await invoke("resources_search", {
        request: { contextId: request.contextId, query: request.query, namespace: request.namespace },
      })),
      logs: (request: PodLogsRequest) => invoke("pods_logs", { request }),
      workloadLogs: (request) => invoke("workloads_logs", { request }),
      followWorkloadLogs: (request, listener) => {
        const id = `logs-follow-${++subscriptionSequence}`;
        const channel = new Channel<LogStreamBatch>();
        channel.onmessage = listener;
        void invoke("workloads_logs_follow_start", { id, request, channel });
        return () => void invoke("workloads_logs_follow_stop", { id });
      },
      followLogs: (request: PodLogsRequest, listener: (batch: LogStreamBatch) => void) => {
        const id = `logs-follow-${++subscriptionSequence}`;
        const channel = new Channel<LogStreamBatch>();
        channel.onmessage = listener;
        void invoke("pods_logs_follow_start", { id, request, channel });
        return () => void invoke("pods_logs_follow_stop", { id });
      },
      exec: (request) => invoke("pods_exec", { request }),
      portForwardStart: (request) => invoke("pods_portforward_start", { request }),
      portForwardStop: (id) => invoke<void>("pods_portforward_stop", { request: { id } }),
      mutate: (request) => invoke("resources_mutate", {
        request: {
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
        },
      }),
      watch: (request: ResourceListRequest, listener: (batch: ResourceWatchBatch) => void) => {
        const id = `resource-watch-${++subscriptionSequence}`;
        const channel = new Channel<ResourceWatchBatch>();
        channel.onmessage = (batch) => listener(normalizeWatchBatch(batch));
        void invoke("resources_watch_start", {
          id,
          request: {
            contextId: request.contextId,
            gvr: gvr(request.resourceKind),
            namespace: request.namespace,
            limit: request.limit,
            labelSelector: request.labelSelector,
            fieldSelector: request.fieldSelector,
          },
          channel,
        });
        return () => void invoke("resources_watch_stop", { id });
      },
    },
  };
}
