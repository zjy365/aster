// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../shared/types";
import { customResourceGroups, findKindInGroups, flattenResourceGroups, SIDEBAR_RESOURCE_GROUPS } from "./resource-catalog";

const discovered: DiscoveredResource[] = [
  { group: "example.com", version: "v1", resource: "widgets", kind: "Widget", namespaced: true },
  { group: "example.com", version: "v1", resource: "gadgets", kind: "Gadget", namespaced: false },
  { group: "cert-manager.io", version: "v1", resource: "certificates", kind: "Certificate", namespaced: true },
];

describe("customResourceGroups", () => {
  it("nests API groups under a single Custom Resources umbrella", () => {
    const groups = customResourceGroups(discovered);
    expect(groups).toHaveLength(1);
    const umbrella = groups[0];
    expect(umbrella.label).toBe("Custom Resources");
    expect(umbrella.items).toEqual([]);
    expect(umbrella.children?.map((group) => group.label)).toEqual(["example.com", "cert-manager.io"]);
    const widgets = umbrella.children?.[0].items[0];
    expect(widgets?.id).toBe("crd:example.com/v1/widgets");
    expect(widgets?.label).toBe("Widgets");
    expect(widgets?.enabled).toBe(true);
    expect(widgets?.namespaced).toBe(true);
  });

  it("returns no groups for empty discovery", () => {
    expect(customResourceGroups([])).toEqual([]);
  });

  it("folds subdomains of one project into a single domain section", () => {
    const groups = customResourceGroups([
      { group: "devbox.sealos.io", version: "v1", resource: "devboxes", kind: "Devbox", namespaced: true },
      { group: "user.sealos.io", version: "v1", resource: "users", kind: "User", namespaced: false },
      { group: "objectstorage.sealos.io", version: "v1", resource: "buckets", kind: "Bucket", namespaced: true },
      { group: "sts.min.io", version: "v1", resource: "policies", kind: "Policy", namespaced: false },
    ]);
    const umbrella = groups[0];
    expect(umbrella.children?.map((group) => group.label)).toEqual(["sealos.io", "sts.min.io"]);

    const sealos = umbrella.children?.[0];
    expect(sealos?.items).toEqual([]);
    expect(sealos?.children?.map((group) => group.label)).toEqual(["devbox", "user", "objectstorage"]);
    expect(sealos?.children?.[0].items[0]?.id).toBe("crd:devbox.sealos.io/v1/devboxes");

    // A domain holding a single API group stays flat under its full name.
    const minio = umbrella.children?.[1];
    expect(minio?.children).toBeUndefined();
    expect(minio?.items[0]?.id).toBe("crd:sts.min.io/v1/policies");
  });

  it("nests legacy Kubernetes API groups under k8s.io", () => {
    const groups = customResourceGroups([
      { group: "autoscaling", version: "v2", resource: "horizontalpodautoscalers", kind: "HorizontalPodAutoscaler", namespaced: true },
      { group: "scheduling.k8s.io", version: "v1", resource: "priorityclasses", kind: "PriorityClass", namespaced: false },
    ]);
    const k8s = groups[0].children?.[0];
    expect(k8s?.label).toBe("k8s.io");
    expect(k8s?.children?.map((group) => group.label)).toEqual(["autoscaling", "scheduling"]);
  });

  it("keeps a domain section flat when the API group is the domain itself", () => {
    const groups = customResourceGroups([
      { group: "cert-manager.io", version: "v1", resource: "certificates", kind: "Certificate", namespaced: true },
    ]);
    const child = groups[0].children?.[0];
    expect(child?.label).toBe("cert-manager.io");
    expect(child?.children).toBeUndefined();
    expect(child?.items[0]?.id).toBe("crd:cert-manager.io/v1/certificates");
  });
});

describe("flattenResourceGroups", () => {
  it("yields top-level and nested items in sidebar order", () => {
    const groups = [...SIDEBAR_RESOURCE_GROUPS, ...customResourceGroups(discovered)];
    const items = flattenResourceGroups(groups);
    expect(items.some((item) => item.id === "deployments")).toBe(true);
    expect(items.map((item) => item.id)).toContain("crd:cert-manager.io/v1/certificates");
    const widgetsIndex = items.findIndex((item) => item.id === "crd:example.com/v1/widgets");
    const gadgetsIndex = items.findIndex((item) => item.id === "crd:example.com/v1/gadgets");
    const certificatesIndex = items.findIndex((item) => item.id === "crd:cert-manager.io/v1/certificates");
    expect(widgetsIndex).toBeGreaterThan(-1);
    expect(widgetsIndex).toBeLessThan(gadgetsIndex);
    expect(gadgetsIndex).toBeLessThan(certificatesIndex);
  });
});

describe("findKindInGroups", () => {
  it("resolves nested custom kinds into plain ResourceKind values", () => {
    const groups = customResourceGroups(discovered);
    const kind = findKindInGroups(groups, "crd:example.com/v1/widgets");
    expect(kind).toEqual({
      id: "crd:example.com/v1/widgets",
      group: "example.com",
      version: "v1",
      resource: "widgets",
      kind: "Widget",
      namespaced: true,
      category: "Custom",
    });
    expect(findKindInGroups(groups, "crd:missing")).toBeUndefined();
  });

  it("resolves kinds nested two levels deep under a domain section", () => {
    const groups = customResourceGroups([
      { group: "devbox.sealos.io", version: "v1", resource: "devboxes", kind: "Devbox", namespaced: true },
      { group: "user.sealos.io", version: "v1", resource: "users", kind: "User", namespaced: false },
    ]);
    const items = flattenResourceGroups(groups);
    expect(items.map((item) => item.id)).toEqual([
      "crd:devbox.sealos.io/v1/devboxes",
      "crd:user.sealos.io/v1/users",
    ]);
    expect(findKindInGroups(groups, "crd:user.sealos.io/v1/users")?.kind).toBe("User");
  });
});
