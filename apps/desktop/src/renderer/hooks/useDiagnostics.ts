import { useEffect, useState } from "react";
import type {
  RelatedResource,
  ResourceEvent,
  ResourceKind,
  ResourceRow,
} from "../../shared/types";
import { desktop } from "../lib/desktop";

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
 */
export function useDiagnostics({ contextId, kind, selected }: DiagnosticsOptions): DiagnosticsState {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [related, setRelated] = useState<RelatedResource[]>([]);

  useEffect(() => {
    if (!selected || !contextId || !selected.namespace) {
      setEvents([]);
      return;
    }
    let active = true;
    void desktop.resources.events({ contextId, resourceKind: kind, namespace: selected.namespace, name: selected.name })
      .then((items) => active && setEvents(items))
      .catch(() => active && setEvents([]));
    return () => { active = false; };
  }, [contextId, kind, selected]);

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
