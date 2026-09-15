// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from "react";
import type { ResourceEvent, ResourceKind, ResourceRow } from "../../shared/types";
import { desktop } from "../lib/desktop";

/** Matches the events one-shot's bound; the poll never loads more than this. */
const EVENT_LIMIT = 100;
/** Matches the metrics sampling cadence; events aggregate on a similar clock. */
const POLL_INTERVAL_MS = 15_000;

const EVENTS_KIND: ResourceKind = {
  id: "events",
  group: "",
  version: "v1",
  resource: "events",
  kind: "Event",
  namespaced: true,
  category: "cluster",
};

/** Event rows carry their projection fields alongside the base row shape. */
type EventRow = ResourceRow & { reason?: string; message?: string; type?: string };

export interface PodEventsOptions {
  contextId: string;
  namespace: string;
  /** The workload's current pods; events are joined client-side on these names. */
  names: string[];
  enabled: boolean;
}

/**
 * Surfaces the rollout's child pod events (Pulling / Created / Started /
 * Killing) for an open workload detail. One ordinary namespaced list request
 * per poll — the events kind filtered server-side to pod events, joined
 * client-side to the workload's own pod names — never a watch stream and
 * never a per-pod fan-out. A poll finds nothing without a Metrics-Server-like
 * error path: events are best-effort and an empty result renders as none.
 */
export function usePodEvents({ contextId, namespace, names, enabled }: PodEventsOptions): ResourceEvent[] {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  // The name set rides a ref so a live pod list refreshing cannot restart the
  // poll; only the scope (context/namespace/kind) can.
  const namesRef = useRef(names);
  namesRef.current = names;
  const nameKey = useMemo(() => [...names].sort().join("\u0000"), [names]);

  useEffect(() => {
    if (!enabled || !contextId || !namespace || !nameKey) {
      setEvents([]);
      return;
    }
    let active = true;
    const load = () => {
      void desktop.resources.list({
        contextId,
        resourceKind: EVENTS_KIND,
        namespace,
        fieldSelector: "involvedObject.kind=Pod",
        limit: EVENT_LIMIT,
      }).then((response) => {
        if (!active) return;
        const current = new Set(namesRef.current);
        const seen = new Set<string>();
        const joined: Array<ResourceEvent & { sortKey: string }> = [];
        for (const row of response.items as EventRow[]) {
          const pod = row.involvedObject || "";
          if (!pod || !current.has(pod)) continue;
          if (seen.has(row.uid)) continue;
          seen.add(row.uid);
          joined.push({
            name: pod,
            namespace: row.namespace,
            reason: row.reason,
            message: row.message,
            type: row.type,
            count: row.count,
            lastTimestamp: row.lastTimestamp,
            sortKey: row.lastTimestamp || "",
          });
        }
        joined.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
        setEvents(joined.slice(0, EVENT_LIMIT).map(({ sortKey: _sortKey, ...event }) => event));
      }).catch(() => {
        if (active) setEvents([]);
      });
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [contextId, namespace, nameKey, enabled]);

  return events;
}
