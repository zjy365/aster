import { describe, expect, it } from "vitest";
import type { ResourceRow, ResourceWatchBatch } from "../../shared/types";
import { applyResourceWatchBatches } from "./resource-watch";

function row(uid: string, resourceVersion: string): ResourceRow {
  return {
    uid,
    apiVersion: "v1",
    kind: "Pod",
    name: uid,
    namespace: "default",
    resourceVersion,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("resource watch batching", () => {
  it("applies a snapshot and all queued deltas in order", () => {
    const batches: ResourceWatchBatch[] = [
      { subscriptionId: "a", kind: "snapshot", items: [row("a", "1"), row("b", "1")], resourceVersion: "1" },
      { subscriptionId: "a", kind: "delta", events: [
        { type: "modified", row: row("a", "2") },
        { type: "deleted", key: "b" },
        { type: "added", row: row("c", "1") },
      ], resourceVersion: "2" },
    ];
    expect(applyResourceWatchBatches({ items: [] }, batches)).toEqual({
      items: [row("a", "2"), row("c", "1")],
      resourceVersion: "2",
    });
  });

  it("preserves the server continuation token for the explicit next-page action", () => {
    expect(applyResourceWatchBatches({ items: [] }, [{
      subscriptionId: "a",
      kind: "snapshot",
      items: [row("a", "1")],
      continueToken: "continue-2",
      resourceVersion: "1",
    }])).toEqual({
      items: [row("a", "1")],
      continueToken: "continue-2",
      resourceVersion: "1",
    });
  });

  it("ignores error envelopes without discarding the current page", () => {
    expect(applyResourceWatchBatches({ items: [row("a", "1")] }, [
      { subscriptionId: "a", kind: "error", message: "offline" },
    ])).toEqual({ items: [row("a", "1")] });
  });
});
