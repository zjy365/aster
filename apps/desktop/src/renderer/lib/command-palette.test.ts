// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ContextInfo, NamespaceInfo } from "../../shared/types";
import {
  buildCommandItems,
  commandFilter,
  groupCommandItems,
  type CommandPaletteState,
} from "./command-palette";

const contexts: ContextInfo[] = [
  { id: "prod", name: "prod-eu", cluster: "prod-cluster", server: "https://prod", user: "admin", namespace: "default", current: true },
  { id: "dev", name: "dev-local", cluster: "dev-cluster", server: "https://dev", user: "admin", namespace: "dev", current: false },
  { id: "broken", name: "broken", cluster: "gone", server: "https://gone", user: "admin", namespace: "", current: false, error: "unreachable" },
];

const namespaces: NamespaceInfo[] = [{ name: "default" }, { name: "kube-system" }];

function makeState(overrides: Partial<CommandPaletteState> = {}): CommandPaletteState {
  return {
    coreReady: true,
    contexts,
    activeContextId: "prod",
    resourceGroups: [
      {
        label: "Workloads",
        items: [
          { id: "deployments", kind: "Deployment", category: "Workloads" },
          { id: "pods-workloads", kind: "Pod", category: "Workloads", label: "Pods" },
          { id: "off", kind: "Thing", category: "Workloads", enabled: false },
        ],
      },
    ],
    activeKindId: "deployments",
    namespaces,
    activeNamespace: "default",
    theme: "system",
    ...overrides,
  };
}

describe("buildCommandItems", () => {
  it("builds actions, contexts, resources, namespaces and theme commands with markers", () => {
    const items = buildCommandItems(makeState());
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get("action:refresh")?.group).toBe("actions");
    expect(byId.get("context:prod")?.current).toBe(true);
    expect(byId.get("context:dev")?.current).toBe(false);
    expect(byId.get("kind:deployments")?.current).toBe(true);
    expect(byId.get("kind:deployments")?.hint).toBe("Workloads");
    expect(byId.get("kind:pods-workloads")?.label).toBe("Pods");
    expect(byId.get("namespace:default")?.current).toBe(true);
    expect(byId.get("namespace:all")?.current).toBe(false);
    expect(byId.get("theme:system")?.current).toBe(true);
    expect(byId.get("theme:dark")?.action).toEqual({ type: "set-theme", theme: "dark" });
  });

  it("disables unreachable contexts and skips disabled resource kinds", () => {
    const items = buildCommandItems(makeState({ coreReady: false }));
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get("context:broken")?.disabled).toBe(true);
    expect(byId.get("context:prod")?.disabled).toBe(true);
    expect(byId.get("action:refresh")?.disabled).toBe(true);
    expect(byId.has("kind:off")).toBe(false);
  });

  it("lists nested subgroup items with their own label as hint", () => {
    const items = buildCommandItems(makeState({
      resourceGroups: [
        {
          label: "Custom Resources",
          items: [],
          children: [
            {
              label: "devbox.sealos.io",
              items: [
                { id: "crd:devbox.sealos.io/v1alpha1/devboxes", kind: "Devbox", category: "Custom", label: "Devboxs" },
                { id: "crd:devbox.sealos.io/v1alpha1/off", kind: "Off", category: "Custom", enabled: false },
              ],
            },
          ],
        },
      ],
    }));
    const byId = new Map(items.map((item) => [item.id, item]));

    const devboxes = byId.get("kind:crd:devbox.sealos.io/v1alpha1/devboxes");
    expect(devboxes?.label).toBe("Devboxs");
    expect(devboxes?.hint).toBe("devbox.sealos.io");
    expect(devboxes?.keywords).toContain("devbox.sealos.io");
    expect(byId.has("kind:crd:devbox.sealos.io/v1alpha1/off")).toBe(false);
  });
});

describe("groupCommandItems", () => {
  it("keeps the fixed group order and omits empty groups", () => {
    const items = buildCommandItems(makeState({ namespaces: [] }));
    const groups = groupCommandItems(items);

    expect(groups.map((group) => group.id)).toEqual(["actions", "contexts", "resources", "namespaces", "appearance"]);
    const namespacesGroup = groups.find((group) => group.id === "namespaces");
    expect(namespacesGroup?.items.map((item) => item.id)).toEqual(["namespace:all"]);

    const noContexts = groupCommandItems(buildCommandItems(makeState({ contexts: [] })));
    expect(noContexts.some((group) => group.id === "contexts")).toBe(false);
  });
});

describe("commandFilter", () => {
  it("ranks exact, prefix and substring matches and hides the rest", () => {
    expect(commandFilter("kind:deployments", "deployment", ["Deployment"])).toBe(1);
    expect(commandFilter("kind:deployments", "depl", ["Deployment"])).toBe(0.9);
    expect(commandFilter("kind:deployments", "ploy", ["Deployment"])).toBe(0.6);
    expect(commandFilter("kind:deployments", "zzz", ["Deployment"])).toBe(0);
  });

  it("uses the best keyword and keeps everything on empty search", () => {
    expect(commandFilter("theme:dark", "dark", ["theme", "appearance", "dark"])).toBe(1);
    expect(commandFilter("anything", "")).toBe(1);
    expect(commandFilter("anything", "   ")).toBe(1);
  });
});
