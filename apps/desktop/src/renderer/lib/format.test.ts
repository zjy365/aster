import { describe, expect, it } from "vitest";
import { formatCpuUsage, formatMemoryUsage, formatReady } from "./format";

describe("formatCpuUsage", () => {
  it("keeps millicores compact", () => {
    expect(formatCpuUsage("1500m")).toBe("1500m");
    expect(formatCpuUsage("250m")).toBe("250m");
    expect(formatCpuUsage("0m")).toBe("0m");
  });

  it("keeps whole cores as decimals", () => {
    expect(formatCpuUsage("1")).toBe("1");
    expect(formatCpuUsage("1.5")).toBe("1.5");
    expect(formatCpuUsage("2")).toBe("2");
  });

  it("tolerates whitespace and case", () => {
    expect(formatCpuUsage(" 500M ")).toBe("500m");
    expect(formatCpuUsage("0.25M")).toBe("0.25m");
  });

  it("converts metrics-server nanocores to millicores", () => {
    expect(formatCpuUsage("22159600n")).toBe("22m");
    expect(formatCpuUsage("999999n")).toBe("1m");
    expect(formatCpuUsage("1500000000n")).toBe("1.5");
    expect(formatCpuUsage("250000u")).toBe("250m");
  });

  it("returns a dash for empty or malformed input", () => {
    expect(formatCpuUsage("")).toBe("-");
    expect(formatCpuUsage("nope")).toBe("-");
    expect(formatCpuUsage("12m33")).toBe("-");
    expect(formatCpuUsage("m")).toBe("-");
    expect(formatCpuUsage("n")).toBe("-");
  });
});

describe("formatMemoryUsage", () => {
  it("renders binary units", () => {
    expect(formatMemoryUsage("128Mi")).toBe("128.0 MiB");
    expect(formatMemoryUsage("1Gi")).toBe("1.0 GiB");
    expect(formatMemoryUsage("512Ki")).toBe("512.0 KiB");
    expect(formatMemoryUsage("2Ti")).toBe("2.0 TiB");
  });

  it("renders plain byte counts", () => {
    expect(formatMemoryUsage("123")).toBe("123B");
  });

  it("handles fractional quantities", () => {
    expect(formatMemoryUsage("1.5Gi")).toBe("1.5 GiB");
  });

  it("returns a dash for empty or malformed input", () => {
    expect(formatMemoryUsage("")).toBe("-");
    expect(formatMemoryUsage("lots")).toBe("-");
    expect(formatMemoryUsage("12MiB")).toBe("-");
    expect(formatMemoryUsage("1.2.3Gi")).toBe("-");
  });
});

describe("formatReady", () => {
  it("renders ready/desired and plain counts", () => {
    expect(formatReady({ ready: 2, desired: 3 } as never)).toBe("2/3");
    expect(formatReady({ ready: 1 } as never)).toBe("1");
    expect(formatReady({} as never)).toBe("-");
  });
});
