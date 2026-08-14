import { describe, expect, it } from "vitest";
import { parseReadyMessage, sidecarExecutablePath } from "./sidecar";

describe("parseReadyMessage", () => {
  it("accepts a well-formed ready line", () => {
    expect(parseReadyMessage('{"type":"ready","address":"127.0.0.1","port":51234}')).toEqual({
      type: "ready",
      address: "127.0.0.1",
      port: 51234,
    });
  });

  it("rejects malformed JSON, wrong type, and out-of-range ports", () => {
    expect(() => parseReadyMessage("not json")).toThrow();
    expect(() => parseReadyMessage('{"type":"listening","port":80}')).toThrow(/invalid ready payload/);
    expect(() => parseReadyMessage('{"type":"ready","address":"127.0.0.1","port":0}')).toThrow(/invalid ready payload/);
    expect(() => parseReadyMessage('{"type":"ready","address":"127.0.0.1","port":70000}')).toThrow(/invalid ready payload/);
    expect(() => parseReadyMessage('{"type":"ready","address":"127.0.0.1","port":1.5}')).toThrow(/invalid ready payload/);
  });
});

describe("sidecarExecutablePath", () => {
  const base = {
    resourcesPath: "/Applications/Aster.app/Contents/Resources",
    currentDirectory: "/repo/apps/desktop/dist-electron/main",
    arch: "arm64",
    platform: "darwin" as NodeJS.Platform,
  };

  it("resolves the bundled core when packaged", () => {
    expect(sidecarExecutablePath({ ...base, isPackaged: true })).toBe("/Applications/Aster.app/Contents/Resources/core/aster-core");
  });

  it("resolves the dev binary per architecture", () => {
    expect(sidecarExecutablePath({ ...base, isPackaged: false })).toBe("/repo/core/bin/arm64/aster-core");
    expect(sidecarExecutablePath({ ...base, isPackaged: false, arch: "x64" })).toBe("/repo/core/bin/x64/aster-core");
  });

  it("uses the .exe suffix on Windows", () => {
    expect(sidecarExecutablePath({ ...base, isPackaged: true, platform: "win32" })).toContain("aster-core.exe");
  });
});
