import { describe, expect, it } from "vitest";
import { totalPodUsage } from "../lib/format";

const containers = (items: { cpu?: string; memory?: string }[]) =>
  items.map((container, index) => ({
    name: `c${index}`,
    cpu: container.cpu ?? "",
    memory: container.memory ?? "",
  }));

describe("totalPodUsage", () => {
  it("sums cpu and memory across containers", () => {
    const usage = totalPodUsage(containers([
      { cpu: "500m", memory: "64Mi" },
      { cpu: "250m", memory: "128Mi" },
    ]));
    expect(usage.cpuMillicores).toBe(750);
    expect(usage.memoryBytes).toBe(64 * 1024 ** 2 + 128 * 1024 ** 2);
  });

  it("converts whole cores to millicores", () => {
    const usage = totalPodUsage(containers([{ cpu: "1", memory: "1Gi" }]));
    expect(usage.cpuMillicores).toBe(1000);
    expect(usage.memoryBytes).toBe(1024 ** 3);
  });

  it("handles a single container", () => {
    const usage = totalPodUsage(containers([{ cpu: "1500m", memory: "96Mi" }]));
    expect(usage.cpuMillicores).toBe(1500);
    expect(usage.memoryBytes).toBe(96 * 1024 ** 2);
  });

  it("leaves totals undefined when no container reports usage", () => {
    const usage = totalPodUsage(containers([{}, {}]));
    expect(usage.cpuMillicores).toBeUndefined();
    expect(usage.memoryBytes).toBeUndefined();
  });
});
