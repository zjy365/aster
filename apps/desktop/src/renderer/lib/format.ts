import type { ResourceRow } from "../../shared/types";

export function pluralize(kind: string): string {
  if (kind.endsWith("s")) return `${kind}es`;
  if (kind.endsWith("y")) return `${kind.slice(0, -1)}ies`;
  return `${kind}s`;
}

export function formatAge(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "-";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatReady(row: ResourceRow): string {
  const ready = row.ready;
  const desired = row.desired;
  if (ready === undefined && desired === undefined) return "-";
  if (desired === undefined) return String(ready ?? 0);
  return `${ready ?? 0}/${desired}`;
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * CPU usage in Kubernetes quantity syntax to the compact form kubectl top
 * prints: millicores and decimal cores pass through, nano/microcores
 * (what metrics-server actually returns, e.g. "22159600n") round up to
 * millicores, garbage becomes "-".
 */
export function formatCpuUsage(value: string): string {
  if (!value) return "-";
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith("n") || trimmed.endsWith("u")) {
    const milli = cpuToMillicores(trimmed);
    if (milli === undefined) return "-";
    return milli >= 1000 ? trimCores(milli / 1000) : `${Math.round(milli)}m`;
  }
  if (trimmed.endsWith("m")) {
    const milliText = trimmed.slice(0, -1);
    if (!milliText) return "-";
    const milli = Number(milliText);
    return Number.isFinite(milli) ? `${milli}m` : "-";
  }
  const cores = Number(trimmed);
  return Number.isFinite(cores) ? `${cores}` : "-";
}

/** Renders cores at two-decimal precision, dropping a trailing ".0" (2 stays "2"). */
function trimCores(cores: number): string {
  return `${Number(cores.toFixed(2))}`;
}

/** Memory usage in binary quantity syntax ("Ki"…"Ei") to a rounded unit. */
export function formatMemoryUsage(value: string): string {
  if (!value) return "-";
  const trimmed = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGTPE]i)?$/.exec(trimmed);
  if (!match) return "-";
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return "-";
  const unit = match[2];
  if (!unit) return `${raw}B`;
  const multiplier = 1024 ** (["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"].indexOf(unit) + 1);
  return binaryBytes(raw * multiplier);
}

/** Bytes to a rounded binary unit ("KiB"/"MiB"/"GiB"…). */
function binaryBytes(value: number): string {
  const eib = 1024 ** 6;
  const pib = 1024 ** 5;
  const tib = 1024 ** 4;
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (value >= eib) return `${(value / eib).toFixed(1)} EiB`;
  if (value >= pib) return `${(value / pib).toFixed(1)} PiB`;
  if (value >= tib) return `${(value / tib).toFixed(1)} TiB`;
  if (value >= gib) return `${(value / gib).toFixed(1)} GiB`;
  if (value >= mib) return `${(value / mib).toFixed(1)} MiB`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

const BINARY_UNITS = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"] as const;

/** CPU quantity to millicores: "1500m" → 1500, "1.5" → 1500, "22159600n" → 22.1596. */
export function cpuToMillicores(value: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith("n")) {
    const nanoText = trimmed.slice(0, -1);
    if (!nanoText) return undefined;
    const nano = Number(nanoText);
    return Number.isFinite(nano) ? nano / 1_000_000 : undefined;
  }
  if (trimmed.endsWith("u")) {
    const microText = trimmed.slice(0, -1);
    if (!microText) return undefined;
    const micro = Number(microText);
    return Number.isFinite(micro) ? micro / 1_000 : undefined;
  }
  if (trimmed.endsWith("m")) {
    const milliText = trimmed.slice(0, -1);
    if (!milliText) return undefined;
    const milli = Number(milliText);
    return Number.isFinite(milli) ? milli : undefined;
  }
  const cores = Number(trimmed);
  return Number.isFinite(cores) ? cores * 1000 : undefined;
}

/** Memory quantity to bytes: "128Mi" → 134217728, "123" → 123. */
export function memoryToBytes(value: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMGTPE]i)?$/.exec(trimmed);
  if (!match) return undefined;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return undefined;
  const unit = match[2];
  if (!unit) return raw;
  const index = BINARY_UNITS.indexOf(unit as (typeof BINARY_UNITS)[number]);
  return raw * 1024 ** (index + 1);
}

/** Totals a pod's per-container usage into one millicores/bytes number. */
export function totalPodUsage(containers: { cpu?: string; memory?: string }[]): { cpuMillicores?: number; memoryBytes?: number } {
  let cpuMillicores = 0;
  let memoryBytes = 0;
  let cpuSeen = false;
  let memorySeen = false;
  for (const container of containers) {
    if (container.cpu) {
      const milli = cpuToMillicores(container.cpu);
      if (milli !== undefined) {
        cpuMillicores += milli;
        cpuSeen = true;
      }
    }
    if (container.memory) {
      const bytes = memoryToBytes(container.memory);
      if (bytes !== undefined) {
        memoryBytes += bytes;
        memorySeen = true;
      }
    }
  }
  return {
    cpuMillicores: cpuSeen ? cpuMillicores : undefined,
    memoryBytes: memorySeen ? memoryBytes : undefined,
  };
}
