import { describe, expect, it } from "vitest";
import {
  normalizeRow,
  releaseNotesText,
  resourceEventList,
  resourceKey,
} from "./normalize";

describe("normalizeRow", () => {
  it("backfills empty optional identity fields", () => {
    expect(normalizeRow({ uid: "1", apiVersion: "v1", kind: "Pod", name: "p" })).toEqual({
      uid: "1",
      apiVersion: "v1",
      kind: "Pod",
      name: "p",
      namespace: "",
      resourceVersion: "",
      createdAt: "",
    });
  });
});

describe("resourceKey", () => {
  it("falls back to kind:namespace/name when uid is empty", () => {
    expect(resourceKey({ uid: "u", kind: "Pod", namespace: "ns", name: "p" })).toBe("u");
    expect(resourceKey({ uid: "", kind: "Pod", namespace: "ns", name: "p" })).toBe("Pod:ns/p");
  });
});

describe("resourceEventList", () => {
  it("maps raw core rows into renderer events and backfills namespace", () => {
    expect(resourceEventList([
      { uid: "1", apiVersion: "v1", kind: "Event", name: "e1", reason: "Scheduled", message: "ok", type: "Normal", count: 2, lastTimestamp: "2026-01-01" },
    ])).toEqual([
      { name: "e1", namespace: "", reason: "Scheduled", message: "ok", type: "Normal", count: 2, lastTimestamp: "2026-01-01" },
    ]);
  });
});

describe("releaseNotesText", () => {
  it("strips markup into safe plain text", () => {
    expect(releaseNotesText("## Fixed\n- <b>Crash</b> on start &amp; connect")).toBe("Fixed\n- Crash on start & connect");
    expect(releaseNotesText("See [the changelog](https://example.com) for details.")).toBe("See the changelog for details.");
    expect(releaseNotesText("<!-- hidden comment --><script>alert(1)</script>ok")).toBe("alert(1) ok");
    expect(releaseNotesText(42)).toBeUndefined();
    expect(releaseNotesText("   ")).toBeUndefined();
    expect(releaseNotesText("x".repeat(5_000))?.length).toBe(4_000);
  });
});
