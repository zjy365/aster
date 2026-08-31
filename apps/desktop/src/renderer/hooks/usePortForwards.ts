import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

function notify() {
  snapshotCache = Array.from(state.entries.values());
  for (const listener of listeners) listener();
}

/** Resets the store when the active context changes: a forward belongs to the context it was started in. */
function ensureContext(contextId: string) {
  if (state.contextId === contextId) return;
  state = { contextId, entries: new Map() };
  notify();
}

export async function startPortForward(request: PortForwardStartRequest): Promise<void> {
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
    entry.id = response.id;
    entry.localPort = response.localPort;
    entry.pod = response.pod;
    entry.busy = false;
  } catch (error) {
    entry.busy = false;
    entry.error = error instanceof Error ? error.message : String(error);
  }
  notify();
}

export async function stopPortForward(key: string): Promise<void> {
  const entry = state.entries.get(key);
  if (!entry) return;
  state.entries.delete(key);
  notify();
  if (entry.id) {
    try {
      await desktop.resources.portForwardStop(entry.id);
    } catch {
      // The core is gone or the forward already ended; the entry is gone either way.
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the module-level forward registry so forwards survive navigation. */
export function usePortForwards(contextId: string) {
  useEffect(() => {
    ensureContext(contextId);
  }, [contextId]);
  const entries = useSyncExternalStore(
    subscribe,
    () => snapshotCache,
    () => snapshotCache,
  );
  const [, force] = useState(0);
  const byKey = useCallback((key: string) => state.entries.get(key), []);
  const start = useCallback((request: PortForwardStartRequest) => startPortForward(request), []);
  const stop = useCallback((key: string) => stopPortForward(key), []);
  // Entries mutate in place; bump a counter so byKey callers re-render.
  useEffect(() => {
    const listener = () => force((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return useMemo(() => ({ entries, start, stop, byKey }), [entries, start, stop, byKey]);
}

/** Test-only accessors; never imported by app code. */
export function resetPortForwardStoreForTests() {
  state = { contextId: "", entries: new Map() };
  notify();
}

export function getPortForwardSnapshotForTests(): Map<string, PortForwardEntry> {
  return state.entries;
}
