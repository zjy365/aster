// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { DiscoveredResource } from "../../shared/types";
import { customResourceGroups, findKindInGroups } from "./resource-catalog";

const discovered: DiscoveredResource[] = [
  { group: "example.com", version: "v1", resource: "widgets", kind: "Widget", namespaced: true },
  { group: "example.com", version: "v1", resource: "gadgets", kind: "Gadget", namespaced: false },
  { group: "cert-manager.io", version: "v1", resource: "certificates", kind: "Certificate", namespaced: true },
];

describe("customResourceGroups", () => {
  it("groups custom kinds by API group with stable ids", () => {
    const groups = customResourceGroups(discovered);
    expect(groups.map((group) => group.label)).toEqual(["example.com", "cert-manager.io"]);
    const widgets = groups[0].items[0];
    expect(widgets.id).toBe("crd:example.com/v1/widgets");
    expect(widgets.label).toBe("Widgets");
    expect(widgets.enabled).toBe(true);
    expect(widgets.namespaced).toBe(true);
  });

  it("returns no groups for empty discovery", () => {
    expect(customResourceGroups([])).toEqual([]);
  });
});

describe("findKindInGroups", () => {
  it("resolves custom kinds into plain ResourceKind values", () => {
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
});
