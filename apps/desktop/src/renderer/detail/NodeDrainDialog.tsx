import { useEffect, useRef, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import type { NodeDrainEvent, NodeDrainOptions } from "../../shared/types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { desktop } from "../lib/desktop";
import {
  DEFAULT_DRAIN_OPTIONS,
  describeDrainEvent,
  drainJournalEntry,
  type DrainProgressLine,
} from "./node-detail";

export interface NodeDrainDialogProps {
  contextId: string;
  nodeName: string;
  open: boolean;
  busy: boolean;
  onOpenChange(open: boolean): void;
  /** Records the finished operation in the context journal. */
  onRecordJournal(entry: string): void;
  /** Invoked after the drain stream ends so the node detail refetches. */
  onDrainFinished(): void;
}

interface DrainOptionDescriptor {
  key: keyof NodeDrainOptions;
  label: string;
  detail: string;
}

const DRAIN_OPTIONS: DrainOptionDescriptor[] = [
  {
    key: "ignoreDaemonsets",
    label: "Ignore DaemonSet-managed pods",
    detail: "Skip pods owned by a DaemonSet instead of aborting the drain. They restart on the node.",
  },
  {
    key: "force",
    label: "Force unmanaged pods",
    detail: "Evict pods no controller (Deployment, ReplicaSet, StatefulSet, Job, DaemonSet) manages. They will not be recreated.",
  },
  {
    key: "deleteEmptyDirData",
    label: "Delete emptyDir data",
    detail: "Evict pods with emptyDir volumes; their local data is lost with the pod.",
  },
  {
    key: "disableEviction",
    label: "Use delete instead of eviction",
    detail: "Bypass the eviction API and PodDisruptionBudgets; pods are deleted immediately.",
  },
];

/**
 * Drain review and progress. Confirmation is explicit and the options mirror
 * kubectl drain's flags; once started, the dialog streams per-pod lines until
 * the summary event. Closing mid-drain aborts it — the node stays cordoned.
 */
export function NodeDrainDialog({
  contextId,
  nodeName,
  open,
  busy,
  onOpenChange,
  onRecordJournal,
  onDrainFinished,
}: NodeDrainDialogProps) {
  const [options, setOptions] = useState<NodeDrainOptions>(DEFAULT_DRAIN_OPTIONS);
  const [lines, setLines] = useState<DrainProgressLine[]>([]);
  const [summary, setSummary] = useState<NodeDrainEvent>();
  const [running, setRunning] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      stopRef.current?.();
      stopRef.current = null;
      setOptions(DEFAULT_DRAIN_OPTIONS);
      setLines([]);
      setSummary(undefined);
      setRunning(false);
    }
  }, [open]);

  useEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    progressRef.current?.scrollTo({ top: progressRef.current.scrollHeight });
  }, [lines]);

  function startDrain() {
    setRunning(true);
    setSummary(undefined);
    setLines([]);
    const stop = desktop.resources.drainNode(
      { contextId, nodeName, options },
      (event) => {
        setLines((current) => [...current, describeDrainEvent(event, current.length)]);
        if (event.type === "summary") {
          setSummary(event);
          setRunning(false);
          stopRef.current = null;
          onRecordJournal(drainJournalEntry(nodeName, event));
          onDrainFinished();
        }
      },
    );
    stopRef.current = stop;
  }

  function close() {
    // Closing while running aborts the stream; accepted evictions stand and
    // the node remains cordoned, so the detail view still refetches.
    if (running) onDrainFinished();
    onOpenChange(false);
  }

  const confirmLabel = `Drain ${nodeName}`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="node-drain-dialog" data-testid="node-drain-dialog">
        <DialogHeader>
          <DialogTitle>Drain node {nodeName}</DialogTitle>
          <DialogDescription>
            The node is cordoned first, then every remaining pod is evicted through the
            eviction API, which respects PodDisruptionBudgets.
          </DialogDescription>
        </DialogHeader>

        {running || summary ? (
          <div className="node-drain-progress" data-testid="node-drain-progress" ref={progressRef} role="log" aria-live="polite">
            {lines.map((line) => (
              <p key={line.key} className="node-drain-line" data-tone={line.tone}>{line.text}</p>
            ))}
          </div>
        ) : (
          <>
            <p className="node-drain-warning">
              <TriangleAlert aria-hidden="true" />
              Evicted pods are rescheduled onto other nodes. Workloads without spare capacity
              will be disrupted.
            </p>
            <fieldset className="node-drain-options" data-testid="node-drain-options">
              {DRAIN_OPTIONS.map((option) => (
                <label key={option.key} className="node-drain-option">
                  <input
                    type="checkbox"
                    checked={options[option.key]}
                    onChange={(event) => setOptions((current) => ({ ...current, [option.key]: event.target.checked }))}
                    data-testid={`node-drain-option-${option.key}`}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}

        {summary?.error && (
          <div className="node-drain-error" role="alert" data-testid="node-drain-error">
            {summary.error}
          </div>
        )}
        {summary && summary.complete && (
          <div className="node-drain-summary" data-testid="node-drain-summary">
            <Badge variant="secondary">Drain complete</Badge>
            {summary.evicted ?? 0} evicted · {summary.skipped ?? 0} skipped · {summary.failed ?? 0} failed
          </div>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={close} data-testid="node-drain-stop">
              Stop drain
            </Button>
          ) : (
            <Button variant="outline" onClick={close} data-testid="node-drain-cancel">
              {summary ? "Close" : "Cancel"}
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={running || busy || !contextId}
            onClick={startDrain}
            data-testid="node-drain-confirm"
          >
            {running && <LoaderCircle className="spin" data-icon="inline-start" />}
            {running ? "Draining…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
