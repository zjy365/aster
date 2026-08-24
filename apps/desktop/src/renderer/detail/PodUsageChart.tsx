import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../components/ui/chart";
import { formatCpuUsage, formatMemoryUsage } from "../lib/format";
import type { PodMetricsState } from "../hooks/usePodMetrics";

const CHART_CONFIG = {
  cpu: { label: "CPU", color: "var(--chart-1)" },
  memory: { label: "Memory", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** Formats a timestamp for the tooltip and axis ticks: wall-clock HH:MM:SS. */
function tickLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Live resource usage for a Pod detail: the last 5 minutes of CPU and
 * memory sampled from metrics.k8s.io every 15s, drawn as two compact area
 * charts. The section renders nothing until the first sample lands; a
 * missing Metrics Server is a quiet notice with a retry, never a spinner.
 */
export function PodUsageChart({ metrics }: { metrics: PodMetricsState }) {
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
      <section className="resource-detail-section" data-testid="pod-usage">
        <div className="resource-section-heading">
          <div><h2>Resource usage</h2></div>
          <Button variant="outline" size="sm" onClick={refresh} data-testid="pod-usage-retry">
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
      <section className="resource-detail-section" data-testid="pod-usage">
        <div className="resource-section-heading"><div><h2>Resource usage</h2></div></div>
        <div className="resource-inline-state"><LoaderCircle className="spin" aria-hidden="true" />Sampling usage…</div>
      </section>
    );
  }

  if (samples.length === 0) {
    return (
      <section className="resource-detail-section" data-testid="pod-usage">
        <div className="resource-section-heading">
          <div><h2>Resource usage</h2></div>
          <Button variant="outline" size="sm" onClick={refresh} data-testid="pod-usage-retry">
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
    <section className="resource-detail-section" data-testid="pod-usage">
      <div className="resource-section-heading">
        <div>
          <h2>Resource usage</h2>
          <p className="resource-section-subnote">
            {error ? "Live sampling interrupted" : "Last 5 minutes · sampled every 15s"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} data-testid="pod-usage-refresh">
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

function UsageArea({
  title,
  value,
  unit,
  dataKey,
  color,
  points,
}: {
  title: string;
  value: string;
  unit: string;
  dataKey: "cpu" | "memory";
  color: string;
  points: { time: number; cpu: number; memory: number }[];
}) {
  return (
    <div className="pod-usage-area">
      <div className="pod-usage-heading">
        <strong>{title}</strong>
        <span className="tabular pod-usage-value" title={unit}>{value}</span>
      </div>
      <ChartContainer config={CHART_CONFIG} className="pod-usage-chart">
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="pod-usage-grid-line" />
          <XAxis
            dataKey="time"
            tickFormatter={tickLabel}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
            className="pod-usage-axis"
          />
          <YAxis
            width={42}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => compactAxis(value, dataKey)}
            className="pod-usage-axis"
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={
              <ChartTooltipContent
                labelKey="time"
                labelFormatter={(_label, payload) =>
                  tickLabel((payload?.[0]?.payload as { time: number } | undefined)?.time ?? 0)
                }
                formatter={(value, name) => [formatTooltipValue(Number(value), dataKey), String(name)]}
              />
            }
          />
          <Area
            dataKey={dataKey}
            type="monotone"
            stroke={color}
            strokeWidth={1.5}
            fill={color}
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

function compactAxis(value: number, dataKey: "cpu" | "memory"): string {
  if (dataKey === "cpu") {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}c`;
    return `${value}m`;
  }
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}G`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)}M`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)}K`;
  return `${value}`;
}

function formatTooltipValue(value: number, dataKey: "cpu" | "memory"): string {
  if (dataKey === "cpu") return `${Math.round(value)}m`;
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (value >= gib) return `${(value / gib).toFixed(1)} GiB`;
  if (value >= mib) return `${(value / mib).toFixed(1)} MiB`;
  return `${(value / 1024).toFixed(1)} KiB`;
}
