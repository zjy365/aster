import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortForwardSession } from "../../shared/types";
import { desktop } from "../lib/desktop";
import {
  forwardKey,
  getPortForwardSnapshotForTests,
  resetPortForwardStoreForTests,
  setPortForwardContext,
  startPortForward,
} from "./usePortForwards";
import { mergePortForwardRows, stopActionFor, type PortForwardRow } from "./usePortForwardSessions";

vi.mock("../lib/desktop", () => ({
  desktop: {
    resources: {
      portForwardStart: vi.fn(),
      portForwardStop: vi.fn(),
      portForwardList: vi.fn(),
    },
  },
}));

const startMock = vi.mocked(desktop.resources.portForwardStart);
const stopMock = vi.mocked(desktop.resources.portForwardStop);
const listMock = vi.mocked(desktop.resources.portForwardList);

function session(overrides: Partial<PortForwardSession> & Pick<PortForwardSession, "id">): PortForwardSession {
  return {
    contextId: "dev",
    namespace: "apps",
    resourceRef: { kind: "Pod", name: "web" },
    localPort: 49152,
    targetPort: 8080,
    startedAt: "2026-10-17T08:00:00Z",
    ...overrides,
  };
}

describe("mergePortForwardRows", () => {
  it("renders server sessions with cluster, resource, ports and start time", () => {
    const rows = mergePortForwardRows(
      [session({ id: "pf-a", pod: "web-abc", resourceRef: { kind: "Service", name: "web" } })],
      { contextId: "", entries: [] },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "pf-a",
      id: "pf-a",
      contextId: "dev",
      kind: "Service",
      namespace: "apps",
      name: "web",
      localPort: 49152,
      targetPort: 8080,
      startedAt: "2026-10-17T08:00:00Z",
      pod: "web-abc",
      busy: false,
      source: "server",
    });
    expect(stopActionFor(rows[0])).toEqual({ kind: "id", id: "pf-a" });
  });

  it("keeps the server row for ids both sides know and stops it through the store", () => {
    const rows = mergePortForwardRows(
      [session({ id: "pf-a", localPort: 51000 })],
      {
        contextId: "dev",
        entries: [{
          key: forwardKey("Pod", "apps", "web", 8080),
          kind: "Pod",
          namespace: "apps",
          name: "web",
          podPort: 8080,
          id: "pf-a",
          localPort: 49999,
          busy: false,
        }],
      },
    );
    expect(rows).toHaveLength(1);
    // The server's local port wins over the renderer's stale copy.
    expect(rows[0].localPort).toBe(51000);
    expect(rows[0].stopKey).toBe(forwardKey("Pod", "apps", "web", 8080));
    expect(stopActionFor(rows[0])).toEqual({ kind: "store", stopKey: forwardKey("Pod", "apps", "web", 8080) });
  });

  it("keeps renderer rows the server list lost, read-only with a stop", () => {
    const rows = mergePortForwardRows([], {
      contextId: "dev",
      entries: [{
        key: forwardKey("Pod", "apps", "web", 8080),
        kind: "Pod",
        namespace: "apps",
        name: "web",
        podPort: 8080,
        id: "pf-stale",
        localPort: 49999,
        busy: false,
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "pf-stale", contextId: "dev", source: "renderer", stopKey: forwardKey("Pod", "apps", "web", 8080) });
  });

  it("shows a starting renderer entry but never a failed one", () => {
    const rows = mergePortForwardRows([], {
      contextId: "dev",
      entries: [
        { key: "Pod|apps|starting|80", kind: "Pod", namespace: "apps", name: "starting", podPort: 80, busy: true },
        { key: "Pod|apps|failed|80", kind: "Pod", namespace: "apps", name: "failed", podPort: 80, error: "no endpoints", busy: false },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "starting", busy: true, source: "renderer" });
    expect(rows[0].id).toBeUndefined();
    // Stopping a starting row routes through the store, which reclaims the
    // forward when its late start response arrives.
    expect(stopActionFor(rows[0])).toEqual({ kind: "store", stopKey: "Pod|apps|starting|80" });
  });
});

describe("port forward session stop routing", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    resetPortForwardStoreForTests();
    await setPortForwardContext("dev");
  });

  const rowFor = (rows: PortForwardRow[], key: string) => {
    const row = rows.find((item) => item.key === key);
    if (!row) throw new Error(`no row ${key}`);
    return row;
  };

  it("stops a renderer-owned row through the store so the Ports tab clears", async () => {
    startMock.mockResolvedValue({ id: "pf-a", localPort: 49152 });
    await startPortForward({ contextId: "dev", namespace: "apps", name: "web", podPort: 8080 });
    listMock.mockResolvedValue([session({ id: "pf-a" })]);

    const rows = mergePortForwardRows(await desktop.resources.portForwardList(), {
      contextId: "dev",
      entries: [...getPortForwardSnapshotForTests().values()],
    });
    const action = stopActionFor(rowFor(rows, "pf-a"));
    expect(action).toEqual({ kind: "store", stopKey: forwardKey("Pod", "apps", "web", 8080) });
    if (action.kind === "store") await (await import("./usePortForwards")).stopPortForward(action.stopKey);
    expect(stopMock).toHaveBeenCalledWith("pf-a");
    expect(getPortForwardSnapshotForTests().size).toBe(0);
  });

  it("stops a server-only row by id", () => {
    const rows = mergePortForwardRows([session({ id: "pf-unknown", contextId: "prod" })], { contextId: "dev", entries: [] });
    expect(stopActionFor(rowFor(rows, "pf-unknown"))).toEqual({ kind: "id", id: "pf-unknown" });
  });
});
