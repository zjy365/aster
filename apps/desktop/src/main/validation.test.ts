import { describe, expect, it } from "vitest";
import type { ResourceKind } from "../shared/types";
import {
  gvr,
  isSafeExternalUrl,
  normalizeRow,
  podExecRequest,
  podLogsRequest,
  readOnlyFlagValue,
  resourceGetRequest,
  resourceKey,
  resourceKindValue,
  resourceListRequest,
  resourceMutationRequest,
  themeSourceValue,
} from "./validation";

const kind: ResourceKind = {
  id: "deployments",
  group: "apps",
  version: "v1",
  resource: "deployments",
  kind: "Deployment",
  namespaced: true,
  category: "Workloads",
};

describe("resourceKindValue", () => {
  it("accepts a well-formed kind and coerces namespaced to a boolean", () => {
    expect(resourceKindValue(kind)).toEqual(kind);
    expect(resourceKindValue({ ...kind, namespaced: undefined }).namespaced).toBe(false);
  });

  it("rejects kinds missing identity fields", () => {
    expect(() => resourceKindValue({ ...kind, id: "" })).toThrow(/resourceKind\.id is required/);
    expect(() => resourceKindValue({ ...kind, resource: 7 })).toThrow(/must be a string/);
  });
});

describe("resourceListRequest", () => {
  it("parses a minimal request and drops absent optional fields", () => {
    expect(resourceListRequest({ contextId: "ctx", resourceKind: kind })).toEqual({ contextId: "ctx", resourceKind: kind });
  });

  it("enforces the server-side page size ceiling", () => {
    expect(resourceListRequest({ contextId: "ctx", resourceKind: kind, limit: 100 }).limit).toBe(100);
    expect(() => resourceListRequest({ contextId: "ctx", resourceKind: kind, limit: 501 })).toThrow(/limit must be between 1 and 500/);
    expect(() => resourceListRequest({ contextId: "ctx", resourceKind: kind, limit: 0 })).toThrow(/limit/);
  });

  it("rejects non-object payloads and overlong strings", () => {
    expect(() => resourceListRequest(null)).toThrow(/must be an object/);
    expect(() => resourceListRequest({ contextId: "x".repeat(513), resourceKind: kind })).toThrow(/too long/);
  });
});

describe("resourceGetRequest", () => {
  it("requires a name but keeps namespace optional", () => {
    expect(resourceGetRequest({ contextId: "ctx", resourceKind: kind, name: "web" })).toEqual({ contextId: "ctx", resourceKind: kind, name: "web" });
    expect(() => resourceGetRequest({ contextId: "ctx", resourceKind: kind })).toThrow(/name must be a string/);
  });
});

describe("resourceMutationRequest", () => {
  const base = { contextId: "ctx", resourceKind: kind, name: "web" };

  it("accepts the six supported operations", () => {
    for (const operation of ["scale", "image", "restart", "yaml", "create", "delete"] as const) {
      expect(resourceMutationRequest({ ...base, operation }).operation).toBe(operation);
    }
  });

  it("lets create omit the name but requires it for delete", () => {
    const create = resourceMutationRequest({ contextId: "ctx", resourceKind: kind, operation: "create", yaml: "kind: ConfigMap" });
    expect(create.name).toBe("");
    expect(() => resourceMutationRequest({ contextId: "ctx", resourceKind: kind, operation: "delete" })).toThrow(/name/);
  });

  it("rejects unknown operations and negative replicas", () => {
    expect(() => resourceMutationRequest({ ...base, operation: "patch" })).toThrow(/Unsupported mutation/);
    expect(() => resourceMutationRequest({ ...base, operation: "scale", replicas: -1 })).toThrow(/replicas/);
    expect(resourceMutationRequest({ ...base, operation: "scale", replicas: 0 }).replicas).toBe(0);
  });

  it("coerces dryRun to a boolean and caps yaml size", () => {
    expect(resourceMutationRequest({ ...base, operation: "yaml", yaml: "a: b", dryRun: 1 }).dryRun).toBe(true);
    expect(() => resourceMutationRequest({ ...base, operation: "yaml", yaml: "x".repeat(1_000_001) })).toThrow(/too long/);
  });
});

describe("podLogsRequest", () => {
  it("defaults tailLines and enforces the ceiling", () => {
    expect(podLogsRequest({ contextId: "ctx", namespace: "default", name: "pod" }).tailLines).toBe(2_000);
    expect(podLogsRequest({ contextId: "ctx", namespace: "default", name: "pod", tailLines: 50 }).tailLines).toBe(50);
    expect(() => podLogsRequest({ contextId: "ctx", namespace: "default", name: "pod", tailLines: 100_001 })).toThrow(/tailLines/);
  });
});

describe("podExecRequest", () => {
  it("accepts an argv array and rejects empty or oversized commands", () => {
    expect(podExecRequest({ contextId: "ctx", namespace: "default", name: "pod", command: ["ls", "-la"] }).command).toEqual(["ls", "-la"]);
    expect(() => podExecRequest({ contextId: "ctx", namespace: "default", name: "pod", command: [] })).toThrow(/argv/);
    expect(() => podExecRequest({ contextId: "ctx", namespace: "default", name: "pod", command: ["  "] })).toThrow(/argv/);
    expect(() => podExecRequest({ contextId: "ctx", namespace: "default", name: "pod", command: "ls" })).toThrow(/argv/);
  });
});

describe("row helpers", () => {
  it("gvr strips the kind down to its API coordinates", () => {
    expect(gvr(kind)).toEqual({ group: "apps", version: "v1", resource: "deployments" });
  });

  it("normalizeRow backfills empty optional identity fields", () => {
    expect(normalizeRow({ uid: "1", apiVersion: "v1", kind: "Pod", name: "p" })).toEqual({
      uid: "1",
      apiVersion: "v1",
      kind: "Pod",
      name: "p",
      namespace: "",
      resourceVersion: "",
      createdAt: "",
    });
  });

  it("resourceKey falls back to kind:namespace/name when uid is empty", () => {
    expect(resourceKey({ uid: "u", kind: "Pod", namespace: "ns", name: "p" })).toBe("u");
    expect(resourceKey({ uid: "", kind: "Pod", namespace: "ns", name: "p" })).toBe("Pod:ns/p");
  });
});

describe("environment value guards", () => {
  it("themeSourceValue accepts only the three theme sources", () => {
    expect(themeSourceValue("dark")).toBe("dark");
    expect(() => themeSourceValue("blue")).toThrow(/theme must be/);
  });

  it("readOnlyFlagValue requires a real boolean", () => {
    expect(readOnlyFlagValue(false)).toBe(false);
    expect(() => readOnlyFlagValue("false")).toThrow(/readOnly must be a boolean/);
  });

  it("isSafeExternalUrl allows http(s) only", () => {
    expect(isSafeExternalUrl("https://kubernetes.io")).toBe(true);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
