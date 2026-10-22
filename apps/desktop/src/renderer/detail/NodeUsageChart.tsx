import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../components/ui/button";
import { formatCpuUsage, formatMemoryUsage } from "../lib/format";
import type { NodeMetricsState } from "../hooks/useNodeMetrics";
import { UsageArea } from "./PodUsageChart";

/**
 * Live resource usage for a Node detail: the last 5 minutes of CPU and
 * memory sampled from metrics.k8s.io every 15s, drawn with the same compact
 * area charts as the Pod detail. The section renders nothing until the first
 * sample lands; a missing Metrics Server is a quiet notice with a retry,
 * never a spinner.
 */
export function NodeUsageChart({ metrics }: { metrics: NodeMetricsState }) {
  const { samples, loading, error, refresh } = metrics;

  const points = useMemo(
    () => samples.map((sample) => ({
      time: sample.timestamp,
      cpu: sample.cpuMillicores ?? 0,
      memory: sample.memoryBytes ?? 0,
    })),
    [samples],
  );

  if (error && samples.length === 0) {
    return (
      <section className="resource-detail-section" data-testid="node-usage">
        <div className="resource-section-heading">
          <div><h2>Resource usage</h2></div>
          <Button variant="outline" size="sm" onClick={refresh} data-testid="node-usage-retry">
            <RefreshCw data-icon="inline-start" />
            Retry
          </Button>
        </div>
        <div className="resource-inline-state resource-inline-error" role="alert">
          <AlertCircle aria-hidden="true" />
          {error}
        </div>
      </section>
    );
  }

  if (loading && samples.length === 0) {
    return (
      <section className="resource-detail-section" data-testid="node-usage">
        <div className="resource-section-heading"><div><h2>Resource usage</h2></div></div>
        <div className="resource-inline-state"><LoaderCircle className="spin" aria-hidden="true" />Sampling usage…</div>
      </section>
    );
  }

  if (samples.length === 0) {
    return (
      <section className="resource-detail-section" data-testid="node-usage">
        <div className="resource-section-heading">
          <div><h2>Resource usage</h2></div>
          <Button variant="outline" size="sm" onClick={refresh} data-testid="node-usage-refresh">
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </div>
        <p className="resource-section-note">
          No usage reported yet — the metrics API aggregates over ~15s windows.
        </p>
      </section>
    );
  }

  return (
    <section className="resource-detail-section" data-testid="node-usage">
      <div className="resource-section-heading">
        <div>
          <h2>Resource usage</h2>
          <p className="resource-section-subnote">
            {error ? "Live sampling interrupted" : "Last 5 minutes · sampled every 15s"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} data-testid="node-usage-refresh">
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      <div className="pod-usage-grid">
        <UsageArea
          title="CPU"
          value={metrics.cpu ? formatCpuUsage(metrics.cpu) : "-"}
          unit="millicores"
          dataKey="cpu"
          color="var(--chart-1)"
          points={points}
        />
        <UsageArea
          title="Memory"
          value={metrics.memory ? formatMemoryUsage(metrics.memory) : "-"}
          unit="bytes"
          dataKey="memory"
          color="var(--chart-2)"
          points={points}
        />
      </div>
    </section>
  );
}
