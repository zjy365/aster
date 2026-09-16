import { useEffect, useState } from "react";
import type {
  RelatedResource,
  ResourceEvent,
  ResourceKind,
  ResourceRow,
} from "../../shared/types";
import { desktop } from "../lib/desktop";
import { SLOW_POLL_MS } from "../lib/poll-cadence";
import { isRolloutWorkloadKind } from "../detail/workload-detail";

export interface DiagnosticsOptions {
  contextId: string;
  kind: ResourceKind;
  selected?: ResourceRow;
}

export interface DiagnosticsState {
  events: ResourceEvent[];
  related: RelatedResource[];
}

/**
 * Owns the diagnostic surface for the selected resource: recent events and
 * owner/child relationship queries. Pod logs live in the self-contained
 * LogViewer component, not here.
 *
 * Events re-fetch when the selection's resourceVersion bumps (the detail's
 * single-object watch adopts those) and, for rollout workloads only (#39),
 * on a slow interval as a backstop for child events that do not touch the
 * object itself — so rollout events land without a manual refresh. Other
 * kinds keep the one-shot fetch the selection change already drives.
 */
export function useDiagnostics({ contextId, kind, selected }: DiagnosticsOptions): DiagnosticsState {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [related, setRelated] = useState<RelatedResource[]>([]);
  const liveEvents = isRolloutWorkloadKind(kind.kind);

  useEffect(() => {
    if (!selected || !contextId || !selected.namespace) {
      setEvents([]);
      return;
    }
    let active = true;
    const load = () => {
      void desktop.resources.events({ contextId, resourceKind: kind, namespace: selected.namespace, name: selected.name })
        .then((items) => active && setEvents(items))
        .catch(() => active && setEvents([]));
    };
    load();
    const timer = liveEvents ? setInterval(load, SLOW_POLL_MS) : undefined;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [contextId, kind, selected, liveEvents]);

  useEffect(() => {
    if (!selected || !contextId) {
      setRelated([]);
      return;
    }
    let active = true;
    void desktop.resources.related({ contextId, resourceKind: kind, namespace: selected.namespace || undefined, name: selected.name })
      .then((items) => active && setRelated(items))
      .catch(() => active && setRelated([]));
    return () => { active = false; };
  }, [contextId, kind, selected]);

  return { events, related };
}
