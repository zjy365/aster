import { useCallback, useEffect, useRef, useState } from "react";
import type { PodMetric } from "../../shared/types";
import { messageOf, totalPodUsage } from "../lib/format";
import { desktop } from "../lib/desktop";

/** How many snapshots the chart keeps; at 15s sampling that's the last 5 minutes. */
const HISTORY_POINTS = 20;
/** Matches metrics.k8s.io's ~15s aggregation cadence — polling faster only refetches duplicates. */
const SAMPLE_INTERVAL_MS = 15_000;

export interface PodMetricSample {
  /** Epoch ms when the snapshot was fetched. */
  timestamp: number;
  /** Sum across containers; undefined when the pod reports no usage. */
  cpuMillicores?: number;
  memoryBytes?: number;
}

export interface PodMetricsState {
  samples: PodMetricSample[];
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
 * Polls the pod's CPU/memory usage from metrics.k8s.io while the detail stays
 * open. Metrics is an on-demand, lazily-created client, so this only touches
 * the API server while a pod detail is on screen. A missing Metrics Server
 * surfaces as a stable error, not a spinner or empty chart.
 */
export function usePodMetrics(contextId: string, namespace: string, name: string): PodMetricsState {
  const [samples, setSamples] = useState<PodMetricSample[]>([]);
  const [latest, setLatest] = useState<{ cpu?: string; memory?: string }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const record = useCallback((metrics: PodMetric[]) => {
    const pod = metrics.find((item) => item.name === name);
    if (!pod) {
      // Pod deleted or metrics not yet reported; keep the chart as-is.
      return;
    }
    const usage = totalPodUsage(pod.containers);
    const cpu = pod.containers.map((container) => container.cpu).find((value) => value);
    const memory = pod.containers.map((container) => container.memory).find((value) => value);
    setLatest({ cpu, memory });
    setSamples((current) => [
      ...current.slice(-(HISTORY_POINTS - 1)),
      { timestamp: Date.now(), ...usage },
    ]);
  }, [name]);

  useEffect(() => {
    if (!contextId || !namespace || !name) return;
    let active = true;
    setLoading(true);
    setError("");

    const poll = async () => {
      if (!active) return;
      try {
        const metrics = await desktop.metrics.pods(contextId, namespace);
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
  }, [contextId, namespace, name, record]);

  const refresh = useCallback(() => {
    void desktop.metrics
      .pods(contextId, namespace)
      .then((metrics) => {
        record(metrics);
        setError("");
      })
      .catch((cause) => setError(messageOf(cause)));
  }, [contextId, namespace, record]);

  return { samples, cpu: latest.cpu, memory: latest.memory, loading, error, refresh };
}
