// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSettingsFile, normalizeSources, parseSettings, serializeSettings } from "./settings";

describe("parseSettings", () => {
  it("reads inline and block-list sources and drops unknown keys", () => {
    expect(parseSettings("kubeconfigSources: []")).toEqual({ kubeconfigSources: [] });
    expect(parseSettings('kubeconfigSources: ["~/a.yaml", ~/b.yaml]')).toEqual({
      kubeconfigSources: ["~/a.yaml", "~/b.yaml"],
    });
    expect(parseSettings("kubeconfigSources:\n  - /tmp/one.yaml\n  - \"/tmp/two dir/t.yaml\"\notherKey: 1\n")).toEqual({
      kubeconfigSources: ["/tmp/one.yaml", "/tmp/two dir/t.yaml"],
    });
  });

  it("round-trips through serialize", () => {
    const settings = { kubeconfigSources: ["/tmp/x.yaml", "/tmp/y dir/z.yaml"] };
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });
});

describe("normalizeSources", () => {
  it("keeps unique trimmed strings and caps the list", () => {
    expect(normalizeSources([" /a ", "/a", 42, "", "/b"])).toEqual(["/a", "/b"]);
    expect(normalizeSources("not-a-list")).toEqual([]);
    expect(normalizeSources(Array.from({ length: 100 }, (_, index) => `/s${index}`)).length).toBe(64);
  });
});

describe("createSettingsFile", () => {
  it("persists atomically and degrades to defaults when missing", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aster-settings-"));
    const file = createSettingsFile(path.join(directory, "nested", "config.yaml"));
    expect(file.read()).toEqual({ kubeconfigSources: [] });
    file.write({ kubeconfigSources: ["/kube/one.yaml"] });
    expect(file.read()).toEqual({ kubeconfigSources: ["/kube/one.yaml"] });
    const mode = fs.statSync(path.join(directory, "nested", "config.yaml")).mode & 0o777;
    expect(mode & 0o077).toBe(0o600 & 0o077);
  });
});
