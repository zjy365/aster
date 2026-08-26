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
import { MutationDiffView } from "../detail/MutationDiffView";
import type { HelmUpgradeInput } from "../hooks/useHelm";

export interface HelmUpgradeDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  detail: HelmReleaseDetail;
  busy: boolean;
  onUpgrade(input: HelmUpgradeInput): Promise<boolean>;
}

/**
 * Upgrade form for an installed release. The repo URL stays empty for the
 * common values-only upgrade: the release stores its chart's full contents,
 * so the core reuses that chart instead of re-pulling one (releases never
 * record their origin repository). Filling a repo URL switches to pulling
 * the named chart (and optional version) from that repository.
 *
 * Submission is a two-step review, mirroring the resource mutation flow:
 * edit the values, review the diff against the release's current values,
 * then confirm. Values replace the release's current values wholesale;
 * clearing the field resets to the chart defaults.
 */
export function HelmUpgradeDialog({ open, onOpenChange, detail, busy, onUpgrade }: HelmUpgradeDialogProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [chart, setChart] = useState(detail.chart);
  const [version, setVersion] = useState(detail.chartVersion);
  const [values, setValues] = useState(detail.values ?? "");
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepoUrl("");
    setChart(detail.chart);
    setVersion(detail.chartVersion);
    setValues(detail.values ?? "");
    setReviewing(false);
  }, [open, detail]);

  const reuseChart = !repoUrl.trim();

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
      <DialogContent className="helm-upgrade-dialog" data-testid="helm-upgrade-dialog">
        <DialogHeader>
          <DialogTitle>Upgrade {detail.name}</DialogTitle>
          <DialogDescription>
            {reviewing
              ? "Review the values diff before applying. Confirming creates a new revision."
              : "Values below replace the release's current values entirely. Clear them to reset to the chart defaults."}
          </DialogDescription>
        </DialogHeader>

        {reviewing ? (
          <>
            <div className="mutation-review-status" data-testid="helm-upgrade-summary">
              {reuseChart
                ? `Reuses the installed chart ${detail.chart} ${detail.chartVersion} — only the values change.`
                : `Pulls chart ${chart.trim()} ${version.trim() || "(latest)"} from ${repoUrl.trim()} and replaces the values.`}
            </div>
            <MutationDiffView
              name={`${detail.name}-values.yaml`}
              beforeYaml={detail.values ?? ""}
              afterYaml={values}
              className="mutation-review-diff"
              testId="helm-upgrade-diff"
              ariaLabel="Values diff"
            />
          </>
        ) : (
          <div className="helm-upgrade-fields">
            <label className="helm-upgrade-field">
              <span>Repository URL (optional — leave empty to reuse the installed chart)</span>
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
                  disabled={busy || reuseChart}
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
                  disabled={busy || reuseChart}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="latest"
                  spellCheck={false}
                  value={version}
                />
              </label>
            </div>
            <div className="helm-upgrade-columns">
              <div className="helm-upgrade-field">
                <span>Chart defaults (read-only)</span>
                <pre className="helm-upgrade-defaults" data-testid="helm-upgrade-defaults">
                  {detail.chartValues || "This chart ships no default values."}
                </pre>
              </div>
              <div className="helm-upgrade-field">
                <span>Your values</span>
                <textarea
                  aria-label="Upgrade values YAML"
                  className="resource-yaml-editor helm-upgrade-values-editor"
                  data-testid="helm-upgrade-values"
                  onChange={(event) => setValues(event.target.value)}
                  readOnly={busy}
                  spellCheck={false}
                  value={values}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {reviewing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setReviewing(false)}>
                Back to edit
              </Button>
              <Button
                data-testid="helm-upgrade-submit"
                disabled={busy}
                onClick={() => void submit()}
              >
                <CircleArrowUp data-icon="inline-start" />
                Confirm upgrade
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                data-testid="helm-upgrade-review"
                disabled={busy || (!reuseChart && !chart.trim())}
                onClick={() => setReviewing(true)}
              >
                <CircleArrowUp data-icon="inline-start" />
                Review changes
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
