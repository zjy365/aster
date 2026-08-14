import type { WebContents } from "electron";
import type {
  LogStreamBatch,
  PodLogsRequest,
  ResourceListRequest,
  ResourceListResponse,
  ResourceWatchBatch,
  ResourceWatchEvent,
} from "../shared/types";
import {
  gvr,
  messageOf,
  normalizeRow,
  resourceKey,
  type CoreListResponse,
  type CoreResourceRow,
} from "./validation";

/** The minimal credential surface the transport needs from the sidecar owner. */
export interface SidecarGateway {
  credentials(): { baseUrl: string; token: string };
}

/**
 * HTTP transport to the Go sidecar. Holds no token or URL itself; every
 * request resolves fresh credentials so a sidecar restart cannot strand
 * callers with a stale bearer token.
 */
export class CoreTransport {
  constructor(private readonly sidecar: SidecarGateway) {}

  async request<T>(pathname: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const { baseUrl, token } = this.sidecar.credentials();
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const value = await response.json() as T | { error?: { message?: string }; message?: string };
    if (!response.ok) {
      const error = value as { error?: { message?: string }; message?: string };
      throw new Error(error.error?.message || error.message || `Core request failed (${response.status})`);
    }
    return value as T;
  }

  async listWatchPage(request: ResourceListRequest, signal: AbortSignal, continueToken?: string): Promise<ResourceListResponse> {
    const response = await this.request<CoreListResponse>("/v1/resources/list", {
      contextId: request.contextId,
      gvr: gvr(request.resourceKind),
      namespace: request.namespace,
      limit: Math.min(request.limit ?? 500, 500),
      continueToken,
      labelSelector: request.labelSelector,
      fieldSelector: request.fieldSelector,
    }, signal);
    return {
      items: response.items.map(normalizeRow),
      ...(response.continueToken ? { continueToken: response.continueToken } : {}),
      ...(response.resourceVersion ? { resourceVersion: response.resourceVersion } : {}),
    };
  }

  async openWatchStream(request: ResourceListRequest, resourceVersion: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const { baseUrl, token } = this.sidecar.credentials();
    const timeout = AbortSignal.timeout(65_000);
    const response = await fetch(`${baseUrl}/v1/resources/watch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contextId: request.contextId, gvr: gvr(request.resourceKind), namespace: request.namespace, resourceVersion, labelSelector: request.labelSelector, fieldSelector: request.fieldSelector }),
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok || !response.body) {
      const value = await response.text();
      throw new Error(`Watch request failed (${response.status}): ${value.slice(0, 500)}`);
    }
    return response.body;
  }

  async openLogsStream(request: PodLogsRequest, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const { baseUrl, token } = this.sidecar.credentials();
    const response = await fetch(`${baseUrl}/v1/pods/logs/stream`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contextId: request.contextId, namespace: request.namespace, name: request.name, container: request.container, tailLines: request.tailLines }),
      signal,
    });
    if (!response.ok || !response.body) {
      const value = await response.text();
      throw new Error(`Logs stream request failed (${response.status}): ${value.slice(0, 500)}`);
    }
    return response.body;
  }
}

export interface CoreWatchEvent {
  type: string;
  resource?: CoreResourceRow;
  resourceVersion?: string;
  error?: { message?: string };
}

/** Maps one ndjson watch event to a renderer delta batch. Pure for testing. */
export function deltaBatchFromWatchEvent(subscriptionId: string, event: CoreWatchEvent, resourceVersion: string): ResourceWatchBatch | undefined {
  if (!event.resource) return undefined;
  const type = event.type.toLowerCase();
  if (type !== "added" && type !== "modified" && type !== "deleted") return undefined;
  const events: ResourceWatchEvent[] = type === "deleted"
    ? [{ type: "deleted", key: resourceKey(event.resource) }]
    : [{ type: type as "added" | "modified", row: normalizeRow(event.resource) }];
  return {
    subscriptionId,
    kind: "delta",
    events,
    ...(resourceVersion ? { resourceVersion } : {}),
  };
}

/** The transport surface the watch supervisor needs; fakes implement this in tests. */
export type WatchTransport = Pick<CoreTransport, "listWatchPage" | "openWatchStream">;

/**
 * Owns live watch subscriptions. Each subscription re-lists then streams
 * deltas, reconnecting after transient drops and re-snapshotting on RESET.
 */
export class WatchSupervisor {
  private readonly watches = new Map<string, { controller: AbortController; webContentsId: number }>();

  constructor(
    private readonly transport: WatchTransport,
    private readonly reconnectDelayMs = 250,
  ) {}

  get size(): number {
    return this.watches.size;
  }

  /** Replaces every watch owned by this sender; a renderer keeps at most one. */
  start(subscriptionId: string, request: ResourceListRequest, sender: WebContents): void {
    this.cancelAll(sender.id);
    const controller = new AbortController();
    this.watches.set(subscriptionId, { controller, webContentsId: sender.id });
    void this.run(subscriptionId, request, sender, controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) this.send(sender, {
          subscriptionId,
          kind: "error",
          message: messageOf(cause),
        });
      })
      .finally(() => {
        const active = this.watches.get(subscriptionId);
        if (active?.controller === controller) this.watches.delete(subscriptionId);
      });
  }

  stop(subscriptionId: string, webContentsId: number): void {
    const active = this.watches.get(subscriptionId);
    if (active?.webContentsId === webContentsId) {
      active.controller.abort();
      this.watches.delete(subscriptionId);
    }
  }

  cancelAll(webContentsId?: number): void {
    for (const [subscriptionId, watch] of this.watches) {
      if (webContentsId === undefined || watch.webContentsId === webContentsId) {
        watch.controller.abort();
        this.watches.delete(subscriptionId);
      }
    }
  }

  private async run(subscriptionId: string, request: ResourceListRequest, sender: WebContents, signal: AbortSignal): Promise<void> {
    let resourceVersion = "";
    while (!signal.aborted) {
      const response = await this.transport.listWatchPage(request, signal);
      if (signal.aborted) return;
      resourceVersion = response.resourceVersion || "";
      this.send(sender, {
        subscriptionId,
        kind: "snapshot",
        items: response.items,
        ...(response.continueToken ? { continueToken: response.continueToken } : {}),
        ...(response.resourceVersion ? { resourceVersion: response.resourceVersion } : {}),
      });

      while (!signal.aborted) {
        const stream = await this.transport.openWatchStream(request, resourceVersion, signal);
        let reset = false;
        for await (const event of readNdjson<CoreWatchEvent>(stream, signal)) {
          if (signal.aborted) return;
          if (event.resourceVersion) resourceVersion = event.resourceVersion;
          if (event.type === "BOOKMARK") continue;
          if (event.type === "RESET") {
            reset = true;
            break;
          }
          if (event.type === "ERROR") throw new Error(event.error?.message || "Kubernetes watch failed");
          const batch = deltaBatchFromWatchEvent(subscriptionId, event, resourceVersion);
          if (batch) this.send(sender, batch);
        }
        if (reset) break;
        await abortableDelay(this.reconnectDelayMs, signal);
      }
    }
  }

  private send(sender: WebContents, batch: ResourceWatchBatch): void {
    if (!sender.isDestroyed()) sender.send("resources:watch-event", batch);
  }
}

export type LogsTransport = Pick<CoreTransport, "openLogsStream">;

/**
 * Owns streaming log subscriptions. One stream per renderer; a closed stream
 * reopens after the reconnect delay unless the subscription was cancelled,
 * matching the watch lifecycle.
 */
export class LogFollowSupervisor {
  private readonly streams = new Map<string, { controller: AbortController; webContentsId: number }>();

  constructor(
    private readonly transport: LogsTransport,
    private readonly reconnectDelayMs = 250,
  ) {}

  get size(): number {
    return this.streams.size;
  }

  start(subscriptionId: string, request: PodLogsRequest, sender: WebContents): void {
    this.cancelAll(sender.id);
    const controller = new AbortController();
    this.streams.set(subscriptionId, { controller, webContentsId: sender.id });
    void this.run(subscriptionId, request, sender, controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted) this.send(sender, { subscriptionId, type: "error", message: messageOf(cause) });
      })
      .finally(() => {
        const active = this.streams.get(subscriptionId);
        if (active?.controller === controller) this.streams.delete(subscriptionId);
      });
  }

  stop(subscriptionId: string, webContentsId: number): void {
    const active = this.streams.get(subscriptionId);
    if (active?.webContentsId === webContentsId) {
      active.controller.abort();
      this.streams.delete(subscriptionId);
    }
  }

  cancelAll(webContentsId?: number): void {
    for (const [subscriptionId, stream] of this.streams) {
      if (webContentsId === undefined || stream.webContentsId === webContentsId) {
        stream.controller.abort();
        this.streams.delete(subscriptionId);
      }
    }
  }

  private async run(subscriptionId: string, request: PodLogsRequest, sender: WebContents, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !sender.isDestroyed()) {
      const stream = await this.transport.openLogsStream(request, signal);
      for await (const event of readNdjson<LogStreamEvent>(stream, signal)) {
        this.send(sender, { subscriptionId, type: event.type === "error" ? "error" : "line", text: event.text, message: event.message });
      }
      if (!signal.aborted && !sender.isDestroyed()) {
        await abortableDelay(this.reconnectDelayMs, signal);
      }
    }
  }

  private send(sender: WebContents, batch: LogStreamBatch): void {
    if (!sender.isDestroyed()) sender.send("pods:logs-follow-event", batch);
  }
}

interface LogStreamEvent {
  type: string;
  text?: string;
  message?: string;
}

export async function* readNdjson<T>(stream: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line) yield JSON.parse(line) as T;
      }
    }
    const tail = `${buffer}${decoder.decode()}`.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
