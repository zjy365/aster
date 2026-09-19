import { describe, expect, it } from "vitest";
import type { ContextInfo } from "../../shared/types";
import { contextDisplayName, filterContexts, retainedContextChoice, sortContexts } from "./context-picker";

const contexts: ContextInfo[] = [
  { id: "staging-usw-admin", name: "staging-usw-admin", cluster: "staging-usw", server: "https://example.invalid", user: "admin", namespace: "", current: true },
  { id: "production-gzg", name: "sealos-gzg-admin", cluster: "gzg", server: "https://example.invalid", user: "admin", namespace: "", current: false },
  { id: "dev", name: "dev", cluster: "dev-cluster", server: "https://example.invalid", user: "admin", namespace: "", current: false },
];

describe("context picker", () => {
  it("searches the visible context identity without consulting credentials", () => {
    expect(filterContexts(contexts, "GZG").map((context) => context.id)).toEqual(["production-gzg"]);
    expect(filterContexts(contexts, "staging-usw").map((context) => context.id)).toEqual(["staging-usw-admin"]);
  });

  it("keeps a choice only while the refreshed kubeconfig still contains it", () => {
    expect(retainedContextChoice(contexts, "production-gzg")).toBe("production-gzg");
    expect(retainedContextChoice(contexts, "removed-context")).toBe("");
  });
});

describe("context aliases", () => {
  it("prefers the alias for the display name and falls back to the raw one", () => {
    const aliases = { dev: "Dev local" };
    expect(contextDisplayName(contexts[2], aliases)).toBe("Dev local");
    expect(contextDisplayName(contexts[0], aliases)).toBe("staging-usw-admin");
  });

  it("orders by display name only once an alias exists", () => {
    // No aliases: the input order is returned untouched.
    expect(sortContexts(contexts, {})).toEqual(contexts);
    const aliases = { dev: "AAA dev" };
    expect(sortContexts(contexts, aliases).map((context) => context.id))
      .toEqual(["dev", "production-gzg", "staging-usw-admin"]);
  });

  it("matches searches against the alias as well as the raw fields", () => {
    const aliases = { dev: "Dev local" };
    expect(filterContexts(contexts, "dev local", aliases).map((context) => context.id)).toEqual(["dev"]);
    // The raw name still finds the row after it was aliased.
    expect(filterContexts(contexts, "dev-cluster", aliases).map((context) => context.id)).toEqual(["dev"]);
    // Unfiltered lists also come back in display-name order.
    expect(filterContexts(contexts, "", aliases).map((context) => context.id))
      .toEqual(["dev", "production-gzg", "staging-usw-admin"]);
  });
});
