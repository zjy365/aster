// SPDX-License-Identifier: Apache-2.0
import { FolderOpen, FilePlus2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AsterSettings } from "../../shared/types";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: AsterSettings;
  /** Applies the given source list and restarts the core. */
  onApply(sources: string[]): Promise<void>;
  onPickFile(): Promise<string | null>;
  onPickFolder(): Promise<string | null>;
}

/**
 * Kubeconfig source management: the default ~/.kube/config is always in the
 * chain (shown but not removable); user sources are path references only —
 * files are never copied or modified.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onApply,
  onPickFile,
  onPickFolder,
}: SettingsDialogProps) {
  const [sources, setSources] = useState<string[]>(settings.kubeconfigSources);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (open) {
      setSources(settings.kubeconfigSources);
      setApplied(false);
    }
  }, [open, settings]);

  const dirty = !arrayEquals(sources, settings.kubeconfigSources);

  async function add(pick: () => Promise<string | null>) {
    const picked = await pick();
    if (picked && !sources.includes(picked)) setSources((current) => [...current, picked]);
  }

  function apply() {
    setBusy(true);
    void onApply(sources)
      .then(() => {
        setApplied(true);
        setTimeout(() => onOpenChange(false), 1200);
      })
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Kubeconfig sources</DialogTitle>
          <DialogDescription>
            Aster reads the standard kubeconfig chain and never modifies any file. Add more files or folders to list their clusters too. Applying restarts the local core and reloads clusters.
          </DialogDescription>
        </DialogHeader>

        <ul className="settings-source-list" data-testid="settings-source-list">
          <li className="settings-source-item">
            <span className="settings-source-path">~/.kube/config</span>
            <Badge variant="outline">Default</Badge>
          </li>
          {sources.map((source) => (
            <li className="settings-source-item" key={source}>
              <span className="settings-source-path" data-testid="settings-source-path">{source}</span>
              <Button
                aria-label={`Remove ${source}`}
                data-testid="settings-source-remove"
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSources((current) => current.filter((item) => item !== source))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
          {sources.length === 0 && (
            <li className="settings-source-empty">No extra sources. All clusters come from the default chain.</li>
          )}
        </ul>

        <div className="settings-source-actions">
          <Button variant="outline" disabled={busy} data-testid="settings-add-file" onClick={() => void add(onPickFile)}>
            <FilePlus2 data-icon="inline-start" />
            Add file…
          </Button>
          <Button variant="outline" disabled={busy} data-testid="settings-add-folder" onClick={() => void add(onPickFolder)}>
            <FolderOpen data-icon="inline-start" />
            Add folder…
          </Button>
        </div>

        <DialogFooter>
          {applied ? (
            <span className="settings-applied" role="status">Applied — the local core is restarting.</span>
          ) : null}
          <Button variant="outline" disabled={!dirty || busy} onClick={() => setSources(settings.kubeconfigSources)}>
            Revert
          </Button>
          <Button
            disabled={!dirty || busy}
            data-testid="settings-apply"
            onClick={apply}
          >
            Apply & restart core
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
