import { parse } from "yaml";
import type { NodeDrainEvent, NodeDrainOptions } from "../../shared/types";

/**
 * Node-specific facts and drain-event projections, parsed and formatted from
 * data the core already shipped. Writes go through the dedicated node
 * endpoints (cordon/drain), never the YAML mutation pipeline.
 */

/** Reads spec.unschedulable from the live node YAML; absent/false → false. */
export function parseNodeUnschedulable(yamlText: string | undefined): boolean {
  if (!yamlText?.trim()) return false;
  try {
    const parsed = parse(yamlText) as { spec?: { unschedulable?: boolean } } | undefined;
    return Boolean(parsed?.spec?.unschedulable);
  } catch {
    return false;
  }
}

/** Dialog defaults: kubectl-safe — DaemonSets ignored, nothing forced. */
export const DEFAULT_DRAIN_OPTIONS: NodeDrainOptions = {
  ignoreDaemonsets: true,
  force: false,
  deleteEmptyDirData: false,
  disableEviction: false,
};

export type DrainProgressTone = "info" | "ok" | "warn" | "error";

export interface DrainProgressLine {
  key: string;
  text: string;
  tone: DrainProgressTone;
}

const STATUS_LABEL: Record<string, string> = {
  evicting: "evicting",
  evicted: "evicted",
  deleting: "deleting",
  deleted: "deleted",
  skipped: "skipped",
  failed: "failed",
};

const STATUS_TONE: Record<string, DrainProgressTone> = {
  evicting: "info",
  deleting: "info",
  evicted: "ok",
  deleted: "ok",
  skipped: "warn",
  failed: "error",
};

function podLabel(event: NodeDrainEvent): string {
  return event.namespace ? `${event.namespace}/${event.pod}` : event.pod || "";
}

/** Maps one drain event to its progress line; the cordon line opens the list. */
export function describeDrainEvent(event: NodeDrainEvent, index: number): DrainProgressLine {
  if (event.type === "cordon") {
    return {
      key: `cordon-${index}`,
      text: event.changed === false ? "Node already cordoned" : "Node cordoned — draining pods",
      tone: "info",
    };
  }
  if (event.type === "pod") {
    const status = STATUS_LABEL[event.status || ""] || event.status || "";
    let text = `${podLabel(event)} — ${status}`;
    if (event.reason) text += ` (${event.reason})`;
    if (event.message) text += `: ${event.message}`;
    return { key: `pod-${index}`, text, tone: STATUS_TONE[event.status || ""] || "info" };
  }
  return { key: `summary-${index}`, text: summarizeDrain(event), tone: event.complete ? "ok" : "error" };
}

/** Renders the summary event: counts first, abort reason when incomplete. */
export function summarizeDrain(event: NodeDrainEvent): string {
  const counts = `${event.evicted ?? 0} evicted, ${event.skipped ?? 0} skipped, ${event.failed ?? 0} failed`;
  if (event.error) return `Drain stopped — ${counts}. ${event.error}`;
  return event.complete ? `Drain complete — ${counts}` : `Drain finished with failures — ${counts}`;
}

/** Journal entry for a finished drain, in the useMutation journal's shape. */
export function drainJournalEntry(nodeName: string, summary: NodeDrainEvent): string {
  return `drain ${nodeName} (${summary.evicted ?? 0} evicted, ${summary.skipped ?? 0} skipped, ${summary.failed ?? 0} failed)`;
}
