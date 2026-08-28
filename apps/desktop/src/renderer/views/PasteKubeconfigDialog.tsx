// SPDX-License-Identifier: Apache-2.0
import { ClipboardPaste, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PasteKubeconfigDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * Imports the pasted content through the shell and resolves to the stored
   * path. The parent owns whatever happens next (staging the path as a
   * source in Settings, or applying immediately from the picker empty
   * state). Rejections are shown in place so the paste can be fixed.
   */
  onImport(name: string, content: string): Promise<string>;
}

/**
 * Paste-to-import dialog for kubeconfigs. The pasted text goes renderer →
 * shell only: the shell sniffs it, writes it into the app-managed kubeconfig
 * directory with owner-only permissions, and returns just the path. The name
 * field is optional and only names the stored file; cluster naming still
 * comes from the contexts inside the file.
 */
export function PasteKubeconfigDialog({ open, onOpenChange, onImport }: PasteKubeconfigDialogProps) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setContent("");
    setBusy(false);
    setError("");
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onImport(name.trim(), content);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="paste-kubeconfig-dialog" data-testid="paste-kubeconfig-dialog">
        <DialogHeader>
          <DialogTitle>Paste a kubeconfig</DialogTitle>
          <DialogDescription>
            The contents are stored in Aster's own config directory with owner-only permissions and
            listed as a kubeconfig source. They are never sent anywhere else.
          </DialogDescription>
        </DialogHeader>

        <div className="paste-kubeconfig-fields">
          <textarea
            aria-label="Kubeconfig YAML"
            autoFocus
            className="resource-yaml-editor paste-kubeconfig-content"
            data-testid="paste-kubeconfig-content"
            onChange={(event) => setContent(event.target.value)}
            placeholder={"apiVersion: v1\nkind: Config\nclusters:\n- …"}
            readOnly={busy}
            spellCheck={false}
            value={content}
          />
          <label className="paste-kubeconfig-field">
            <span>Name (optional — names the stored file; defaults to the first context)</span>
            <input
              className="paste-kubeconfig-name"
              data-testid="paste-kubeconfig-name"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="prod-admin"
              spellCheck={false}
              value={name}
            />
          </label>
        </div>

        {error ? (
          <div className="paste-kubeconfig-error" data-testid="paste-kubeconfig-error" role="alert">
            <TriangleAlert aria-hidden="true" className="size-4" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="paste-kubeconfig-submit"
            disabled={busy || !content.trim()}
            onClick={() => void submit()}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="spin size-3.5" />
            ) : (
              <ClipboardPaste data-icon="inline-start" />
            )}
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
