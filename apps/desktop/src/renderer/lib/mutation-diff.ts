// SPDX-License-Identifier: Apache-2.0
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import { parse, stringify } from "yaml";

/**
 * Fields the API server rewrites on every update (dry-run included). They are
 * not part of the user's change, so diffing them would surface phantom edits
 * like `generation: 8 → 9` on every review.
 */
const VOLATILE_METADATA_FIELDS = ["generation", "resourceVersion"];

/**
 * Re-serializes both sides through one YAML printer so the diff only reflects
 * content changes, and strips server-managed metadata that the dry-run bumps
 * on its own. Falls back to the raw text when parsing fails — a malformed
 * preview should still render, not disappear.
 */
export function normalizeForDiff(yamlText: string): string {
  if (!yamlText.trim()) return "";
  try {
    const value: unknown = parse(yamlText);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const metadata = (value as Record<string, unknown>).metadata;
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const record = metadata as Record<string, unknown>;
        for (const field of VOLATILE_METADATA_FIELDS) {
          delete record[field];
        }
      }
    }
    // lineWidth 0 matches the Go YAML emitter: no folding of long scalars.
    return stringify(value, { lineWidth: 0 }).trimEnd();
  } catch {
    return yamlText;
  }
}

/**
 * Builds the FileDiffMetadata consumed by <FileDiff>. An empty side becomes a
 * null file, so creates render as pure additions and deletes as pure removals.
 */
export function buildMutationDiff(name: string, beforeYaml: string, afterYaml: string): FileDiffMetadata | undefined {
  const fileName = `${name || "object"}.yaml`;
  const before = normalizeForDiff(beforeYaml);
  const after = normalizeForDiff(afterYaml);
  if (before === after) return undefined;
  return parseDiffFromFile(
    before ? { name: fileName, contents: before } : null,
    after ? { name: fileName, contents: after } : null,
  );
}
