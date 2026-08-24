// SPDX-License-Identifier: Apache-2.0
import { CircleArrowUp } from "lucide-react";
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
import type { HelmReleaseDetail } from "../../shared/types";
import type { HelmUpgradeInput } from "../hooks/useHelm";

export interface HelmUpgradeDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  detail: HelmReleaseDetail;
  busy: boolean;
  onUpgrade(input: HelmUpgradeInput): Promise<boolean>;
}

/**
 * Upgrade form for an installed release. The repo URL cannot be defaulted
 * because releases do not record their origin repository, so the user always
 * confirms it. Values are prefilled with the release's current values and
 * replace them wholesale; clearing the field resets to chart defaults.
 */
export function HelmUpgradeDialog({ open, onOpenChange, detail, busy, onUpgrade }: HelmUpgradeDialogProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [chart, setChart] = useState(detail.chart);
  const [version, setVersion] = useState(detail.chartVersion);
  const [values, setValues] = useState(detail.values ?? "");

  useEffect(() => {
    if (!open) return;
    setRepoUrl("");
    setChart(detail.chart);
    setVersion(detail.chartVersion);
    setValues(detail.values ?? "");
  }, [open, detail]);

  const submit = async () => {
    const ok = await onUpgrade({
      name: detail.name,
      repoUrl: repoUrl.trim(),
      chart: chart.trim(),
      version: version.trim() || undefined,
      values,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="create-resource-dialog" data-testid="helm-upgrade-dialog">
        <DialogHeader>
          <DialogTitle>Upgrade {detail.name}</DialogTitle>
          <DialogDescription>
            Values below replace the release&apos;s current values entirely. Clear them to reset to the chart defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="helm-upgrade-fields">
          <label className="helm-upgrade-field">
            <span>Repository URL</span>
            <input
              className="helm-upgrade-input"
              data-testid="helm-upgrade-repo-url"
              disabled={busy}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://charts.bitnami.com/bitnami"
              spellCheck={false}
              value={repoUrl}
            />
          </label>
          <div className="helm-upgrade-row">
            <label className="helm-upgrade-field">
              <span>Chart</span>
              <input
                className="helm-upgrade-input"
                data-testid="helm-upgrade-chart"
                disabled={busy}
                onChange={(event) => setChart(event.target.value)}
                spellCheck={false}
                value={chart}
              />
            </label>
            <label className="helm-upgrade-field">
              <span>Chart version</span>
              <input
                className="helm-upgrade-input"
                data-testid="helm-upgrade-version"
                disabled={busy}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="latest"
                spellCheck={false}
                value={version}
              />
            </label>
          </div>
          <textarea
            aria-label="Upgrade values YAML"
            className="resource-yaml-editor create-resource-editor"
            data-testid="helm-upgrade-values"
            onChange={(event) => setValues(event.target.value)}
            readOnly={busy}
            spellCheck={false}
            value={values}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="helm-upgrade-submit"
            disabled={busy || !repoUrl.trim() || !chart.trim()}
            onClick={() => void submit()}
          >
            <CircleArrowUp data-icon="inline-start" />
            Upgrade release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
