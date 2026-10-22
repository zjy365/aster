/**
 * Pure helpers for the ephemeral debug container dialog. Kept free of React
 * so the argv parsing is unit-testable like the other detail projections.
 */

/** Default debug image proposed by the dialog; a minimal shell environment. */
export const DEFAULT_DEBUG_IMAGE = "busybox:1.36";

/**
 * Splits the dialog's free-form command field into argv entries. Entries are
 * separated by whitespace or commas — enough for the common `/bin/sh, -c,
 * ps aux` style input without quoting machinery.
 */
export function parseDebugCommand(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Longest allowed generated/explicit debug container name (DNS label bound). */
export const MAX_DEBUG_NAME_LENGTH = 253;
