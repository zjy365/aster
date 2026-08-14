import { describe, expect, it } from "vitest";
import { semanticDiff } from "./semantic-diff";

describe("semanticDiff", () => {
  it("shows live and dry-run headers plus changed lines", () => {
    expect(semanticDiff("replicas: 1\nimage: old", "replicas: 2\nimage: new")).toBe([
      "--- live object",
      "+++ dry-run object",
      "- replicas: 1",
      "- image: old",
      "+ replicas: 2",
      "+ image: new",
    ].join("\n"));
  });

  it("preserves unchanged lines and additions/removals", () => {
    expect(semanticDiff("a\nb", "a\nb\nc")).toContain("  a\n  b\n+ c");
    expect(semanticDiff("a\nb\nc", "a\nc")).toContain("  a\n- b\n  c");
  });
});
