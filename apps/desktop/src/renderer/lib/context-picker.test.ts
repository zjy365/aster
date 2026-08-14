import { describe, expect, it } from "vitest";
import type { ContextInfo } from "../../shared/types";
import { filterContexts, retainedContextChoice } from "./context-picker";

const contexts: ContextInfo[] = [
  { id: "staging-usw-admin", name: "staging-usw-admin", cluster: "staging-usw", server: "https://example.invalid", user: "admin", namespace: "", current: true },
  { id: "production-gzg", name: "sealos-gzg-admin", cluster: "gzg", server: "https://example.invalid", user: "admin", namespace: "", current: false },
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
