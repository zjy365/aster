// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { highlightYaml } from "./yaml-highlight";

describe("highlightYaml", () => {
  it("highlights YAML with dual-theme CSS variables and preserves text", async () => {
    const html = await highlightYaml("replicas: 2\nimage: nginx");

    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain("replicas");
    expect(html).toContain("nginx");
    expect(html).not.toContain("wasm");
  });

  it("reuses the cached highlighter across calls", async () => {
    const [first, second] = await Promise.all([highlightYaml("a: 1"), highlightYaml("b: 2")]);
    expect(first).toContain("a");
    expect(second).toContain("b");
  });
});
