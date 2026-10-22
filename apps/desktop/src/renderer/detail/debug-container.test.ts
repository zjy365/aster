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

  it("keeps quoted multiword shell arguments intact", () => {
    expect(parseDebugCommand("/bin/sh -c 'ps aux'"))
      .toEqual(["/bin/sh", "-c", "ps aux"]);
    expect(parseDebugCommand('/bin/sh, -c, "printf hello,world"'))
      .toEqual(["/bin/sh", "-c", "printf hello,world"]);
  });

  it("supports escaped separators and adjacent quoted fragments without expansion", () => {
    expect(parseDebugCommand(String.raw`echo hello\ world a\,b pre"two words"post '$HOME' "$(id)"`))
      .toEqual(["echo", "hello world", "a,b", "pretwo wordspost", "$HOME", "$(id)"]);
  });

  it("rejects incomplete quotes and escapes instead of sending a different command", () => {
    expect(() => parseDebugCommand("/bin/sh -c 'ps aux")).toThrow("Unclosed quote");
    expect(() => parseDebugCommand('echo "unfinished')).toThrow("Unclosed quote");
    expect(() => parseDebugCommand("echo trailing\\")).toThrow("Trailing backslash");
  });

  it("preserves backslashes in quoted shell scripts", () => {
    expect(parseDebugCommand(String.raw`/bin/sh -c "printf '%s\n' hello"`))
      .toEqual(["/bin/sh", "-c", String.raw`printf '%s\n' hello`]);
    expect(parseDebugCommand(String.raw`echo "a\"b" 'a\b'`))
      .toEqual(["echo", 'a"b', String.raw`a\b`]);
  });

  it("proposes a minimal shell image by default", () => {
    expect(DEFAULT_DEBUG_IMAGE).toBe("busybox:1.36");
  });
});
