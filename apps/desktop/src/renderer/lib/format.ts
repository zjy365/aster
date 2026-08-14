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
