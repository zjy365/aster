/**
 * Live web-test shim for the desktop API. Injected into the Vite-served
 * renderer by Playwright (desktop.ts prefers window.__ASTER_DESKTOP__ over
 * the Tauri transport), so the real app UI runs in a plain browser while all
 * core calls go to the REAL running sidecar through a same-origin /__core__
 * prefix that the Playwright route in support.ts proxies with the bearer
 * token. The token itself never enters page JavaScript.
 *
 * Method-for-method this mirrors renderer/lib/desktop-tauri.ts; two surfaces
 * are simplified for the harness:
 *   - resources.watch delivers the initial list snapshot only (no live
 *     deltas): the proxy fulfills whole responses, so a never-ending ndjson
 *     stream cannot pass through it. Tables render; live updates do not.
 *   - Shell-only features (native dialogs, updater, log follow, exec,
 *     port-forward) are inert stubs — tests must not depend on them.
 */
import type {
  DesktopApi,
  HelmReleaseDetail,
  HelmReleaseSummary,
  NamespaceInfo,
  Overview,
  ResourceListRequest,
  ResourceWatchBatch,
} from "../../src/shared/types";
import {
  type CoreListResponse,
  type CoreOverview,
  type CoreResourceRow,
  discoveredResourceList,
  normalizeRow,
  podMetricList,
  relatedResourceList,
  resourceEventList,
} from "../../src/shared/normalize";

async function parseCoreResponse(response: Response, path: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new Error(`core ${path}: ${message}`);
  }
  return text ? JSON.parse(text) : {};
}

async function coreGet(path: string): Promise<any> {
  return parseCoreResponse(await fetch(`/__core__${path}`), path);
}

async function corePost(path: string, body: unknown): Promise<any> {
  return parseCoreResponse(await fetch(`/__core__${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }), path);
}

function gvr(kind: ResourceListRequest["resourceKind"]): { group: string; version: string; resource: string } {
  return { group: kind.group, version: kind.version, resource: kind.resource };
}

function unsupported(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} is not available in the live web harness`));
}

/** Mirrors the Rust namespaces_list pager: full inventory, {name,status} rows. */
async function listAllNamespaces(contextId: string): Promise<{ namespaces: NamespaceInfo[]; truncated: boolean }> {
  const namespaces: NamespaceInfo[] = [];
  let continueToken = "";
  let truncated = false;
  for (let page = 0; page < 40; page += 1) {
    let query = `contextId=${encodeURIComponent(contextId)}&limit=5000`;
    if (continueToken) query += `&continueToken=${encodeURIComponent(continueToken)}`;
    let value: any;
    try {
      value = await coreGet(`/v1/namespaces?${query}`);
    } catch {
      truncated = true;
      break;
    }
    for (const item of value.items ?? []) {
      namespaces.push({ name: item.name, ...(item.status ? { status: item.status } : {}) } as NamespaceInfo);
    }
    continueToken = typeof value.continueToken === "string" ? value.continueToken : "";
    if (!continueToken) break;
  }
  return { namespaces, truncated: truncated || Boolean(continueToken) };
}

const api: DesktopApi = {
  platform: "darwin",
  app: {
    version: () => Promise.resolve("live-web"),
    onCommand: () => () => {},
    openExternal: () => Promise.resolve(),
  },
  updater: {
    state: () => Promise.resolve({ state: "idle", currentVersion: "live-web" }),
    check: () => Promise.resolve(),
    download: () => Promise.resolve(),
    install: () => Promise.resolve(),
    onState: () => () => {},
  },
  appearance: {
    setThemeSource: () => Promise.resolve(),
  },
  files: {
    saveTextFile: () => Promise.resolve(null),
  },
  core: {
    status: () => Promise.resolve({ state: "ready" }),
    onStatus: () => () => {},
  },
  contexts: {
    list: async () => (await coreGet("/v1/contexts")).contexts ?? [],
    health: async (contextIds) => (await corePost("/v1/contexts/health", { contextIds })).health ?? [],
    sourcesReport: () => coreGet("/v1/sources"),
    renameConflict: async (request) => { await corePost("/v1/sources/rename", request); },
  },
  settings: {
    get: () => Promise.resolve({ kubeconfigSources: [], includeStandardChain: false }),
    setKubeconfigSources: (sources, includeStandardChain) => Promise.resolve({ kubeconfigSources: sources, includeStandardChain }),
    pickKubeconfigFile: () => Promise.resolve(null),
    pickKubeconfigFolder: () => Promise.resolve(null),
    applyKubeconfigSources: () => Promise.resolve(),
  },
  discovery: {
    list: async (contextId) => discoveredResourceList(await coreGet(`/v1/discovery?contextId=${encodeURIComponent(contextId)}`)),
  },
  namespaces: {
    list: (contextId) => listAllNamespaces(contextId),
  },
  metrics: {
    pods: async (contextId, namespace) => podMetricList(await corePost("/v1/metrics/pods", { contextId, namespace })),
  },
  overview: {
    get: async (contextId): Promise<Overview> => {
      const value = (await coreGet(`/v1/overview?contextId=${encodeURIComponent(contextId)}`)) as CoreOverview;
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
      const value = await coreGet(`/v1/helm/releases?contextId=${encodeURIComponent(contextId)}&namespace=${encodeURIComponent(namespace)}`);
      return value.releases ?? [];
    },
    get: async (request): Promise<HelmReleaseDetail> => (await corePost("/v1/helm/releases/get", request)).release,
    uninstall: async (request) => { await corePost("/v1/helm/releases/uninstall", request); },
    rollback: async (request) => { await corePost("/v1/helm/releases/rollback", request); },
    upgrade: (request) => corePost("/v1/helm/releases/upgrade", request),
  },
  resources: {
    list: async (request) => {
      const response = (await corePost("/v1/resources/list", {
        contextId: request.contextId,
        gvr: gvr(request.resourceKind),
        namespace: request.namespace,
        limit: request.limit,
        continueToken: request.continueToken,
        labelSelector: request.labelSelector,
        fieldSelector: request.fieldSelector,
      })) as CoreListResponse;
      return {
        items: response.items.map(normalizeRow),
        ...(response.continueToken ? { continueToken: response.continueToken } : {}),
        ...(response.resourceVersion ? { resourceVersion: response.resourceVersion } : {}),
      };
    },
    get: async (request) => {
      const response = await corePost("/v1/resources/get", {
        contextId: request.contextId,
        gvr: gvr(request.resourceKind),
        namespace: request.namespace,
        name: request.name,
      });
      return { row: normalizeRow(response.resource as CoreResourceRow), yaml: response.yaml };
    },
    events: async (request) => {
      const response = (await corePost("/v1/resources/list", {
        contextId: request.contextId,
        gvr: { group: "", version: "v1", resource: "events" },
        namespace: request.namespace,
        limit: 100,
        fieldSelector: `involvedObject.name=${request.name}`,
      })) as CoreListResponse;
      return resourceEventList(response.items);
    },
    related: async (request) => relatedResourceList(await corePost("/v1/resources/related", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      name: request.name,
    })),
    search: async (request) => relatedResourceList(await corePost("/v1/resources/search", {
      contextId: request.contextId,
      query: request.query,
      namespace: request.namespace,
    })),
    logs: (request) => corePost("/v1/pods/logs", request),
    followLogs: () => () => {},
    workloadLogs: (request) => corePost("/v1/workloads/logs", request),
    followWorkloadLogs: () => () => {},
    portForwardStart: () => unsupported("portForwardStart"),
    portForwardStop: () => Promise.resolve(),
    exec: () => unsupported("exec"),
    mutate: (request) => corePost("/v1/resources/mutate", {
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
    }),
    // Snapshot-only watch: one list call delivered as a snapshot batch, no
    // live deltas (the /__core__ proxy cannot relay a never-ending stream).
    watch: (request, listener) => {
      let active = true;
      corePost("/v1/resources/list", {
        contextId: request.contextId,
        gvr: gvr(request.resourceKind),
        namespace: request.namespace,
        limit: request.limit ?? 500,
        labelSelector: request.labelSelector,
        fieldSelector: request.fieldSelector,
      }).then((response: CoreListResponse) => {
        if (!active) return;
        const batch: ResourceWatchBatch = {
          subscriptionId: "live-watch",
          kind: "snapshot",
          items: response.items.map(normalizeRow),
          ...(response.continueToken ? { continueToken: response.continueToken } : {}),
          ...(response.resourceVersion ? { resourceVersion: response.resourceVersion } : {}),
        };
        listener(batch);
      }).catch((cause: unknown) => {
        if (!active) return;
        listener({ subscriptionId: "live-watch", kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
      });
      return () => { active = false; };
    },
  },
};

(window as unknown as { __ASTER_DESKTOP__: DesktopApi }).__ASTER_DESKTOP__ = api;
