import { parse } from "yaml";

/** A declared port a forward can be started from. */
export interface ForwardPort {
  label: string;
  port: number;
  protocol: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containerPorts(containers: unknown): ForwardPort[] {
  if (!Array.isArray(containers)) return [];
  const result: ForwardPort[] = [];
  for (const raw of containers) {
    if (!isRecord(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name : "";
    if (!Array.isArray(raw.ports)) continue;
    for (const portRaw of raw.ports) {
      if (!isRecord(portRaw)) continue;
      const port = typeof portRaw.containerPort === "number" ? portRaw.containerPort : NaN;
      const protocol = typeof portRaw.protocol === "string" ? portRaw.protocol : "TCP";
      if (!Number.isInteger(port) || protocol.toUpperCase() !== "TCP") continue;
      result.push({ label: name, port, protocol: "TCP" });
    }
  }
  return result;
}

function servicePorts(ports: unknown): ForwardPort[] {
  if (!Array.isArray(ports)) return [];
  const result: ForwardPort[] = [];
  for (const raw of ports) {
    if (!isRecord(raw)) continue;
    const port = typeof raw.port === "number" ? raw.port : NaN;
    const protocol = typeof raw.protocol === "string" ? raw.protocol : "TCP";
    if (!Number.isInteger(port) || protocol.toUpperCase() !== "TCP") continue;
    const name = typeof raw.name === "string" && raw.name ? raw.name : String(port);
    result.push({ label: name, port, protocol: "TCP" });
  }
  return result;
}

/**
 * Extracts forwardable TCP ports from a resource's YAML. Pods contribute
 * container ports, Services their spec ports, and workloads the pod
 * template's container ports. UDP ports are never forwardable.
 */
export function extractForwardPorts(kind: string, yamlText: string): ForwardPort[] {
  if (!yamlText.trim()) return [];
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch {
    return [];
  }
  if (!isRecord(doc)) return [];
  const spec = isRecord(doc.spec) ? doc.spec : {};
  if (kind === "Pod") {
    return containerPorts(spec.containers);
  }
  if (kind === "Service") {
    return servicePorts(spec.ports);
  }
  if (isRecord(spec.template) && isRecord(spec.template.spec)) {
    return containerPorts(spec.template.spec.containers);
  }
  return [];
}

