import { describe, expect, it } from "vitest";
import { WriteSafetyPolicy } from "./write-safety";

describe("WriteSafetyPolicy", () => {
  it("defaults every context to read-only and isolates explicit overrides", () => {
    const policy = new WriteSafetyPolicy();
    expect(policy.isReadOnly("staging")).toBe(true);
    policy.setReadOnly("staging", false);
    expect(policy.isReadOnly("staging")).toBe(false);
    expect(policy.isReadOnly("production")).toBe(true);
  });

  it("blocks both mutation and exec operations until writes are enabled", () => {
    const policy = new WriteSafetyPolicy();
    expect(() => policy.assertWriteAllowed("dev", "Pod exec")).toThrow(/read-only/);
    policy.setReadOnly("dev", false);
    expect(() => policy.assertWriteAllowed("dev", "Pod exec")).not.toThrow();
  });
});
