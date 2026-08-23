// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { buildMutationDiff, normalizeForDiff } from "./mutation-diff";

const LIVE = `apiVersion: apps/v1
kind: Deployment
metadata:
  generation: 8
  name: hello-world
  resourceVersion: "8722102729"
spec:
  replicas: 1
  template:
    spec:
      containers:
      - image: nginx
        name: hello-world
`;

describe("normalizeForDiff", () => {
  it("strips server-managed metadata so dry-run bumps disappear", () => {
    const dryRun = LIVE.replace("generation: 8", "generation: 9").replace(
      'resourceVersion: "8722102729"',
      'resourceVersion: "8722102730"',
    );
    expect(normalizeForDiff(dryRun)).toBe(normalizeForDiff(LIVE));
  });

  it("keeps user-facing fields untouched", () => {
    const normalized = normalizeForDiff(LIVE);
    expect(normalized).toContain("name: hello-world");
    expect(normalized).toContain("image: nginx");
  });

  it("returns raw text when the yaml cannot be parsed", () => {
    expect(normalizeForDiff("a: [unclosed")).toBe("a: [unclosed");
  });

  it("normalizes empty input to an empty string", () => {
    expect(normalizeForDiff("")).toBe("");
    expect(normalizeForDiff("  \n")).toBe("");
  });
});

describe("buildMutationDiff", () => {
  it("returns undefined when only server-managed fields changed", () => {
    const dryRun = LIVE.replace("generation: 8", "generation: 9");
    expect(buildMutationDiff("hello-world", LIVE, dryRun)).toBeUndefined();
  });

  it("produces hunks for real changes", () => {
    const dryRun = LIVE.replace("image: nginx", "image: nginx:1.29").replace("generation: 8", "generation: 9");
    const diff = buildMutationDiff("hello-world", LIVE, dryRun);
    expect(diff).toBeDefined();
    expect(diff?.type).toBe("change");
    expect(diff?.name).toBe("hello-world.yaml");
    expect(diff?.hunks.length).toBeGreaterThan(0);
  });

  it("treats an empty before side as a new file", () => {
    const diff = buildMutationDiff("hello-world", "", LIVE);
    expect(diff?.type).toBe("new");
  });

  it("treats an empty after side as a deletion", () => {
    const diff = buildMutationDiff("hello-world", LIVE, "");
    expect(diff?.type).toBe("deleted");
  });

  it("returns undefined when both sides are empty", () => {
    expect(buildMutationDiff("hello-world", "", "")).toBeUndefined();
  });
});
