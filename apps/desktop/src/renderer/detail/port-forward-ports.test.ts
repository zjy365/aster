import { describe, expect, it } from "vitest";
import { extractForwardPorts } from "./port-forward-ports";

const POD = `
apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: apps
spec:
  containers:
    - name: app
      ports:
        - containerPort: 8080
          protocol: TCP
        - containerPort: 9090
          protocol: UDP
    - name: sidecar
      ports:
        - containerPort: 8081
`;

const SERVICE = `
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - name: http
      port: 80
      protocol: TCP
    - name: dns
      port: 53
      protocol: UDP
`;

const DEPLOYMENT = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    spec:
      containers:
        - name: app
          ports:
            - containerPort: 8080
`;

describe("extractForwardPorts", () => {
  it("extracts TCP container ports from a pod", () => {
    const ports = extractForwardPorts("Pod", POD);
    expect(ports).toEqual([
      { label: "app", port: 8080, protocol: "TCP" },
      { label: "sidecar", port: 8081, protocol: "TCP" },
    ]);
  });

  it("extracts TCP ports from a service", () => {
    const ports = extractForwardPorts("Service", SERVICE);
    expect(ports).toEqual([
      { label: "http", port: 80, protocol: "TCP" },
    ]);
  });

  it("extracts pod-template ports from a workload", () => {
    const ports = extractForwardPorts("Deployment", DEPLOYMENT);
    expect(ports).toEqual([
      { label: "app", port: 8080, protocol: "TCP" },
    ]);
  });

  it("returns empty for kinds without ports", () => {
    expect(extractForwardPorts("ConfigMap", "kind: ConfigMap")).toEqual([]);
  });
});
