import type {
  DiscoveredResource,
  OverviewCount,
  OverviewResource,
  PodMetric,
  RelatedResource,
  ResourceEvent,
  ResourceRow,
} from "./types";

/**
 * Pure response normalizers shared by every desktop shell. The Go core
 * returns loosely-typed JSON; these functions are the single place that
 * tightens it into the renderer's types, so the Electron main process and
 * the Tauri invoke adapter normalize identically.
 */

export interface CoreListResponse {
  items: CoreResourceRow[];
  continueToken?: string;
  resourceVersion?: string;
}

export interface CoreOverview {
  nodes: OverviewCount;
  pods: OverviewCount;
  namespaces: number;
  services: number;
  resource: OverviewResource;
  events: CoreOverviewEvent[];
  truncated?: boolean;
}

export interface CoreOverviewEvent {
  namespace?: string;
  name: string;
  reason?: string;
  message?: string;
  type?: string;
  count?: number;
  lastTimestamp?: string;
}

export interface CoreResourceRow extends Omit<ResourceRow, "createdAt" | "namespace" | "resourceVersion"> {
  namespace?: string;
  resourceVersion?: string;
  createdAt?: string;
  reason?: string;
  message?: string;
  type?: string;
  count?: number;
  lastTimestamp?: string;
}

export function normalizeRow(row: CoreResourceRow): ResourceRow {
  return {
    ...row,
    namespace: row.namespace || "",
    resourceVersion: row.resourceVersion || "",
    createdAt: row.createdAt || "",
  };
}

export function resourceKey(row: { uid: string; kind: string; namespace?: string; name: string }): string {
  return row.uid || `${row.kind}:${row.namespace}/${row.name}`;
}

export function discoveredResourceList(input: unknown): DiscoveredResource[] {
  const value = object(input, "discovery response");
  const resources = Array.isArray(value.resources) ? value.resources : [];
  return resources.map((item) => {
    const entry = object(item, "discovered resource");
    return {
      group: (entry.group === undefined ? "" : optionalText(entry.group, "group", 253)) || "",
      version: requiredText(entry.version, "version", 64),
      resource: requiredText(entry.resource, "resource", 253),
      kind: requiredText(entry.kind, "kind", 128),
      namespaced: Boolean(entry.namespaced),
    };
  });
}

export function relatedResourceList(input: unknown): RelatedResource[] {
  const value = object(input, "related response");
  const items = Array.isArray(value.related) ? value.related : Array.isArray(value.results) ? value.results : [];
  return items.map((item) => {
    const entry = object(item, "related resource");
    return {
      group: (entry.group === undefined ? "" : optionalText(entry.group, "group", 253)) || "",
      version: requiredText(entry.version, "version", 64),
      resource: requiredText(entry.resource, "resource", 253),
      kind: requiredText(entry.kind, "kind", 128),
      ...(entry.namespace === undefined ? {} : { namespace: optionalText(entry.namespace, "namespace", 253) }),
      name: requiredText(entry.name, "name", 253),
      relation: requiredText(entry.relation, "relation", 64),
    };
  });
}

export function podMetricList(input: unknown): PodMetric[] {
  const value = object(input, "pod metrics response");
  const pods = Array.isArray(value.pods) ? value.pods : [];
  return pods.map((item) => {
    const entry = object(item, "pod metric");
    const containers = Array.isArray(entry.containers) ? entry.containers : [];
    return {
      name: requiredText(entry.name, "name", 253),
      ...(entry.namespace === undefined ? {} : { namespace: optionalText(entry.namespace, "namespace", 253) }),
      containers: containers.map((raw) => {
        const container = object(raw, "container metric");
        return {
          name: requiredText(container.name, "container.name", 253),
          cpu: (container.cpu === undefined ? "" : optionalText(container.cpu, "container.cpu", 32)) || "",
          memory: (container.memory === undefined ? "" : optionalText(container.memory, "container.memory", 32)) || "",
        };
      }),
    };
  });
}

/** Maps raw event rows from the core list endpoint into renderer events. */
export function resourceEventList(items: CoreResourceRow[]): ResourceEvent[] {
  return items.map((item) => ({
    name: item.name,
    namespace: item.namespace || "",
    reason: item.reason,
    message: item.message,
    type: item.type,
    count: item.count,
    lastTimestamp: item.lastTimestamp,
  }));
}

const ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#39|nbsp);/g;
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

/** Turns a GitHub release body into safe plain text; the renderer never renders update notes as HTML. */
export function releaseNotesText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const withoutMarkup = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");
  const text = withoutMarkup
    .replace(ENTITY_PATTERN, (_, entity: string) => ENTITIES[entity] ?? " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 4_000) : undefined;
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, label: string, max: number): string {
  const text = optionalText(value, label, max);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > max) throw new Error(`${label} is too long`);
  return value;
}
