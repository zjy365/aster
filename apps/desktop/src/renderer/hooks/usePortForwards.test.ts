import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktop } from "../lib/desktop";
import { discardPortForwards, forwardKey, getPendingForwardStopsForTests, getPortForwardSnapshotForTests, retryPendingForwardStops, resetPortForwardStoreForTests, setPortForwardContext, startPortForward, stopPortForward } from "./usePortForwards";

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
  beforeEach(async () => {
    startMock.mockReset();
    stopMock.mockReset();
    resetPortForwardStoreForTests();
    await setPortForwardContext("dev");
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

 describe("port forward ownership", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    resetPortForwardStoreForTests();
    await setPortForwardContext("dev");
  });

  it("stops existing forwards on context change without a mounted view", async () => {
    startMock.mockResolvedValue({ id: "old", localPort: 12345 });
    await startPortForward(baseRequest);
    await setPortForwardContext("prod");
    expect(stopMock).toHaveBeenCalledWith("old");
    expect(getPortForwardSnapshotForTests().size).toBe(0);
  });

  it("reclaims a late start after switching away and back to the same context", async () => {
    let resolve!: (value: { id: string; localPort: number }) => void;
    startMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = startPortForward(baseRequest);
    await setPortForwardContext("prod");
    await setPortForwardContext("dev");
    startMock.mockResolvedValueOnce({ id: "current", localPort: 12346 });
    await startPortForward(baseRequest);
    resolve({ id: "late", localPort: 12345 });
    await pending;
    expect(stopMock).toHaveBeenCalledWith("late");
    expect(getPortForwardSnapshotForTests().get(forwardKey("Pod", "apps", "web", 8080))?.id).toBe("current");
  });

  it("reclaims a start stopped before its response arrives", async () => {
    let resolve!: (value: { id: string; localPort: number }) => void;
    startMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = startPortForward(baseRequest);
    await stopPortForward(forwardKey("Pod", "apps", "web", 8080));
    resolve({ id: "late", localPort: 12345 });
    await pending;
    expect(stopMock).toHaveBeenCalledWith("late");
    expect(getPortForwardSnapshotForTests().size).toBe(0);
  });

  it("retains a failed stop so it can be retried", async () => {
    startMock.mockResolvedValue({ id: "active", localPort: 12345 });
    await startPortForward(baseRequest);
    stopMock.mockRejectedValueOnce(new Error("unavailable"));
    const key = forwardKey("Pod", "apps", "web", 8080);
    await stopPortForward(key);
    expect(getPortForwardSnapshotForTests().get(key)?.error).toBe("unavailable");
    expect(getPortForwardSnapshotForTests().get(key)?.id).toBe("active");
    await stopPortForward(key);
    expect(getPortForwardSnapshotForTests().size).toBe(0);
  });
});

describe("failed cleanup recovery", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    resetPortForwardStoreForTests();
    await setPortForwardContext("dev");
  });

  it("retains the old context and ID after cleanup fails and retries without that view", async () => {
    startMock.mockResolvedValue({ id: "active", localPort: 12345 });
    await startPortForward(baseRequest);
    stopMock.mockRejectedValueOnce(new Error("temporary IPC failure"));
    await setPortForwardContext("prod");
    expect(getPendingForwardStopsForTests()).toMatchObject([{ id: "active", contextId: "dev", localPort: 12345, error: "temporary IPC failure", busy: false }]);
    expect(getPortForwardSnapshotForTests().size).toBe(0);
    await retryPendingForwardStops();
    expect(stopMock).toHaveBeenCalledTimes(2);
    expect(getPendingForwardStopsForTests()).toEqual([]);
  });

  it("retains a late startup response when stopping it fails", async () => {
    let resolve!: (value: { id: string; localPort: number }) => void;
    startMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = startPortForward(baseRequest);
    await setPortForwardContext("prod");
    stopMock.mockRejectedValueOnce(new Error("unavailable"));
    resolve({ id: "late", localPort: 12345 });
    await pending;
    expect(getPendingForwardStopsForTests()).toMatchObject([{ id: "late", contextId: "dev", error: "unavailable" }]);
    await retryPendingForwardStops();
    expect(stopMock).toHaveBeenLastCalledWith("late");
    expect(getPendingForwardStopsForTests()).toEqual([]);
  });

  it("shares an in-flight stop when a context switch happens at the same time", async () => {
    startMock.mockResolvedValue({ id: "active", localPort: 12345 });
    await startPortForward(baseRequest);
    let resolve!: () => void;
    stopMock.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const stop = stopPortForward(forwardKey("Pod", "apps", "web", 8080));
    const change = setPortForwardContext("prod");
    await Promise.resolve();
    expect(stopMock).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.all([stop, change]);
    expect(getPendingForwardStopsForTests()).toEqual([]);
  });

  it("forgets retired IDs and ignores old responses after the sidecar exits", async () => {
    startMock.mockResolvedValueOnce({ id: "active", localPort: 12345 });
    await startPortForward(baseRequest);
    stopMock.mockRejectedValueOnce(new Error("offline"));
    await setPortForwardContext("prod");
    expect(getPendingForwardStopsForTests()).toHaveLength(1);
    let resolve!: (value: { id: string; localPort: number }) => void;
    startMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = startPortForward({ ...baseRequest, contextId: "prod" });
    discardPortForwards();
    resolve({ id: "old-process", localPort: 12346 });
    await pending;
    await retryPendingForwardStops();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(getPendingForwardStopsForTests()).toEqual([]);
  });
});
