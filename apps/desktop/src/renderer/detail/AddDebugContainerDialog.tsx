import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import type { PodDebugRequest, PodDebugResponse } from "../../shared/types";
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
import { messageOf } from "../lib/format";
import { DEFAULT_DEBUG_IMAGE, MAX_DEBUG_NAME_LENGTH, parseDebugCommand } from "./debug-container";

export interface AddDebugContainerDialogProps {
  contextId: string;
  namespace: string;
  podName: string;
  /** The pod's spec container names; the target picker shares process namespaces. */
  containers: string[];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Fired once the API server stored the entry; the owner refreshes the detail. */
  onAdded(name: string): void;
}

/**
 * Injects an ephemeral debug container into a running Pod (kubectl debug
 * semantics): the workload spec is never modified, and the container dies
 * with the pod. Submitting is the confirmation — the entry that lands is
 * echoed back and surfaced in the containers overview.
 */
export function AddDebugContainerDialog({
  contextId,
  namespace,
  podName,
  containers,
  open,
  onOpenChange,
  onAdded,
}: AddDebugContainerDialogProps) {
  const [image, setImage] = useState(DEFAULT_DEBUG_IMAGE);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setImage(DEFAULT_DEBUG_IMAGE);
      setName("");
      setCommand("");
      setTarget("");
      setError("");
      // busy deliberately survives a close mid-flight; the request finishes.
    }
  }, [open, podName]);

  const trimmedImage = image.trim();
  const valid = Boolean(trimmedImage) && name.trim().length <= MAX_DEBUG_NAME_LENGTH;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const request: PodDebugRequest = {
      contextId,
      namespace,
      podName,
      container: {
        image: trimmedImage,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(command.trim() ? { command: parseDebugCommand(command) } : {}),
        ...(target ? { targetContainerName: target } : {}),
      },
    };
    let result: PodDebugResponse;
    try {
      result = await desktop.resources.debugContainer(request);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
      return;
    }
    setBusy(false);
    onOpenChange(false);
    onAdded(result.container.name);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="resource-operation-dialog" data-testid="debug-container-dialog">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add debug container</DialogTitle>
            <DialogDescription>
              Inject an ephemeral container into {podName} to inspect its filesystem, network, and
              processes — the pod spec and its owning workload are never modified, and the container
              is removed with the pod. Minimal images without a shell become debuggable this way.
            </DialogDescription>
          </DialogHeader>
          <div className="resource-operation-fields">
            <label className="resource-operation-field">
              <span>Image</span>
              <input
                autoFocus
                type="text"
                value={image}
                aria-label="Debug container image"
                data-testid="debug-container-image"
                onChange={(event) => setImage(event.target.value)}
              />
            </label>
            <label className="resource-operation-field">
              <span>Name (optional)</span>
              <input
                type="text"
                value={name}
                placeholder="Auto-generated"
                aria-label="Debug container name"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="resource-operation-field">
              <span>Command (optional)</span>
              <input
                type="text"
                value={command}
                placeholder="/bin/sh -c ps aux"
                aria-label="Debug container command"
                onChange={(event) => setCommand(event.target.value)}
              />
            </label>
            <label className="resource-operation-field">
              <span>Target container (optional)</span>
              <select
                value={target}
                aria-label="Target container"
                disabled={containers.length === 0}
                title={containers.length === 0 ? "The pod has no containers to target" : "Shares the target's process namespace, like kubectl debug --target"}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">None</option>
                {containers.map((container) => (
                  <option key={container} value={container}>{container}</option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <p className="resource-operation-error" role="alert" data-testid="debug-container-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid} data-testid="debug-container-submit">
              {busy && <LoaderCircle className="spin" data-icon="inline-start" />}
              Add debug container
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
