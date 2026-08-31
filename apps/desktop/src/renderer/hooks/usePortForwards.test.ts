import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktop } from "../lib/desktop";
import { forwardKey, getPortForwardSnapshotForTests, resetPortForwardStoreForTests, startPortForward, stopPortForward } from "./usePortForwards";

vi.mock("../lib/desktop", () => ({
  desktop: {
    resources: {
    portForwardStart: vi.fn(),
    portForwardStop: vi.fn(),
    },
  },
}));

const startMock = vi.mocked(desktop.resources.portForwardStart);
const stopMock = vi.mocked(desktop.resources.portForwardStop);

const baseRequest = { contextId: "dev", namespace: "apps", name: "web", podPort: 8080 };

describe("port forward store", () => {
  beforeEach(() => {
    startMock.mockReset();
    stopMock.mockReset();
    resetPortForwardStoreForTests();
  });

  it("starts a forward and records the local port", async () => {
    startMock.mockResolvedValue({ id: "pf-1", localPort: 49152, pod: "web-a" });
    await startPortForward(baseRequest);
    const entry = getPortForwardSnapshotForTests().get(forwardKey("Pod", "apps", "web", 8080));
    expect(entry?.localPort).toBe(49152);
    expect(entry?.id).toBe("pf-1");
    expect(entry?.pod).toBe("web-a");
    expect(entry?.busy).toBe(false);
    expect(entry?.error).toBeUndefined();
  });

  it("ignores a duplicate start while one is busy", async () => {
    let resolve: (value: { id: string; localPort: number }) => void = () => {};
    startMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const first = startPortForward(baseRequest);
    await startPortForward(baseRequest);
    expect(startMock).toHaveBeenCalledTimes(1);
    resolve({ id: "pf-1", localPort: 1 });
    await first;
  });

  it("records start failures on the entry", async () => {
    startMock.mockRejectedValue(new Error("no ready endpoints"));
    await startPortForward(baseRequest);
    const entry = getPortForwardSnapshotForTests().get(forwardKey("Pod", "apps", "web", 8080));
    expect(entry?.error).toContain("no ready endpoints");
    expect(entry?.localPort).toBeUndefined();
  });

  it("stops a forward and removes the entry", async () => {
    startMock.mockResolvedValue({ id: "pf-1", localPort: 49152 });
    await startPortForward(baseRequest);
    const key = forwardKey("Pod", "apps", "web", 8080);
    await stopPortForward(key);
    expect(stopMock).toHaveBeenCalledWith("pf-1");
    expect(getPortForwardSnapshotForTests().get(key)).toBeUndefined();
  });

  it("stops a failed forward without calling the backend", async () => {
    startMock.mockRejectedValue(new Error("boom"));
    await startPortForward(baseRequest);
    const key = forwardKey("Pod", "apps", "web", 8080);
    await stopPortForward(key);
    expect(stopMock).not.toHaveBeenCalled();
    expect(getPortForwardSnapshotForTests().get(key)).toBeUndefined();
  });
});
