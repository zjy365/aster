// SPDX-License-Identifier: Apache-2.0
import { FileCode2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResourceKind, ResourceMutationRequest } from "../../shared/types";
import { MutationDiffView } from "./MutationDiffView";

export interface CreateResourceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  kind: ResourceKind;
  namespace: string;
  busy: boolean;
  message: string;
  preview: string;
  pendingMutation?: ResourceMutationRequest;
  onPrepare(yaml: string): Promise<void>;
  onApply(): Promise<void>;
  onCancel(): void;
}

export function yamlTemplate(kind: ResourceKind, namespace: string): string {
  const apiVersion = kind.group ? `${kind.group}/${kind.version}` : kind.version;
  const lines = [
    `apiVersion: ${apiVersion}`,
    `kind: ${kind.kind}`,
    "metadata:",
    "  name: ",
  ];
  if (kind.namespaced) lines.push(`  namespace: ${namespace || "default"}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Create-from-YAML flow for the resource list: edit a fresh document, run it
 * through the shared dry-run review gate, then apply. Closes itself after a
 * successful apply so the refreshed list shows the new object.
 */
export function CreateResourceDialog({
  open,
  onOpenChange,
  kind,
  namespace,
  busy,
  message,
  preview,
  pendingMutation,
  onPrepare,
  onApply,
  onCancel,
}: CreateResourceDialogProps) {
  const [yaml, setYaml] = useState(() => yamlTemplate(kind, namespace));
  const wasPending = useRef(false);

  useEffect(() => {
    if (open) setYaml(yamlTemplate(kind, namespace));
  }, [open, kind, namespace]);

  const reviewing = open && pendingMutation?.operation === "create";
  useEffect(() => {
    if (reviewing) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current && !busy && message === "Applied") {
      wasPending.current = false;
      onOpenChange(false);
    }
  }, [reviewing, busy, message, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="create-resource-dialog" data-testid="create-resource-dialog">
        <DialogHeader>
          <DialogTitle>New {kind.kind}</DialogTitle>
          <DialogDescription>
            Write the full object YAML. Kubernetes validates it with a dry-run before anything is created.
          </DialogDescription>
        </DialogHeader>

        {reviewing ? (
          <MutationDiffView
            name={kind.kind}
            beforeYaml=""
            afterYaml={preview}
            className="mutation-review-diff"
            ariaLabel="Create dry-run review"
          />
        ) : (
          <textarea
            className="resource-yaml-editor create-resource-editor"
            value={yaml}
            readOnly={busy}
            spellCheck={false}
            aria-label={`New ${kind.kind} YAML`}
            data-testid="create-yaml-editor"
            onChange={(event) => setYaml(event.target.value)}
          />
        )}

        <div className="mutation-review-status" aria-live="polite">{message}</div>

        <DialogFooter>
          {reviewing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={onCancel} data-testid="create-cancel">
                Edit YAML
              </Button>
              <Button disabled={busy} onClick={() => void onApply()} data-testid="create-apply">
                Create {kind.kind}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !yaml.trim()}
                onClick={() => void onPrepare(yaml)}
                data-testid="create-prepare-dry-run"
              >
                <FileCode2 data-icon="inline-start" />
                Prepare dry-run
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
