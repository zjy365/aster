// SPDX-License-Identifier: Apache-2.0
import { useMemo } from "react";
import type { FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffectiveTheme } from "../hooks/useTheme";
import { buildMutationDiff } from "../lib/mutation-diff";

/**
 * GitHub-style review surface for a staged dry-run: unified hunks with
 * collapsible context, line numbers, and word-level highlights, computed from
 * the live object and the dry-run result. Rendering runs on the main thread —
 * the payloads here are single YAML documents, not repo-scale patches.
 */
export function MutationDiffView({ name, beforeYaml, afterYaml, className, testId, ariaLabel }: {
  name: string;
  beforeYaml: string;
  afterYaml: string;
  className: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const themeType = useEffectiveTheme();
  const fileDiff = useMemo(() => buildMutationDiff(name, beforeYaml, afterYaml), [name, beforeYaml, afterYaml]);
  const options = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffStyle: "unified",
      lineDiffType: "word",
      overflow: "wrap",
      // Same shiki themes as HighlightedYaml so the review dialog and the YAML
      // tab share one palette.
      theme: { light: "github-light", dark: "github-dark" },
      themeType,
    }),
    [themeType],
  );

  if (!fileDiff) {
    return (
      <div className={`${className} mutation-review-diff-empty`} data-testid={testId} aria-label={ariaLabel}>
        No changes were returned by the dry-run.
      </div>
    );
  }
  return (
    <div className={className} data-testid={testId} aria-label={ariaLabel}>
      <FileDiff fileDiff={fileDiff} options={options} />
    </div>
  );
}
