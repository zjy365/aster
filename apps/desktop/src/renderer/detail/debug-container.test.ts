import { describe, expect, it } from "vitest";

import { DEFAULT_DEBUG_IMAGE, parseDebugCommand } from "./debug-container";

describe("parseDebugCommand", () => {
  it("splits on spaces and commas and drops empties", () => {
    expect(parseDebugCommand("/bin/sh -c ps aux")).toEqual(["/bin/sh", "-c", "ps", "aux"]);
    expect(parseDebugCommand("/bin/sh,-c,ps aux")).toEqual(["/bin/sh", "-c", "ps", "aux"]);
    expect(parseDebugCommand("  /bin/sh   -c  ")).toEqual(["/bin/sh", "-c"]);
  });

  it("returns an empty argv for blank input", () => {
    expect(parseDebugCommand("")).toEqual([]);
    expect(parseDebugCommand("   ")).toEqual([]);
    expect(parseDebugCommand(" , , ")).toEqual([]);
  });

  it("proposes a minimal shell image by default", () => {
    expect(DEFAULT_DEBUG_IMAGE).toBe("busybox:1.36");
  });
});
