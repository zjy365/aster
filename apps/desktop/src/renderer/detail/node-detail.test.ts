import { describe, expect, it } from "vitest";
import type { NodeDrainEvent } from "../../shared/types";
import {
  DEFAULT_DRAIN_OPTIONS,
  describeDrainEvent,
  drainJournalEntry,
  parseNodeUnschedulable,
  summarizeDrain,
} from "./node-detail";

const NODE_YAML = (unschedulable: boolean) => `
apiVersion: v1
kind: Node
metadata:
  name: worker-1
spec:
  unschedulable: ${unschedulable}
  providerID: fake://worker-1
`;

describe("parseNodeUnschedulable", () => {
  it("reads spec.unschedulable from the live node YAML", () => {
    expect(parseNodeUnschedulable(NODE_YAML(true))).toBe(true);
    expect(parseNodeUnschedulable(NODE_YAML(false))).toBe(false);
  });

  it("degrades to schedulable for missing, empty, or broken YAML", () => {
    expect(parseNodeUnschedulable(undefined)).toBe(false);
    expect(parseNodeUnschedulable("")).toBe(false);
    expect(parseNodeUnschedulable("apiVersion: v1\nkind: Node\nmetadata:\n  name: x\nspec:\n")).toBe(false);
    expect(parseNodeUnschedulable("::::not yaml")).toBe(false);
  });
});

describe("describeDrainEvent", () => {
  it("opens the progress with the cordon line", () => {
    expect(describeDrainEvent({ type: "cordon", node: "worker-1", unschedulable: true, changed: true }, 0))
      .toEqual({ key: "cordon-0", text: "Node cordoned — draining pods", tone: "info" });
    expect(describeDrainEvent({ type: "cordon", unschedulable: true, changed: false }, 0).text)
      .toBe("Node already cordoned");
  });

  it("renders per-pod steps with reason and failure detail", () => {
    const skipped = describeDrainEvent(
      { type: "pod", namespace: "kube-system", pod: "fluentd-x7", status: "skipped", reason: "DaemonSet-managed" },
      3,
    );
    expect(skipped).toEqual({
      key: "pod-3",
      text: "kube-system/fluentd-x7 — skipped (DaemonSet-managed)",
      tone: "warn",
    });

    const failed = describeDrainEvent(
      { type: "pod", namespace: "apps", pod: "web-1", status: "failed", message: "eviction blocked" },
      4,
    );
    expect(failed.text).toBe("apps/web-1 — failed: eviction blocked");
    expect(failed.tone).toBe("error");

    expect(describeDrainEvent({ type: "pod", pod: "solo", status: "evicted" }, 5).text).toBe("solo — evicted");
    expect(describeDrainEvent({ type: "pod", pod: "solo", status: "evicting" }, 6).tone).toBe("info");
    expect(describeDrainEvent({ type: "pod", pod: "solo", status: "deleted" }, 7).tone).toBe("ok");
  });
});

describe("summarizeDrain", () => {
  it("reports counts for complete drains", () => {
    expect(summarizeDrain({ type: "summary", total: 3, evicted: 2, skipped: 1, failed: 0, complete: true }))
      .toBe("Drain complete — 2 evicted, 1 skipped, 0 failed");
  });

  it("carries the abort or failure reason on incomplete drains", () => {
    expect(summarizeDrain({ type: "summary", evicted: 0, skipped: 1, failed: 1, complete: false, error: "eviction blocked" }))
      .toBe("Drain stopped — 0 evicted, 1 skipped, 1 failed. eviction blocked");
    expect(summarizeDrain({ type: "summary", evicted: 1, skipped: 0, failed: 1, complete: false }))
      .toBe("Drain finished with failures — 1 evicted, 0 skipped, 1 failed");
  });
});

describe("drainJournalEntry and defaults", () => {
  it("formats the journal line for a finished drain", () => {
    expect(drainJournalEntry("worker-1", { type: "summary", evicted: 3, skipped: 2, failed: 1 }))
      .toBe("drain worker-1 (3 evicted, 2 skipped, 1 failed)");
  });

  it("keeps kubectl-safe dialog defaults", () => {
    expect(DEFAULT_DRAIN_OPTIONS).toEqual({
      ignoreDaemonsets: true,
      force: false,
      deleteEmptyDirData: false,
      disableEviction: false,
    });
  });
});

describe("drain event type narrowing", () => {
  it("maps a summary event to the error tone when incomplete", () => {
    const event: NodeDrainEvent = { type: "summary", complete: false, error: "DaemonSet-managed pods must be ignored" };
    expect(describeDrainEvent(event, 9).tone).toBe("error");
    expect(describeDrainEvent({ ...event, complete: true, error: undefined }, 9).tone).toBe("ok");
  });
});
