import { useCallback, useEffect, useRef, useState } from "react";
import { cpuToMillicores, memoryToBytes, messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

/** How many snapshots the chart keeps; at 15s sampling that's the last 5 minutes. */
const HISTORY_POINTS = 20;
/** Matches metrics.k8s.io's ~15s aggregation cadence — polling faster only refetches duplicates. */
const SAMPLE_INTERVAL_MS = 15_000;

export interface NodeMetricSample {
  /** Epoch ms when the snapshot was fetched. */
  timestamp: number;
  /** Usage converted to chart units; undefined when the node reports no usage. */
  cpuMillicores?: number;
  memoryBytes?: number;
}

export interface NodeMetricsState {
  samples: NodeMetricSample[];
  /** Latest values as the raw metrics quantities, for the live readout. */
  cpu?: string;
  memory?: string;
  loading: boolean;
  /** Set when the metrics API is unavailable (no Metrics Server). */
  error: string;
  /** Fetches one snapshot immediately; the interval continues after. */
  refresh(): void;
}

/**
 * Polls one node's CPU/memory usage from metrics.k8s.io while the detail
 * stays open, mirroring usePodMetrics: the cluster-wide snapshot is fetched
 * on the shared 15s cadence and this node's entry is picked out client-side.
 * A missing Metrics Server surfaces as a stable error, not a spinner.
 */
export function useNodeMetrics(contextId: string, name: string): NodeMetricsState {
  const [samples, setSamples] = useState<NodeMetricSample[]>([]);
  const [latest, setLatest] = useState<{ cpu?: string; memory?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const record = useCallback((metrics: { name: string; cpu: string; memory: string }[]) => {
    const node = metrics.find((item) => item.name === name);
    if (!node) {
      // Node deleted or metrics not yet reported; keep the chart as-is.
      return;
    }
    setLatest({ cpu: node.cpu, memory: node.memory });
    setSamples((current) => [
      ...current.slice(-(HISTORY_POINTS - 1)),
      {
        timestamp: Date.now(),
        cpuMillicores: cpuToMillicores(node.cpu),
        memoryBytes: memoryToBytes(node.memory),
      },
    ]);
  }, [name]);

  useEffect(() => {
    if (!contextId || !name) return;
    let active = true;
    setLoading(true);
    setError("");

    const poll = async () => {
      if (!active) return;
      try {
        const metrics = await desktop.metrics.nodes(contextId);
        if (active) {
          record(metrics);
          setLoading(false);
        }
      } catch (cause) {
        if (active) setError(messageOf(cause));
      }
    };

    void poll();
    timer.current = setInterval(() => void poll(), SAMPLE_INTERVAL_MS);

    return () => {
      active = false;
      if (timer.current !== undefined) clearInterval(timer.current);
      timer.current = undefined;
    };
  }, [contextId, name, record]);

  const refresh = useCallback(() => {
    void desktop.metrics
      .nodes(contextId)
      .then((metrics) => {
        record(metrics);
        setError("");
      })
      .catch((cause) => setError(messageOf(cause)));
  }, [contextId, record]);

  return { samples, cpu: latest.cpu, memory: latest.memory, loading, error, refresh };
}
