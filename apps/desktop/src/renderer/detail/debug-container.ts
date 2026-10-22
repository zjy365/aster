/**
 * Pure helpers for the ephemeral debug container dialog. Kept free of React
 * so the argv parsing is unit-testable like the other detail projections.
 */

/** Default debug image proposed by the dialog; a minimal shell environment. */
export const DEFAULT_DEBUG_IMAGE = "busybox:1.36";

/**
 * Parses argv without executing a shell or expanding variables. Unquoted
 * whitespace and commas separate arguments (including the legacy comma
 * syntax); quotes group text and backslashes escape outside single quotes.
 * For a shell command, quote the complete -c argument: /bin/sh -c 'ps aux'.
 */
export function parseDebugCommand(value: string): string[] {
  const argv: string[] = [];
  let argument = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\" && quote !== "'") {
      if (index + 1 >= value.length) throw new Error("Trailing backslash in command. Escape it or remove it.");
      // Within double quotes, preserve backslashes before ordinary text
      // (e.g. printf '%s\n'); only shell quoting characters are escaped.
      if (quote === '"' && !['"', "\\", "$", "`", "\n"].includes(value[index + 1])) {
        argument += character;
      } else {
        argument += value[++index];
      }
      started = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else argument += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/[\s,]/.test(character)) {
      if (started) argv.push(argument);
      argument = "";
      started = false;
    } else {
      argument += character;
      started = true;
    }
  }
  if (quote) throw new Error("Unclosed quote in command. Close the quote before submitting.");
  if (started) argv.push(argument);
  return argv;
}

/** Longest allowed generated/explicit debug container name (DNS label bound). */
export const MAX_DEBUG_NAME_LENGTH = 253;
