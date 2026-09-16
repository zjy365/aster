import { parse } from "yaml";
import type { ResourceRow } from "../../shared/types";

export interface WorkloadCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface WorkloadContainer {
  name: string;
  image: string;
}

/**
 * Structured workload facts parsed from the live object YAML the core already
 * ships to the renderer. Everything here is a read-only projection — writes
 * still go through the mutation pipeline.
 */
export interface WorkloadDetails {
  /** `key=value,key2=value2` built from spec.selector.matchLabels; "" when absent. */
  selector: string;
  /** True when the selector also carries matchExpressions this projection drops. */
  selectorPartial: boolean;
  conditions: WorkloadCondition[];
  containers: WorkloadContainer[];
  /** Human-readable rollout strategy, e.g. "RollingUpdate · maxSurge 25%". */
  strategy: string;
  revision: string;
  serviceAccount: string;
  minReadySeconds?: number;
  annotations: Array<[string, string]>;
}

/** Annotations that duplicate dedicated rows or flood the aside. */
const HIDDEN_ANNOTATIONS = new Set([
  "kubectl.kubernetes.io/last-applied-configuration",
  "deployment.kubernetes.io/revision",
]);

const UNKNOWN: WorkloadDetails = {
  selector: "",
  selectorPartial: false,
  conditions: [],
  containers: [],
  strategy: "",
  revision: "",
  serviceAccount: "",
  annotations: [],
};

/**
 * Parses the object YAML into workload details. Returns undefined when the
 * YAML cannot be parsed at all; individual missing fields degrade to empty
 * values so partial objects (Jobs, CRD-ish workloads) still render.
 */
export function parseWorkloadDetails(yamlText: string): WorkloadDetails | undefined {
  if (!yamlText.trim()) return undefined;
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    return undefined;
  }
  if (!isRecord(doc)) return undefined;

  const meta = record(doc.metadata);
  const spec = record(doc.spec);
  const status = record(doc.status);
  // Workloads nest the pod spec under spec.template.spec; a Pod object is its
  // own spec. Both shapes surface containers and the service account.
  const templateSpec = record(record(spec?.template)?.spec);
  const podSpec = templateSpec ?? (doc.kind === "Pod" ? spec : undefined);

  const selector = record(spec?.selector);
  const matchLabels = record(selector?.matchLabels);
  const matchExpressions = selector?.matchExpressions;
  const annotations = record(meta?.annotations);

  return {
    selector: matchLabels
      ? Object.entries(matchLabels)
          .filter(([, value]) => typeof value === "string" || typeof value === "number")
          .map(([key, value]) => `${key}=${value}`)
          .join(",")
      : "",
    selectorPartial: Array.isArray(matchExpressions) && matchExpressions.length > 0,
    conditions: parseConditions(status?.conditions),
    containers: parseContainers(podSpec?.containers),
    strategy: formatStrategy(doc.kind, spec),
    revision: stringValue(annotations?.["deployment.kubernetes.io/revision"]),
    serviceAccount:
      stringValue(podSpec?.serviceAccountName) || stringValue(podSpec?.serviceAccount),
    minReadySeconds: numberValue(spec?.minReadySeconds),
    annotations: Object.entries(annotations ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .filter(([key]) => !HIDDEN_ANNOTATIONS.has(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}

/** Selector usable for a scoped pod list; undefined when it would be incomplete. */
export function podSelector(details: WorkloadDetails | undefined): string | undefined {
  if (!details || details.selectorPartial || !details.selector) return undefined;
  return details.selector;
}

export type RolloutState = "progressing" | "complete" | "stuck";

/**
 * Kinds whose open detail keeps a single-object live channel (#39): the
 * pod-owning controllers with rollout semantics. Everything else — Pods,
 * ConfigMaps, cluster-scoped kinds — keeps the pre-existing behavior (the
 * list watch bumps the selection; snapshot scopes stay frozen), so no watch
 * request ever leaves with an empty namespace.
 */
export function isRolloutWorkloadKind(kind: string): boolean {
  return kind === "Deployment" || kind === "StatefulSet" || kind === "DaemonSet"
    || kind === "ReplicaSet" || kind === "ReplicationController";
}

export interface RolloutStatus {
  state: RolloutState;
  /** Short human summary, e.g. "2/5 ready · 1 updated" or the condition reason. */
  message: string;
}

/**
 * Derives the rollout state from the Progressing condition plus the replica
 * counters, so "in progress / complete / stuck" is visible at a glance while
 * a rollout runs. The counters come from the live row, the condition from the
 * live YAML — both converge through the detail's single-object watch.
 * Counters decide completion whenever they are known: StatefulSet keeps
 * Progressing=True with a non-terminal reason long after it settles, so only
 * "ready == desired and updated == desired" can mark it complete (and lagging
 * counters keep an optimistic condition honest mid-rollout).
 * Returns undefined for objects without rollout semantics (no usable
 * condition and no replica counters, e.g. Pods, ConfigMaps, Jobs without
 * spec.replicas).
 */
export function rolloutStatus(
  details: WorkloadDetails | undefined,
  row: Pick<ResourceRow, "desired" | "ready" | "updated">,
): RolloutStatus | undefined {
  const condition = details?.conditions.find((item) => item.type === "Progressing");
  const replicas = replicaSummary(row);
  const countersSettled =
    row.desired !== undefined && row.ready !== undefined && row.ready === row.desired
    && (row.updated === undefined || row.updated === row.desired);
  if (condition) {
    if (condition.status === "False") {
      return {
        state: "stuck",
        message: [condition.reason || "Progressing=False", replicas].filter(Boolean).join(" · "),
      };
    }
    if (condition.status === "True" && /NewReplicaSetAvailable/i.test(condition.reason)) {
      return { state: "complete", message: [condition.reason, replicas].filter(Boolean).join(" · ") };
    }
    if (countersSettled) {
      return { state: "complete", message: replicas || "Rolled out" };
    }
    return {
      state: "progressing",
      message: [condition.reason || "Rolling out", replicas].filter(Boolean).join(" · "),
    };
  }
  // No usable Progressing condition (DaemonSets, pending first status):
  // the replica counters alone tell progress from completion.
  if (row.desired === undefined || row.ready === undefined) return undefined;
  if (row.ready < row.desired) {
    return { state: "progressing", message: replicaSummary(row) || "Rolling out" };
  }
  if (row.updated !== undefined && row.updated < row.desired) {
    return { state: "progressing", message: replicaSummary(row) || "Rolling out" };
  }
  return { state: "complete", message: replicaSummary(row) || "Ready" };
}

function replicaSummary(row: Pick<ResourceRow, "desired" | "ready" | "updated">): string {
  if (row.desired === undefined || row.ready === undefined) return "";
  const parts = [`${row.ready}/${row.desired} ready`];
  if (row.updated !== undefined) parts.push(`${row.updated} updated`);
  return parts.join(" · ");
}

function parseConditions(value: unknown): WorkloadCondition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((condition) => ({
    type: stringValue(condition.type),
    status: stringValue(condition.status),
    reason: stringValue(condition.reason),
    message: stringValue(condition.message),
    lastTransitionTime: stringValue(condition.lastTransitionTime),
  })).filter((condition) => condition.type);
}

function parseContainers(value: unknown): WorkloadContainer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord)
    .map((container) => ({
      name: stringValue(container.name),
      image: stringValue(container.image),
    }))
    .filter((container) => container.name || container.image);
}

function formatStrategy(kind: unknown, spec: Record<string, unknown> | undefined): string {
  if (!spec) return "";
  if (kind === "Deployment") {
    const strategy = record(spec.strategy);
    const type = stringValue(strategy?.type) || "RollingUpdate";
    if (type !== "RollingUpdate") return type;
    const rolling = record(strategy?.rollingUpdate);
    const parts = [
      stringValue(rolling?.maxSurge) && `maxSurge ${stringValue(rolling?.maxSurge)}`,
      stringValue(rolling?.maxUnavailable) && `maxUnavailable ${stringValue(rolling?.maxUnavailable)}`,
    ].filter(Boolean);
    return parts.length ? `${type} · ${parts.join(" · ")}` : type;
  }
  if (kind === "StatefulSet" || kind === "DaemonSet") {
    const update = record(spec.updateStrategy);
    const type = stringValue(update?.type);
    if (!type) return "";
    const partition = numberValue(record(update?.rollingUpdate)?.partition);
    return type === "RollingUpdate" && partition !== undefined
      ? `${type} · partition ${partition}`
      : type;
  }
  return "";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Empty projection for callers that render before the YAML arrives. */
export function emptyWorkloadDetails(): WorkloadDetails {
  return { ...UNKNOWN, conditions: [], containers: [], annotations: [] };
}
