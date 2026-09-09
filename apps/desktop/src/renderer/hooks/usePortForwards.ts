import { useCallback, useMemo, useSyncExternalStore } from "react";
import { desktop } from "../lib/desktop";
import type { PodPortForward, PortForwardStartRequest } from "../../shared/types";

export interface PortForwardEntry {
  key: string;
  kind: string;
  namespace: string;
  name: string;
  podPort: number;
  id?: string;
  localPort?: number;
  /** The backing pod for service/workload forwards. */
  pod?: string;
  error?: string;
  busy: boolean;
}

export function forwardKey(kind: string, namespace: string, name: string, podPort: number): string {
  return `${kind}|${namespace}|${name}|${podPort}`;
}

interface StoreState {
  contextId: string;
  entries: Map<string, PortForwardEntry>;
}

const listeners = new Set<() => void>();
let state: StoreState = { contextId: "", entries: new Map() };
let snapshotCache: PortForwardEntry[] = [];
export interface PendingForwardStop extends PortForwardEntry { contextId: string; id: string }
const pendingStops = new Map<string, PendingForwardStop>();
let pendingSnapshot: PendingForwardStop[] = [];
const stopping = new Map<string, Promise<void>>();
let coreGeneration = 0;

function stopById(id: string): Promise<void> {
  const existing = stopping.get(id);
  if (existing) return existing;
  const promise = Promise.resolve().then(() => desktop.resources.portForwardStop(id)).finally(() => {
    if (stopping.get(id) === promise) stopping.delete(id);
  });
  stopping.set(id, promise);
  return promise;
}

async function retireForward(entry: PortForwardEntry, contextId: string) {
  if (!entry.id) return;
  const pending = pendingStops.get(entry.id) ?? { ...entry, id: entry.id, contextId };
  pendingStops.set(entry.id, pending);
  pending.busy = true;
  pending.error = undefined;
  notify();
  try {
    await stopById(pending.id);
    if (pendingStops.get(pending.id) === pending) pendingStops.delete(pending.id);
  } catch (error) {
    pending.error = error instanceof Error ? error.message : String(error);
  } finally {
    pending.busy = false;
    notify();
  }
}

export async function retryPendingForwardStops() {
  await Promise.all([...pendingStops.values()].filter((entry) => !entry.busy)
    .map((entry) => retireForward(entry, entry.contextId)));
}

/** The sidecar has exited, so its listeners and IDs no longer exist. */
export function discardPortForwards() {
  coreGeneration++;
  state = { contextId: "", entries: new Map() };
  pendingStops.clear();
  stopping.clear();
  notify();
}

export function usePendingForwardStops() {
  return useSyncExternalStore(subscribe, () => pendingSnapshot, () => pendingSnapshot);
}

function notify() {
  snapshotCache = Array.from(state.entries.values());
  pendingSnapshot = Array.from(pendingStops.values());
  for (const listener of listeners) listener();
}

/** Called by App, including when the Ports tab is not mounted. */
export async function setPortForwardContext(contextId: string): Promise<void> {
  if (state.contextId === contextId) return;
  const previous = state;
  state = { contextId, entries: new Map() };
  notify();
  await Promise.all(Array.from(previous.entries.values(), async (entry) => {
    await retireForward(entry, previous.contextId);
  }));
}

export async function startPortForward(request: PortForwardStartRequest): Promise<void> {
  if (request.contextId !== state.contextId) return;
  const owner = state;
  const generation = coreGeneration;
  const kind = request.kind || "Pod";
  const key = forwardKey(kind, request.namespace, request.name, request.podPort);
  const existing = state.entries.get(key);
  if (existing?.busy || existing?.localPort) return;
  const entry: PortForwardEntry = {
    key,
    kind,
    namespace: request.namespace,
    name: request.name,
    podPort: request.podPort,
    busy: true,
  };
  state.entries.set(key, entry);
  notify();
  try {
    if (!request.localPort) {
      request = { ...request, localPort: 0 };
    }
    const response: PodPortForward = await desktop.resources.portForwardStart(request);
    if (generation !== coreGeneration) return;
    entry.id = response.id;
    entry.localPort = response.localPort;
    entry.pod = response.pod;
    entry.busy = false;
    if (state !== owner || owner.entries.get(key) !== entry) {
      await retireForward(entry, owner.contextId);
      return;
    }
  } catch (error) {
    entry.busy = false;
    entry.error = error instanceof Error ? error.message : String(error);
  }
  notify();
}

export async function stopPortForward(key: string): Promise<void> {
  const entry = state.entries.get(key);
  if (!entry) return;
  if (entry.busy && entry.id) return;
  if (entry.id) {
    entry.busy = true;
    notify();
    try {
      await stopById(entry.id);
    } catch (error) {
      entry.busy = false;
      entry.error = error instanceof Error ? error.message : String(error);
      notify();
      return;
    }
  }
  if (state.entries.get(key) === entry) state.entries.delete(key);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the module-level forward registry so forwards survive navigation. */
export function usePortForwards(contextId: string) {
  const entries = useSyncExternalStore(
    subscribe,
    () => snapshotCache,
    () => snapshotCache,
  );
  const byKey = useCallback((key: string) => state.contextId === contextId ? state.entries.get(key) : undefined, [contextId]);
  return useMemo(() => ({
    entries: state.contextId === contextId ? entries : [],
    start: startPortForward,
    stop: stopPortForward,
    byKey,
  }), [entries, contextId, byKey]);
}

/** Test-only accessors; never imported by app code. */
export function resetPortForwardStoreForTests() {
  discardPortForwards();
}

export function getPendingForwardStopsForTests() { return pendingSnapshot; }

export function getPortForwardSnapshotForTests(): Map<string, PortForwardEntry> {
  return state.entries;
}
