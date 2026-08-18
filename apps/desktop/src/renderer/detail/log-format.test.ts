// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  formatForExport,
  formatForTerminal,
  formatLogTimestamp,
  parseLogLine,
  podColorCode,
  sanitizeAnsi,
  shortenPodName,
} from "./log-format";

describe("sanitizeAnsi", () => {
  it("keeps SGR color sequences", () => {
    expect(sanitizeAnsi("\x1b[31mred\x1b[0m")).toBe("\x1b[31mred\x1b[0m");
  });

  it("strips cursor movement, erase, and title sequences", () => {
    expect(sanitizeAnsi("\x1b[2Kcleared\x1b[1;1Hhome\x1b]0;title\x07end")).toBe("clearedhomeend");
  });

  it("strips C0 control characters but keeps tabs", () => {
    expect(sanitizeAnsi("a\x07b\tc\x00d")).toBe("ab\tcd");
  });
});

describe("parseLogLine", () => {
  it("extracts a kubernetes RFC3339 nano timestamp prefix", () => {
    const parsed = parseLogLine("2026-08-17T08:45:02.123456789Z hello");
    expect(parsed.timestamp).toBe("2026-08-17T08:45:02.123456789Z");
    expect(parsed.body).toBe("hello");
    expect(parsed.level).toBe("unknown");
  });

  it("detects levels in JSON logs", () => {
    expect(parseLogLine('{"level":"error","msg":"boom"}').level).toBe("error");
    expect(parseLogLine('{"level":"warn","msg":"slow"}').level).toBe("warn");
    expect(parseLogLine('{"level":"info","msg":"ok"}').level).toBe("info");
    expect(parseLogLine('{"level":"debug","msg":"trace"}').level).toBe("debug");
  });

  it("detects levels in key=value and token logs", () => {
    expect(parseLogLine("ts=now level=error msg=boom").level).toBe("error");
    expect(parseLogLine("ERROR something failed").level).toBe("error");
    expect(parseLogLine("WARNING deprecated").level).toBe("warn");
  });

  it("detects klog severity prefixes", () => {
    expect(parseLogLine("E0817 16:00:00.000000 1 controller.go: boom").level).toBe("error");
    expect(parseLogLine("I0817 16:00:00.000000 1 controller.go: fine").level).toBe("info");
  });

  it("treats plain output as unknown", () => {
    expect(parseLogLine("listening on :8080").level).toBe("unknown");
  });
});

describe("formatLogTimestamp", () => {
  it("renders compact local time", () => {
    const rendered = formatLogTimestamp("2026-08-17T08:45:02.123Z");
    expect(rendered).toMatch(/^\d{2}:\d{2}:\d{2}\.123$/);
  });

  it("falls back to the raw value for unparseable input", () => {
    expect(formatLogTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("formatForTerminal", () => {
  it("dims the timestamp and colors error lines", () => {
    const out = formatForTerminal("2026-08-17T08:45:02Z ERROR boom", { showTimestamp: true });
    expect(out).toContain("\x1b[90m");
    expect(out).toContain("\x1b[91mERROR boom\x1b[0m");
  });

  it("hides the timestamp when toggled off", () => {
    const out = formatForTerminal("2026-08-17T08:45:02Z hello", { showTimestamp: false });
    expect(out).toBe("hello");
  });

  it("preserves the app's own colors in unknown lines", () => {
    const out = formatForTerminal("\x1b[32mgreen\x1b[0m", { showTimestamp: true });
    expect(out).toBe("\x1b[32mgreen\x1b[0m");
  });
});

describe("formatForExport", () => {
  it("strips every escape sequence including SGR", () => {
    expect(formatForExport("\x1b[31mred\x1b[0m \x1b[2Kplain")).toBe("red plain");
  });

  it("prefixes the pod name when present", () => {
    expect(formatForExport("hello", "web-0")).toBe("web-0 hello");
  });
});

describe("pod prefixes", () => {
  it("assigns stable colors per pod", () => {
    expect(podColorCode("web-0")).toBe(podColorCode("web-0"));
    expect(podColorCode("web-0")).not.toBe(podColorCode("web-1") && podColorCode("web-2"));
  });

  it("shortens long pod names keeping the generated suffix", () => {
    expect(shortenPodName("web-0")).toBe("web-0");
    const short = shortenPodName("sealos-desktop-75f67d64b5-vrk9k");
    expect(short.length).toBe(24);
    expect(short).toContain("…");
    expect(short.endsWith("b5-vrk9k")).toBe(true);
  });

  it("renders the pod column before the timestamp", () => {
    const out = formatForTerminal("2026-08-17T08:45:02Z hello", { showTimestamp: true, pod: "web-0" });
    expect(out.indexOf("web-0")).toBeLessThan(out.indexOf("│"));
  });
});
