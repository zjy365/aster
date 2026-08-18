import { describe, expect, it } from "vitest";
import { parseWorkloadDetails, podSelector } from "./workload-detail";

const DEPLOYMENT = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: brain-ui-staging
  namespace: brain-costcenter
  annotations:
    deployment.kubernetes.io/revision: "7"
    kubectl.kubernetes.io/last-applied-configuration: '{"huge":true}'
    team: platform
spec:
  replicas: 2
  minReadySeconds: 5
  selector:
    matchLabels:
      app: brain-ui
      tier: web
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
  template:
    spec:
      serviceAccountName: brain-ui
      containers:
        - name: web
          image: ghcr.io/labring/brain-ui:sha-dbc2de0
        - name: sidecar
          image: busybox:1.36
status:
  conditions:
    - type: Available
      status: "True"
      reason: MinimumReplicasAvailable
      message: Deployment has minimum availability.
      lastTransitionTime: "2026-08-12T13:49:39Z"
    - type: Progressing
      status: "True"
      reason: NewReplicaSetAvailable
      lastTransitionTime: "2026-08-12T13:50:01Z"
`;

describe("parseWorkloadDetails", () => {
  it("extracts selector, containers, strategy, revision, and conditions from a Deployment", () => {
    const details = parseWorkloadDetails(DEPLOYMENT);
    expect(details).toBeDefined();
    expect(details?.selector).toBe("app=brain-ui,tier=web");
    expect(details?.selectorPartial).toBe(false);
    expect(details?.strategy).toBe("RollingUpdate · maxSurge 25% · maxUnavailable 0");
    expect(details?.revision).toBe("7");
    expect(details?.serviceAccount).toBe("brain-ui");
    expect(details?.minReadySeconds).toBe(5);
    expect(details?.containers).toEqual([
      { name: "web", image: "ghcr.io/labring/brain-ui:sha-dbc2de0" },
      { name: "sidecar", image: "busybox:1.36" },
    ]);
    expect(details?.conditions).toHaveLength(2);
    expect(details?.conditions[0]).toMatchObject({ type: "Available", status: "True" });
  });

  it("hides last-applied and revision annotations from the display list", () => {
    const details = parseWorkloadDetails(DEPLOYMENT);
    expect(details?.annotations).toEqual([["team", "platform"]]);
  });

  it("reads a Job selector generated server-side", () => {
    const details = parseWorkloadDetails(`
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
spec:
  selector:
    matchLabels:
      batch.kubernetes.io/controller-uid: abc-123
  template:
    spec:
      containers:
        - name: migrate
          image: migrate:v2
`);
    expect(details?.selector).toBe("batch.kubernetes.io/controller-uid=abc-123");
    expect(details?.strategy).toBe("");
  });

  it("marks selectors carrying matchExpressions as partial", () => {
    const details = parseWorkloadDetails(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: partial
spec:
  selector:
    matchLabels:
      app: web
    matchExpressions:
      - key: tier
        operator: In
        values: [web]
`);
    expect(details?.selector).toBe("app=web");
    expect(details?.selectorPartial).toBe(true);
    expect(podSelector(details)).toBeUndefined();
  });

  it("formats StatefulSet update strategies including partition zero", () => {
    const details = parseWorkloadDetails(`
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0
`);
    expect(details?.strategy).toBe("RollingUpdate · partition 0");
  });

  it("returns undefined for unparseable or empty YAML", () => {
    expect(parseWorkloadDetails("")).toBeUndefined();
    expect(parseWorkloadDetails("  ")).toBeUndefined();
    expect(parseWorkloadDetails("a: [unclosed")).toBeUndefined();
    expect(parseWorkloadDetails("- just\n- a\n- list")).toBeUndefined();
  });

  it("degrades missing fields to empty values", () => {
    const details = parseWorkloadDetails("apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n");
    expect(details).toBeDefined();
    expect(details?.selector).toBe("");
    expect(details?.conditions).toEqual([]);
    expect(podSelector(details)).toBeUndefined();
  });
});

describe("podSelector", () => {
  it("returns the matchLabels selector when complete", () => {
    expect(podSelector(parseWorkloadDetails(DEPLOYMENT))).toBe("app=brain-ui,tier=web");
  });
});
