// SPDX-License-Identifier: Apache-2.0
//
// Log line parsing and terminal colorization for the xterm-based log viewer.
// Lines arrive as plain text from the core; this module turns them into
// ANSI-colored output: dimmed timestamps, level-colored bodies, and the app's
// own color escapes preserved (but its cursor/erase sequences stripped so a
// buggy workload cannot corrupt the viewer surface).

export type LogLevel = "error" | "warn" | "info" | "debug" | "unknown";

export interface ParsedLogLine {
  /** Leading RFC3339 timestamp emitted by the Kubernetes logs API. */
  timestamp?: string;
  level: LogLevel;
  /** Line with the timestamp prefix removed and unsafe escapes stripped. */
  body: string;
}

const TIMESTAMP_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+/;

const LEVEL_PATTERNS: [LogLevel, RegExp][] = [
  ["error", /"level"\s*:\s*"(?:error|fatal|panic)"|\b(?:level|lvl)=(?:error|fatal|panic)\b|\b(?:ERROR|FATAL|PANIC)\b|^[EF]\d{4} /i],
  ["warn", /"level"\s*:\s*"warn|\b(?:level|lvl)=warn\b|\bWARN(?:ING)?\b|^W\d{4} /i],
  ["info", /"level"\s*:\s*"info|\b(?:level|lvl)=info\b|\bINFO\b|^I\d{4} /i],
  ["debug", /"level"\s*:\s*"(?:debug|trace)"|\b(?:level|lvl)=(?:debug|trace)\b|\b(?:DEBUG|TRACE)\b|^D\d{4} /i],
];

const LEVEL_COLORS: Record<Exclude<LogLevel, "unknown">, number> = {
  error: 91, // bright red
  warn: 93, // bright yellow
  info: 96, // bright cyan
  debug: 90, // bright black / gray
};

// Keep only SGR (…m) sequences: color and intensity. Everything else a
// terminal escape could do (cursor moves, erases, title sets, mode switches)
// would fight the viewer's own rendering, so strip it along with C0 controls.
// eslint-disable-next-line no-control-regex
const UNSAFE_ESCAPES = /\x1b(?:\[(?![0-9;]*m)[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-2]|[@-Z\\-_]|[=>#][0-9]?)/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g;

export function sanitizeAnsi(text: string): string {
  return text.replace(UNSAFE_ESCAPES, "").replace(CONTROL_CHARS, "");
}

export function parseLogLine(raw: string): ParsedLogLine {
  const clean = sanitizeAnsi(raw);
  const timestampMatch = clean.match(TIMESTAMP_PREFIX);
  const body = timestampMatch ? clean.slice(timestampMatch[0].length) : clean;
  let level: LogLevel = "unknown";
  for (const [candidate, pattern] of LEVEL_PATTERNS) {
    if (pattern.test(body)) {
      level = candidate;
      break;
    }
  }
  return { timestamp: timestampMatch?.[1], level, body };
}

/** Compact local wall-clock form: 16:45:02.123. Falls back to the raw value. */
export function formatLogTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const RESET = "\x1b[0m";
const DIM = "\x1b[90m";

// Pod prefix palette for workload fan-in views: distinguishable hues that do
// not collide with the level colors (91/93/96/90 are level-reserved).
const POD_PALETTE = [35, 34, 32, 94, 95, 92, 36, 31];

/** Stable pod → palette color, so one pod keeps one color across the view. */
export function podColorCode(pod: string): number {
  let hash = 0;
  for (let index = 0; index < pod.length; index++) {
    hash = (hash * 31 + pod.charCodeAt(index)) | 0;
  }
  return POD_PALETTE[Math.abs(hash) % POD_PALETTE.length];
}

/** K8s pod names differ in their generated suffix; keep both ends readable. */
export function shortenPodName(pod: string): string {
  const MAX = 24;
  if (pod.length <= MAX) return pod;
  return `${pod.slice(0, 12)}…${pod.slice(-11)}`;
}

export function formatForTerminal(raw: string, options: { showTimestamp: boolean; pod?: string }): string {
  const { timestamp, level, body } = parseLogLine(raw);
  let prefix = "";
  if (options.pod) {
    prefix = `\x1b[${podColorCode(options.pod)}m${shortenPodName(options.pod)}${RESET} ${DIM}│${RESET} `;
  }
  if (options.showTimestamp && timestamp) {
    prefix += `${DIM}${formatLogTimestamp(timestamp)}${RESET} `;
  }
  if (level === "unknown") return `${prefix}${body}`;
  const color = LEVEL_COLORS[level];
  return `${prefix}\x1b[${color}m${body}${RESET}`;
}

// eslint-disable-next-line no-control-regex
const ALL_ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Plain-text form for export: pod column, full timestamp, escapes stripped. */
export function formatForExport(raw: string, pod?: string): string {
  const line = sanitizeAnsi(raw).replace(ALL_ESCAPES, "");
  return pod ? `${pod} ${line}` : line;
}
