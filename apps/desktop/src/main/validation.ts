import type {
  DiscoveredResource,
  PodMetric,
  PortForwardStartRequest,
  RelatedResource,
  ResourceGetRequest,
  ResourceKind,
  ResourceListRequest,
  ResourceMutationRequest,
  ResourceRow,
  ResourceSearchRequest,
} from "../shared/types";

/**
 * Pure request parsers and row normalizers for the IPC boundary.
 * Every function here is deterministic and free of Electron or sidecar state
 * so the boundary contract can be tested without launching the app.
 */

export interface CoreListResponse {
  items: CoreResourceRow[];
  continueToken?: string;
  resourceVersion?: string;
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

export function resourceListRequest(input: unknown): ResourceListRequest {
  const value = object(input, "resource list request");
  const resourceKind = resourceKindValue(value.resourceKind);
  const limit = value.limit === undefined ? undefined : positiveInteger(value.limit, "limit", 500);
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    resourceKind,
    ...(value.namespace === undefined ? {} : { namespace: optionalText(value.namespace, "namespace", 253) }),
    ...(limit === undefined ? {} : { limit }),
    ...(value.continueToken === undefined ? {} : { continueToken: optionalText(value.continueToken, "continueToken", 16_384) }),
    ...(value.labelSelector === undefined ? {} : { labelSelector: optionalText(value.labelSelector, "labelSelector", 2_048) }),
    ...(value.fieldSelector === undefined ? {} : { fieldSelector: optionalText(value.fieldSelector, "fieldSelector", 2_048) }),
  };
}

export function resourceGetRequest(input: unknown): ResourceGetRequest {
  const value = object(input, "resource get request");
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    resourceKind: resourceKindValue(value.resourceKind),
    ...(value.namespace === undefined ? {} : { namespace: optionalText(value.namespace, "namespace", 253) }),
    name: requiredText(value.name, "name", 253),
  };
}

export function resourceMutationRequest(input: unknown): ResourceMutationRequest {
  const value = object(input, "resource mutation request");
  const operation = requiredText(value.operation, "operation", 32);
  if (!["scale", "image", "restart", "yaml", "create", "delete"].includes(operation)) throw new Error("Unsupported mutation operation");
  const replicas = value.replicas === undefined ? undefined : nonNegativeInteger(value.replicas, "replicas", 1_000_000);
  // create takes the object name from the YAML document; every other
  // operation addresses an existing object by name.
  const name = operation === "create"
    ? (value.name === undefined ? "" : optionalText(value.name, "name", 253) || "")
    : requiredText(value.name, "name", 253);
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    resourceKind: resourceKindValue(value.resourceKind),
    ...(value.namespace === undefined ? {} : { namespace: optionalText(value.namespace, "namespace", 253) }),
    name,
    operation: operation as ResourceMutationRequest["operation"],
    ...(replicas === undefined ? {} : { replicas }),
    ...(value.image === undefined ? {} : { image: requiredText(value.image, "image", 4_096) }),
    ...(value.container === undefined ? {} : { container: optionalText(value.container, "container", 253) }),
    ...(value.yaml === undefined ? {} : { yaml: requiredText(value.yaml, "yaml", 1_000_000) }),
    ...(value.dryRun === undefined ? {} : { dryRun: Boolean(value.dryRun) }),
    ...(value.resourceVersion === undefined ? {} : { resourceVersion: optionalText(value.resourceVersion, "resourceVersion", 128) }),
  };
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

export function resourceSearchRequest(input: unknown): ResourceSearchRequest {
  const value = object(input, "resource search request");
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    query: requiredText(value.query, "query", 128),
    ...(value.namespace === undefined ? {} : { namespace: optionalText(value.namespace, "namespace", 253) }),
  };
}

export function portForwardStartRequest(input: unknown): PortForwardStartRequest {
  const value = object(input, "port-forward request");
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    namespace: requiredText(value.namespace, "namespace", 253),
    name: requiredText(value.name, "name", 253),
    podPort: positiveInteger(value.podPort, "podPort", 65_535),
  };
}

export function portForwardStopRequest(input: unknown): string {
  return requiredText(input, "id", 64);
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

export function podLogsRequest(input: unknown): { contextId: string; namespace: string; name: string; container?: string; tailLines: number } {
  const value = object(input, "pod logs request");
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    namespace: requiredText(value.namespace, "namespace", 253),
    name: requiredText(value.name, "name", 253),
    ...(value.container === undefined ? {} : { container: optionalText(value.container, "container", 253) }),
    tailLines: value.tailLines === undefined ? 2_000 : positiveInteger(value.tailLines, "tailLines", 100_000),
  };
}

export function podExecRequest(input: unknown): { contextId: string; namespace: string; name: string; container?: string; command: string[] } {
  const value = object(input, "pod exec request");
  const rawCommand = value.command;
  if (!Array.isArray(rawCommand) || rawCommand.length === 0 || rawCommand.length > 32 || rawCommand.some((item) => typeof item !== "string" || !item.trim() || item.length > 4_096)) throw new Error("command must be a non-empty argv array");
  return {
    contextId: requiredText(value.contextId, "contextId", 512),
    namespace: requiredText(value.namespace, "namespace", 253),
    name: requiredText(value.name, "name", 253),
    command: rawCommand as string[],
    ...(value.container === undefined ? {} : { container: optionalText(value.container, "container", 253) }),
  };
}

export function resourceKindValue(input: unknown): ResourceKind {
  const value = object(input, "resource kind");
  return {
    id: requiredText(value.id, "resourceKind.id", 128),
    group: optionalText(value.group, "resourceKind.group", 253),
    version: requiredText(value.version, "resourceKind.version", 64),
    resource: requiredText(value.resource, "resourceKind.resource", 128),
    kind: requiredText(value.kind, "resourceKind.kind", 128),
    namespaced: Boolean(value.namespaced),
    category: requiredText(value.category, "resourceKind.category", 128),
  };
}

export function gvr(kind: { group: string; version: string; resource: string }) {
  return { group: kind.group, version: kind.version, resource: kind.resource };
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

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function themeSourceValue(input: unknown): "system" | "light" | "dark" {
  if (input !== "system" && input !== "light" && input !== "dark") {
    throw new Error("theme must be system, light, or dark");
  }
  return input;
}

export function readOnlyFlagValue(input: unknown): boolean {
  if (typeof input !== "boolean") throw new Error("readOnly must be a boolean");
  return input;
}

/** Standalone string field guard for IPC arguments that are not part of a larger payload. */
export function requiredTextField(value: unknown, label: string, max: number): string {
  return requiredText(value, label, max);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = optionalText(value, label, max);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function optionalText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  if (value.length > max) throw new Error(`${label} is too long`);
  return value;
}

function positiveInteger(value: unknown, label: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > max) throw new Error(`${label} must be between 1 and ${max}`);
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) throw new Error(`${label} must be between 0 and ${max}`);
  return value as number;
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
