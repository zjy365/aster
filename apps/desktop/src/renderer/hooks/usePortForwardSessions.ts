import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortForwardSession } from "../../shared/types";
import { desktop } from "../lib/desktop";
import { messageOf } from "../lib/format";
import { SLOW_POLL_MS } from "../lib/poll-cadence";
import { stopPortForward, usePortForwardRegistry, type PortForwardEntry, type PortForwardRegistrySnapshot } from "./usePortForwards";

export interface PortForwardRow {
  /** Stable row key: the session id, or the renderer key for id-less rows. */
  key: string;
  id?: string;
  contextId: string;
  kind: string;
  namespace: string;
  name: string;
  targetPort: number;
  localPort?: number;
  /** The backing pod for service/workload forwards. */
  pod?: string;
  startedAt?: string;
  busy: boolean;
  error?: string;
  /**
   * Renderer-registry key. Rows the renderer owns stop through the store so
   * the Ports tab clears with them; server-only rows (e.g. after renderer
   * state loss) stop read-only by id.
   */
  stopKey?: string;
  source: "server" | "renderer";
}

/**
 * Pure reconciliation of the sidecar's session list with the renderer's own
 * registry. The server list wins: a session id known to both is rendered from
 * server data (authoritative local port, start time), decorated with the
 * renderer's stop key. Renderer entries survive only when the server does not
 * know their id — a start still in flight, or a poll that has not caught up —
 * and failed starts (no id, no longer busy) are not sessions at all.
 */
export function mergePortForwardRows(
  sessions: PortForwardSession[],
  registry: PortForwardRegistrySnapshot,
): PortForwardRow[] {
  const rows = new Map<string, PortForwardRow>();
  for (const session of sessions) {
    rows.set(session.id, {
      key: session.id,
      id: session.id,
      contextId: session.contextId,
      kind: session.resourceRef.kind,
      namespace: session.namespace,
      name: session.resourceRef.name,
      targetPort: session.targetPort,
      localPort: session.localPort,
      pod: session.pod,
      startedAt: session.startedAt,
      busy: false,
      source: "server",
    });
  }
  // The core orders sessions oldest first; renderer-only rows follow.
  for (const entry of registry.entries) {
    if (entry.id) {
      const serverRow = rows.get(entry.id);
      if (serverRow) {
        serverRow.stopKey = entry.key;
        serverRow.busy = entry.busy;
        if (entry.error && !serverRow.error) serverRow.error = entry.error;
        continue;
      }
      rows.set(`renderer:${entry.id}`, rendererRow(entry, registry.contextId));
      continue;
    }
    if (entry.busy) rows.set(`renderer:${entry.key}`, rendererRow(entry, registry.contextId));
  }
  return [...rows.values()];
}

function rendererRow(entry: PortForwardEntry, contextId: string): PortForwardRow {
  return {
    key: `renderer:${entry.id ?? entry.key}`,
    id: entry.id,
    contextId,
    kind: entry.kind,
    namespace: entry.namespace,
    name: entry.name,
    targetPort: entry.podPort,
    localPort: entry.localPort,
    pod: entry.pod,
    busy: entry.busy,
    error: entry.error,
    stopKey: entry.key,
    source: "renderer",
  };
}

/** How a row stops: through the renderer store when it owns the entry, by id when only the sidecar knows it. */
export type SessionStopAction =
  | { kind: "store"; stopKey: string }
  | { kind: "id"; id: string }
  | { kind: "none" };

export function stopActionFor(row: Pick<PortForwardRow, "stopKey" | "id">): SessionStopAction {
  if (row.stopKey) return { kind: "store", stopKey: row.stopKey };
  if (row.id) return { kind: "id", id: row.id };
  return { kind: "none" };
}

export interface PortForwardSessions {
  rows: PortForwardRow[];
  /** Active (or starting) forwards across every context. */
  count: number;
  loading: boolean;
  error: string;
  refresh(): Promise<void>;
  stop(row: PortForwardRow): Promise<void>;
  stopAll(): Promise<void>;
}

/**
 * The sidecar's port-forward session list, polled on the shared slow cadence.
 * The renderer registry reconciles into it, so the badge and panel survive
 * renderer state loss; stops reuse the existing stop endpoint per row.
 */
export function usePortForwardSessions(coreReady: boolean): PortForwardSessions {
  const registry = usePortForwardRegistry();
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Server-only rows mid-stop; renderer-owned rows show busy via the store.
  const [stoppingIds, setStoppingIds] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const alive = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await desktop.resources.portForwardList();
      if (!alive.current) return;
      setSessions(next);
      setError("");
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!coreReady) {
      setSessions([]);
      setError("");
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), SLOW_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [coreReady, refresh]);

  const clearRowError = useCallback((key: string) => {
    setRowErrors((current) => {
      if (!Object.hasOwn(current, key)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const stop = useCallback(async (row: PortForwardRow) => {
    const action = stopActionFor(row);
    clearRowError(row.key);
    try {
      if (action.kind === "store") {
        // Renderer-owned: the store stops by id and clears the Ports-tab row.
        // A failed stop resolves too: its error stays on the registry entry.
        await stopPortForward(action.stopKey);
      } else if (action.kind === "id") {
        setStoppingIds((current) => new Set(current).add(action.id));
        try {
          await desktop.resources.portForwardStop(action.id);
        } finally {
          setStoppingIds((current) => {
            if (!current.has(action.id)) return current;
            const next = new Set(current);
            next.delete(action.id);
            return next;
          });
        }
      }
    } catch (cause) {
      const message = messageOf(cause);
      setRowErrors((current) => ({ ...current, [row.key]: message }));
    }
    await refresh();
  }, [clearRowError, refresh]);

  const merged = useMemo(
    () => mergePortForwardRows(sessions, registry).map((row) => ({
      ...row,
      busy: row.busy || Boolean(row.id && stoppingIds.has(row.id)),
      error: row.error ?? rowErrors[row.key],
    })),
    [sessions, registry, stoppingIds, rowErrors],
  );

  const stopAll = useCallback(async () => {
    // No bulk endpoint: every row stops through the same per-row path.
    await Promise.all(merged.map((row) => stop(row)));
  }, [merged, stop]);

  return useMemo(() => ({
    rows: merged,
    count: merged.length,
    loading,
    error,
    refresh,
    stop,
    stopAll,
  }), [merged, loading, error, refresh, stop, stopAll]);
}
