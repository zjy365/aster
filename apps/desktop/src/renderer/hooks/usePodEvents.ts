// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import type { ResourceEvent, ResourceKind, ResourceRow } from "../../shared/types";
import { desktop } from "../lib/desktop";
import { SLOW_POLL_MS } from "../lib/poll-cadence";
import { newestEventsFirst } from "../lib/resource-events";

/** Matches the events one-shot's bound; the poll never loads more than this. */
const EVENT_LIMIT = 100;

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
  // The name set rides a ref: each poll joins against whatever the pods list
  // currently holds, so a live pod list refreshing cannot restart the poll.
  // Only the empty↔non-empty transition is a dependency (nothing to join
  // against means nothing to poll for).
  const namesRef = useRef(names);
  namesRef.current = names;
  const hasNames = names.length > 0;

  useEffect(() => {
    if (!enabled || !contextId || !namespace || !hasNames) {
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
        const joined: ResourceEvent[] = [];
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
          });
        }
        setEvents(newestEventsFirst(joined, EVENT_LIMIT));
      }).catch(() => {
        if (active) setEvents([]);
      });
    };
    load();
    const timer = setInterval(load, SLOW_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [contextId, namespace, hasNames, enabled]);

  return events;
}
