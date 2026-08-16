import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PodExecResponse,
  PodLogsResponse,
  PodMetric,
  PodPortForward,
  RelatedResource,
  ResourceEvent,
  ResourceKind,
  ResourceRow,
} from "../../shared/types";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export interface DiagnosticsOptions {
  contextId: string;
  kind: ResourceKind;
  selected?: ResourceRow;
  /** read-only policy and main-process sync both cleared. */
  execAllowed: boolean;
}

export interface DiagnosticsState {
  events: ResourceEvent[];
  related: RelatedResource[];
  logs?: PodLogsResponse;
  following: boolean;
  followLines: string[];
  podMetric?: PodMetric;
  portForward?: PodPortForward;
  portForwardMessage: string;
  execResult?: PodExecResponse;
  toggleFollow(): void;
  startPortForward(podPort: number): Promise<void>;
  stopPortForward(): Promise<void>;
  runExec(command: string[]): Promise<void>;
}

/**
 * Owns the diagnostic surface for the selected resource: related events,
 * relationship queries, Pod logs, and one-shot exec results. Everything is
 * scoped to the current selection and lazily fetched — no background polling.
 */
export function useDiagnostics({ contextId, kind, selected, execAllowed }: DiagnosticsOptions): DiagnosticsState {
  const [events, setEvents] = useState<ResourceEvent[]>([]);
  const [related, setRelated] = useState<RelatedResource[]>([]);
  const [logs, setLogs] = useState<PodLogsResponse>();
  const [following, setFollowing] = useState(false);
  const [followLines, setFollowLines] = useState<string[]>([]);
  const [podMetric, setPodMetric] = useState<PodMetric>();
  const [portForward, setPortForward] = useState<PodPortForward>();
  const [portForwardMessage, setPortForwardMessage] = useState("");
  const [execResult, setExecResult] = useState<PodExecResponse>();
  const stopFollowRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (selected?.kind !== "Pod" || !contextId || !selected.namespace) {
      setLogs(undefined);
      return;
    }
    let active = true;
    void desktop.resources.logs({ contextId, namespace: selected.namespace, name: selected.name, tailLines: 2_000 })
      .then((value) => active && setLogs(value))
      .catch(() => active && setLogs(undefined));
    return () => { active = false; };
  }, [contextId, selected]);

  useEffect(() => {
    setExecResult(undefined);
    stopFollowRef.current?.();
    stopFollowRef.current = undefined;
    setFollowing(false);
    setFollowLines([]);
    setPortForward((active) => {
      if (active) void desktop.resources.portForwardStop(active.id);
      return undefined;
    });
    setPortForwardMessage("");
  }, [contextId, selected]);

  useEffect(() => {
    if (selected?.kind !== "Pod" || !contextId || !selected.namespace) {
      setPodMetric(undefined);
      return;
    }
    let active = true;
    void desktop.metrics.pods(contextId, selected.namespace)
      .then((pods) => active && setPodMetric(pods.find((pod) => pod.name === selected.name)))
      .catch(() => active && setPodMetric(undefined));
    return () => { active = false; };
  }, [contextId, selected]);

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

  const toggleFollow = useCallback(() => {
    if (following) {
      stopFollowRef.current?.();
      stopFollowRef.current = undefined;
      setFollowing(false);
      return;
    }
    if (!selected || selected.kind !== "Pod" || !contextId || !selected.namespace) return;
    setFollowLines([]);
    const stop = desktop.resources.followLogs(
      { contextId, namespace: selected.namespace, name: selected.name, tailLines: 200 },
      (batch) => {
        if (batch.type === "error") {
          setFollowLines((current) => [...current.slice(-4_999), `[stream error] ${batch.message || "unknown"}`].slice(-5_000));
          return;
        }
        if (batch.text !== undefined) {
          setFollowLines((current) => [...current, batch.text as string].slice(-5_000));
        }
      },
    );
    stopFollowRef.current = stop;
    setFollowing(true);
  }, [following, selected, contextId]);

  useEffect(() => () => stopFollowRef.current?.(), []);

  const startPortForward = useCallback(async (podPort: number) => {
    if (!selected || selected.kind !== "Pod" || !contextId || !selected.namespace || !execAllowed) return;
    setPortForwardMessage("");
    try {
      setPortForward(await desktop.resources.portForwardStart({ contextId, namespace: selected.namespace, name: selected.name, podPort }));
    } catch (cause) {
      setPortForward(undefined);
      setPortForwardMessage(messageOf(cause));
    }
  }, [contextId, selected, execAllowed]);

  const stopPortForward = useCallback(async () => {
    setPortForward((active) => {
      if (active) void desktop.resources.portForwardStop(active.id);
      return undefined;
    });
    setPortForwardMessage("");
  }, []);

  const runExec = useCallback(async (command: string[]) => {
    if (!selected || !contextId || !selected.namespace || !execAllowed) return;
    try {
      setExecResult(await desktop.resources.exec({ contextId, namespace: selected.namespace, name: selected.name, command }));
    } catch (cause) {
      setExecResult({ stdout: "", stderr: messageOf(cause) });
    }
  }, [contextId, selected, execAllowed]);

  return { events, related, logs, following, followLines, podMetric, portForward, portForwardMessage, execResult, toggleFollow, startPortForward, stopPortForward, runExec };
}
