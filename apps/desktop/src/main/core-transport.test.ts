import { describe, expect, it, vi } from "vitest";
import type { ResourceListRequest } from "../shared/types";
import {
  abortableDelay,
  deltaBatchFromWatchEvent,
  readNdjson,
  WatchSupervisor,
  type WatchTransport,
} from "./core-transport";
import type { ResourceKind } from "../shared/types";

const kind: ResourceKind = {
  id: "pods",
  group: "",
  version: "v1",
  resource: "pods",
  kind: "Pod",
  namespaced: true,
  category: "Workloads",
};

function listRequest(): ResourceListRequest {
  return { contextId: "ctx", resourceKind: kind, namespace: "default", limit: 100 };
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeSender(id: number) {
  const batches: unknown[] = [];
  return {
    id,
    batches,
    isDestroyed: () => false,
    send: (_channel: string, batch: unknown) => { batches.push(batch); },
  };
}

describe("readNdjson", () => {
  it("parses newline-delimited JSON split across chunk boundaries", async () => {
    const signal = new AbortController().signal;
    const events: Array<{ type: string }> = [];
    for await (const event of readNdjson<{ type: string }>(streamOf('{"type":"AD', 'DED"}\n{"type":"BOOKMARK"}\n'), signal)) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "ADDED" }, { type: "BOOKMARK" }]);
  });

  it("yields a trailing line without a newline", async () => {
    const signal = new AbortController().signal;
    const events: Array<{ type: string }> = [];
    for await (const event of readNdjson<{ type: string }>(streamOf('{"type":"MODIFIED"}'), signal)) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "MODIFIED" }]);
  });
});

describe("abortableDelay", () => {
  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(60_000, controller.signal)).resolves.toBeUndefined();
  });

  it("resolves on abort before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = abortableDelay(60_000, controller.signal);
      controller.abort();
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deltaBatchFromWatchEvent", () => {
  const row = { uid: "u1", apiVersion: "v1", kind: "Pod", name: "web", namespace: "default" };

  it("maps added/modified events to normalized rows", () => {
    expect(deltaBatchFromWatchEvent("sub", { type: "ADDED", resource: row, resourceVersion: "7" }, "7")).toEqual({
      subscriptionId: "sub",
      kind: "delta",
      events: [{ type: "added", row: { ...row, namespace: "default", resourceVersion: "", createdAt: "" } }],
      resourceVersion: "7",
    });
  });

  it("maps deleted events to keys", () => {
    const batch = deltaBatchFromWatchEvent("sub", { type: "DELETED", resource: row }, "");
    expect(batch).toEqual({
      subscriptionId: "sub",
      kind: "delta",
      events: [{ type: "deleted", key: "u1" }],
    });
  });

  it("ignores events without a resource and unknown verbs", () => {
    expect(deltaBatchFromWatchEvent("sub", { type: "ADDED" }, "")).toBeUndefined();
    expect(deltaBatchFromWatchEvent("sub", { type: "SOMETHING", resource: row }, "")).toBeUndefined();
  });
});

describe("WatchSupervisor", () => {
  function transportWith(overrides: Partial<WatchTransport>): WatchTransport {
    return {
      listWatchPage: async () => ({ items: [], resourceVersion: "1" }),
      openWatchStream: async () => streamOf('{"type":"ADDED","resource":{"uid":"u1","apiVersion":"v1","kind":"Pod","name":"web","namespace":"default"},"resourceVersion":"2"}\n'),
      ...overrides,
    };
  }

  it("delivers a snapshot then deltas and keeps reconnecting after the stream ends", async () => {
    const supervisor = new WatchSupervisor(transportWith({}));
    const sender = fakeSender(1);
    supervisor.start("sub-1", listRequest(), sender as never);
    await vi.waitFor(() => {
      expect(sender.batches.length).toBeGreaterThanOrEqual(2);
    });
    expect(sender.batches[0]).toMatchObject({ kind: "snapshot", items: [] });
    expect(sender.batches[1]).toMatchObject({ kind: "delta", events: [{ type: "added" }] });
    // A closed stream without RESET reopens the stream instead of re-listing,
    // so the same delta arrives again after each reconnect.
    await vi.waitFor(() => {
      expect(sender.batches.filter((batch) => (batch as { kind: string }).kind === "delta").length).toBeGreaterThanOrEqual(2);
    });
    supervisor.cancelAll();
    await vi.waitFor(() => expect(supervisor.size).toBe(0));
  });

  it("replaces existing watches for the same sender on start", async () => {
    const neverEnding = async () => new ReadableStream<Uint8Array>({ start: () => undefined });
    const supervisor = new WatchSupervisor(transportWith({ openWatchStream: neverEnding }));
    const sender = fakeSender(1);
    supervisor.start("sub-1", listRequest(), sender as never);
    supervisor.start("sub-2", listRequest(), sender as never);
    expect(supervisor.size).toBe(1);
    supervisor.cancelAll();
  });

  it("stop only cancels watches owned by the calling sender", async () => {
    const neverEnding = async () => new ReadableStream<Uint8Array>({ start: () => undefined });
    const supervisor = new WatchSupervisor(transportWith({ openWatchStream: neverEnding }));
    const owner = fakeSender(1);
    const intruder = fakeSender(2);
    supervisor.start("sub-1", listRequest(), owner as never);
    supervisor.stop("sub-1", intruder.id);
    expect(supervisor.size).toBe(1);
    supervisor.stop("sub-1", owner.id);
    expect(supervisor.size).toBe(0);
  });

  it("cancelAll(webContentsId) only clears watches owned by that sender", async () => {
    const neverEnding = async () => new ReadableStream<Uint8Array>({ start: () => undefined });
    const supervisor = new WatchSupervisor(transportWith({ openWatchStream: neverEnding }));
    supervisor.start("sub-1", listRequest(), fakeSender(1) as never);
    supervisor.start("sub-2", listRequest(), fakeSender(2) as never);
    supervisor.cancelAll(1);
    expect(supervisor.size).toBe(1);
    supervisor.cancelAll();
    expect(supervisor.size).toBe(0);
  });

  it("sends an error batch when the list fails and the watch was not aborted", async () => {
    const supervisor = new WatchSupervisor(transportWith({
      listWatchPage: async () => { throw new Error("offline"); },
    }));
    const sender = fakeSender(1);
    supervisor.start("sub-1", listRequest(), sender as never);
    await vi.waitFor(() => expect(sender.batches.length).toBe(1));
    expect(sender.batches[0]).toEqual({ subscriptionId: "sub-1", kind: "error", message: "offline" });
  });
});
