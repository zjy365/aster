// SPDX-License-Identifier: Apache-2.0
import { ChevronDown, CircleArrowUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { YamlEditor } from "../components/YamlEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HelmChartVersion, HelmReleaseDetail } from "../../shared/types";
import { desktop } from "../lib/desktop";
import { formatAge } from "../lib/format";
import { MutationDiffView } from "../detail/MutationDiffView";
import type { HelmUpgradeInput } from "../hooks/useHelm";

export interface HelmUpgradeDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  detail: HelmReleaseDetail;
  busy: boolean;
  onUpgrade(input: HelmUpgradeInput): Promise<string | null>;
}

/**
 * Upgrade form for an installed release. The repo URL stays empty for the
 * common values-only upgrade: the release stores its chart's full contents,
 * so the core reuses that chart instead of re-pulling one (releases never
 * record their origin repository). Filling a repo URL switches to pulling
 * the named chart (and optional version) from that repository; the version
 * field then offers the repository's published versions as a pick list.
 *
 * Submission is a two-step review, mirroring the resource mutation flow:
 * edit the values, review the diff against the release's current values,
 * then confirm. Values replace the release's current values wholesale;
 * clearing the field resets to the chart defaults. While the upgrade runs
 * the dialog cannot be dismissed; a failure is shown in place so the user
 * can adjust and retry.
 */
export function HelmUpgradeDialog({ open, onOpenChange, detail, busy, onUpgrade }: HelmUpgradeDialogProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [chart, setChart] = useState(detail.chart);
  const [version, setVersion] = useState(detail.chartVersion);
  const [values, setValues] = useState(detail.values ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRepoUrl("");
    setChart(detail.chart);
    setVersion(detail.chartVersion);
    setValues(detail.values ?? "");
    setReviewing(false);
    setError("");
  }, [open, detail]);

  const reuseChart = !repoUrl.trim();

  const submit = async () => {
    setError("");
    const failure = await onUpgrade({
      name: detail.name,
      repoUrl: repoUrl.trim(),
      chart: chart.trim(),
      version: version.trim() || undefined,
      values,
    });
    if (failure) {
      setError(failure);
      return;
    }
    onOpenChange(false);
  };

  // An upgrade in flight must not be dismissed: the request keeps running
  // server-side, so closing would only hide its outcome.
  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              name={`${detail.name}-values`}
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
              <div className="helm-upgrade-field">
                <span>Chart version</span>
                <ChartVersionField
                  chart={chart}
                  disabled={busy || reuseChart}
                  onChange={setVersion}
                  repoUrl={repoUrl}
                  value={version}
                />
              </div>
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
                <YamlEditor
                  aria-label="Upgrade values YAML"
                  className="helm-upgrade-values-editor"
                  data-testid="helm-upgrade-values"
                  onChange={setValues}
                  readOnly={busy}
                  value={values}
                />
              </div>
            </div>
          </div>
        )}

        {error ? (
          <div className="helm-upgrade-error" data-testid="helm-upgrade-error" role="alert">
            <TriangleAlert aria-hidden="true" className="size-4" />
            <span>{error}</span>
          </div>
        ) : null}

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
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="spin size-3.5" />
                ) : (
                  <CircleArrowUp data-icon="inline-start" />
                )}
                {busy ? "Upgrading…" : "Confirm upgrade"}
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

interface ChartVersionFieldProps {
  repoUrl: string;
  chart: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}

/**
 * Chart version combobox: a free-text input (the manual fallback) with a
 * dropdown of the versions the repository has published, loaded once a repo
 * URL and chart are known. The list is a convenience, never a gate — when it
 * fails to load the field stays a plain input with a notice, so a private or
 * unreachable repository never blocks an upgrade by hand.
 *
 * Keyboard-first like the rest of the app: arrows move the highlight (or
 * open the list), Enter picks, Escape dismisses the list without closing the
 * dialog, and typing filters the options.
 */
function ChartVersionField({ repoUrl, chart, value, disabled, onChange }: ChartVersionFieldProps) {
  const [versions, setVersions] = useState<HelmChartVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the input currently holds focus: a list that finishes loading
  // while the user waits on it opens immediately instead of requiring a
  // refocus.
  const focusedRef = useRef(false);

  useEffect(() => {
    // The list only exists once the upgrade pulls from a repository: the
    // values-only path (empty repo URL) reuses the stored chart.
    if (disabled || !repoUrl.trim() || !chart.trim()) {
      setVersions([]);
      setLoading(false);
      setNotice("");
      setOpen(false);
      return;
    }
    let active = true;
    setLoading(true);
    setNotice("");
    // Debounced so typing a URL or chart name does not fetch per keystroke.
    const timer = setTimeout(() => {
      void desktop.helm
        .chartVersions({ repoUrl: repoUrl.trim(), chart: chart.trim() })
        .then((response) => {
          if (!active) return;
          setVersions(response.versions ?? []);
          setHighlighted(0);
          if (focusedRef.current) setOpen(true);
        })
        .catch((cause) => {
          if (!active) return;
          setVersions([]);
          setNotice(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repoUrl, chart, disabled]);

  const query = value.trim().toLowerCase();
  const matches = query
    ? versions.filter((item) => item.version.toLowerCase().includes(query))
    : versions;

  // Keep the highlighted option in view as arrows move through the list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-option-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  const pick = (item: HelmChartVersion) => {
    onChange(item.version);
    setOpen(false);
  };

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" && !open && matches.length) {
      event.preventDefault();
      setOpen(true);
      setHighlighted(0);
      return;
    }
    if (!open || !matches.length) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlighted((index) => Math.min(index + 1, matches.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        pick(matches[highlighted] ?? matches[0]);
        break;
      case "Escape":
        // Dismiss the list only; the dialog itself stays open.
        event.stopPropagation();
        setOpen(false);
        break;
    }
  }

  return (
    <div className="helm-version-combo" data-testid="helm-version-combo">
      <div className="helm-version-input">
        <input
          aria-autocomplete="list"
          aria-controls="helm-version-listbox"
          aria-expanded={open}
          className="helm-upgrade-input"
          data-testid="helm-upgrade-version"
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => {
            focusedRef.current = true;
            if (versions.length) setOpen(true);
          }}
          onBlur={() => {
            focusedRef.current = false;
            setOpen(false);
          }}
          onKeyDown={handleKeyDown}
          placeholder="latest"
          role="combobox"
          spellCheck={false}
          value={value}
        />
        {loading ? (
          <LoaderCircle aria-hidden="true" className="spin helm-version-affordance" />
        ) : versions.length ? (
          <ChevronDown aria-hidden="true" className="helm-version-affordance" data-open={open || undefined} />
        ) : null}
      </div>
      {notice ? (
        <span className="helm-version-notice" data-testid="helm-version-notice" role="status">
          Version list unavailable ({notice}). Type a version manually.
        </span>
      ) : null}
      {open && matches.length > 0 ? (
        <div
          aria-label="Chart versions"
          className="helm-version-list"
          data-testid="helm-version-list"
          id="helm-version-listbox"
          ref={listRef}
          role="listbox"
        >
          {matches.map((item, index) => (
            <button
              key={item.version}
              aria-selected={item.version === value.trim()}
              className="helm-version-option"
              data-highlighted={index === highlighted || undefined}
              data-option-index={index}
              data-testid="helm-version-option"
              onClick={() => pick(item)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              role="option"
              title={item.description}
              type="button"
            >
              <strong>{item.version}</strong>
              {item.appVersion ? <span className="helm-version-app">app {item.appVersion}</span> : null}
              {item.created ? <span className="helm-version-created">{formatAge(item.created)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
