// SPDX-License-Identifier: Apache-2.0
import { ArrowDownToLine, Download, LoaderCircle, Radio, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";

import type { WorkloadKind } from "../../shared/types";
import { desktop } from "../lib/desktop";
import { messageOf } from "../lib/format";
import { Button } from "../components/ui/button";
import { formatForExport, formatForTerminal } from "./log-format";

const MAX_BUFFERED_LINES = 5_000;
const TERMINAL_SCROLLBACK = 10_000;
const TAIL_OPTIONS = [100, 500, 1_000, 2_000, 5_000];

const TERMINAL_THEME = {
  background: "#0b0d10",
  foreground: "#d4dbe4",
  cursor: "#0b0d10", // read-only surface: hide the cursor block
  selectionBackground: "rgba(88, 130, 247, 0.35)",
  black: "#0b0d10",
  brightBlack: "#5c6673",
  red: "#e5534b",
  brightRed: "#f47067",
  yellow: "#c69026",
  brightYellow: "#dda845",
  green: "#57ab5a",
  brightGreen: "#6fdd8b",
  cyan: "#39c5cf",
  brightCyan: "#56d4dd",
  blue: "#539bf5",
  brightBlue: "#6cb6ff",
  magenta: "#b083f0",
  brightMagenta: "#dcbdfb",
  white: "#d4dbe4",
  brightWhite: "#ffffff",
};

interface LogLineEntry {
  pod?: string;
  text: string;
}

export interface LogViewerProps {
  contextId: string;
  namespace: string;
  name: string;
  /** Workload fan-in mode: aggregate logs across the workload's pods. */
  workload?: WorkloadKind;
}

/**
 * Terminal-grade log viewer: xterm surface with level-colored lines, follow
 * streaming, container/tail controls, in-buffer search (⌘F), client-side
 * filtering, and export. With `workload` set it merges the workload's pods
 * (stern-style colored pod prefixes) instead of reading a single pod.
 * Self-contained — owns its fetching so the parent only passes an identity.
 */
export function LogViewer({ contextId, namespace, name, workload }: LogViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const linesRef = useRef<LogLineEntry[]>([]);
  const atBottomRef = useRef(true);
  const renderOptionsRef = useRef({ filter: "", showTimestamps: true });

  const [containers, setContainers] = useState<string[]>([]);
  const [container, setContainer] = useState("");
  const [previous, setPrevious] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [tail, setTail] = useState(1_000);
  const [following, setFollowing] = useState(true);
  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchLabel, setMatchLabel] = useState("");
  const [lineCount, setLineCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);

  const writeEntry = useCallback((entry: LogLineEntry) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const { filter: activeFilter, showTimestamps: timestamps } = renderOptionsRef.current;
    if (!activeFilter || `${entry.pod ?? ""} ${entry.text}`.toLowerCase().includes(activeFilter)) {
      terminal.writeln(formatForTerminal(entry.text, { showTimestamp: timestamps, pod: entry.pod }));
      if (atBottomRef.current) terminal.scrollToBottom();
    }
  }, []);

  const rewrite = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const { filter: activeFilter, showTimestamps: timestamps } = renderOptionsRef.current;
    const source = linesRef.current;
    const visible = activeFilter
      ? source.filter((entry) => `${entry.pod ?? ""} ${entry.text}`.toLowerCase().includes(activeFilter))
      : source;
    terminal.reset();
    if (visible.length) {
      terminal.write(visible.map((entry) => formatForTerminal(entry.text, { showTimestamp: timestamps, pod: entry.pod })).join("\r\n") + "\r\n");
    }
    terminal.scrollToBottom();
    atBottomRef.current = true;
    setPaused(false);
  }, []);

  // Terminal lifecycle: one instance per mounted viewer. The tab panel
  // unmounts when inactive, so the surface is always created visible.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      disableStdin: true,
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: TERMINAL_SCROLLBACK,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });
    terminal.onScroll(() => {
      const buffer = terminal.buffer.active;
      const atBottom = buffer.viewportY >= buffer.baseY;
      atBottomRef.current = atBottom;
      setPaused(!atBottom);
    });
    search.onDidChangeResults(({ resultCount, resultIndex }) => {
      setMatchLabel(resultCount === 0 ? "No results" : resultCount > 999 ? "999+ matches" : `${resultIndex + 1} of ${resultCount}`);
    });
    terminalRef.current = terminal;
    searchRef.current = search;
    const frame = requestAnimationFrame(() => fit.fit());
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = undefined;
      searchRef.current = undefined;
    };
  }, []);

  // Data lifecycle: refetch whenever the target identity or fetch shape changes.
  useEffect(() => {
    linesRef.current = [];
    setLineCount(0);
    setContainers([]);
    setLoading(true);
    terminalRef.current?.reset();

    let active = true;
    let stopStream: (() => void) | undefined;
    const push = (entry: LogLineEntry) => {
      linesRef.current = [...linesRef.current.slice(-(MAX_BUFFERED_LINES - 1)), entry];
      writeEntry(entry);
    };
    const fail = (cause: unknown) => {
      if (!active) return;
      terminalRef.current?.writeln(`\x1b[91m✕ ${messageOf(cause)}\x1b[0m`);
      setLoading(false);
    };
    const writeNote = (message: string) => {
      if (active) terminalRef.current?.writeln(`\x1b[90m— ${message} —\x1b[0m`);
    };

    if (workload) {
      const request = { contextId, namespace, kind: workload, name, container: container || undefined, tailLines: tail };
      if (following) {
        // A tail=1 probe fetches the container list for the picker; the
        // aggregate stream itself only yields log lines.
        void desktop.resources.workloadLogs({ ...request, tailLines: 1 })
          .then((probe) => active && setContainers(probe.containers ?? []))
          .catch(() => undefined);
        stopStream = desktop.resources.followWorkloadLogs(request, (batch) => {
          if (!active) return;
          setLoading(false);
          if (batch.type === "note") {
            writeNote(batch.message || "");
            return;
          }
          if (batch.type === "error") {
            const tag = batch.pod ? `${batch.pod}: ` : "";
            terminalRef.current?.writeln(`\x1b[91m✕ ${tag}${batch.message || "unknown"}\x1b[0m`);
            return;
          }
          if (batch.text !== undefined) {
            push({ pod: batch.pod, text: batch.text });
            setLineCount((count) => count + 1);
          }
        });
      } else {
        void desktop.resources.workloadLogs(request)
          .then((response) => {
            if (!active) return;
            setContainers(response.containers ?? []);
            if (response.note) writeNote(response.note);
            for (const line of response.lines) push({ pod: line.pod, text: line.text });
            setLineCount(linesRef.current.length);
            if (response.truncated) writeNote("output reached the aggregate cap; narrow the tail or filter");
            if (atBottomRef.current) terminalRef.current?.scrollToBottom();
            setLoading(false);
          })
          .catch(fail);
      }
    } else {
      const request = { contextId, namespace, name, container: container || undefined, previous, timestamps: true };
      if (following && !previous) {
        // A tail=1 probe fetches the container list for the picker; the stream
        // itself only yields log lines. Its single line is discarded.
        void desktop.resources.logs({ ...request, tailLines: 1 })
          .then((probe) => active && setContainers(probe.containers ?? []))
          .catch(() => undefined);
        stopStream = desktop.resources.followLogs({ ...request, tailLines: tail }, (batch) => {
          if (!active) return;
          setLoading(false);
          if (batch.type === "error") {
            terminalRef.current?.writeln(`\x1b[91m✕ stream: ${batch.message || "unknown"}\x1b[0m`);
            return;
          }
          if (batch.type === "line" && batch.text !== undefined) {
            push({ text: batch.text });
            setLineCount((count) => count + 1);
          }
        });
      } else {
        void desktop.resources.logs({ ...request, tailLines: tail })
          .then((response) => {
            if (!active) return;
            setContainers(response.containers ?? []);
            for (const line of response.text.replace(/\n$/, "").split("\n")) {
              if (line) push({ text: line });
            }
            setLineCount(linesRef.current.length);
            if (response.truncated) writeNote("output reached the 4 MiB cap; narrow the tail or filter");
            if (atBottomRef.current) terminalRef.current?.scrollToBottom();
            setLoading(false);
          })
          .catch(fail);
      }
    }

    return () => {
      active = false;
      stopStream?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId, namespace, name, workload, container, previous, tail, following]);

  // Re-render from the in-memory source of truth when presentation changes.
  useEffect(() => {
    renderOptionsRef.current = { filter: filter.trim().toLowerCase(), showTimestamps };
    rewrite();
  }, [filter, showTimestamps, rewrite]);

  useEffect(() => {
    if (!searchOpen || !searchQuery) {
      searchRef.current?.clearDecorations();
      setMatchLabel("");
      return;
    }
    searchRef.current?.findNext(searchQuery, {
      decorations: {
        matchBackground: "#6cb6ff33",
        matchOverviewRuler: "#6cb6ff",
        activeMatchBackground: "#dda84566",
        activeMatchColorOverviewRuler: "#dda845",
      },
    });
  }, [searchOpen, searchQuery]);

  const jumpToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom();
    atBottomRef.current = true;
    setPaused(false);
  }, []);

  const download = useCallback(() => {
    const content = linesRef.current.map((entry) => formatForExport(entry.text, entry.pod)).join("\n");
    void desktop.files.saveTextFile(`${name}.log`, content).catch(() => undefined);
  }, [name]);

  return (
    <div className="log-viewer" data-testid="log-viewer">
      <div className="log-viewer-toolbar">
        <div className="log-viewer-toolbar-group">
          {containers.length > 1 && (
            <select
              className="log-viewer-select"
              aria-label="Container"
              data-testid="logs-container-select"
              value={container}
              onChange={(event) => setContainer(event.target.value)}
            >
              <option value="">All default</option>
              {containers.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          <select
            className="log-viewer-select"
            aria-label="Tail lines"
            value={tail}
            onChange={(event) => setTail(Number(event.target.value))}
          >
            {TAIL_OPTIONS.map((option) => <option key={option} value={option}>Last {option.toLocaleString()}</option>)}
          </select>
          {!workload && (
            <label className="log-viewer-check">
              <input type="checkbox" checked={previous} onChange={(event) => setPrevious(event.target.checked)} />
              Previous
            </label>
          )}
          <label className="log-viewer-check">
            <input type="checkbox" checked={showTimestamps} onChange={(event) => setShowTimestamps(event.target.checked)} />
            Timestamps
          </label>
        </div>
        <div className="log-viewer-toolbar-group">
          <span className="log-viewer-status" aria-live="polite">
            {loading ? <><LoaderCircle className="spin" size={12} /> Loading…</> : `${lineCount.toLocaleString()} lines`}
          </span>
          <input
            className="log-viewer-filter"
            placeholder="Filter logs…"
            aria-label="Filter logs"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Button
            variant={searchOpen ? "secondary" : "ghost"}
            size="icon"
            aria-label="Search logs"
            data-testid="logs-search-toggle"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search />
          </Button>
          <Button
            variant={following && !previous ? "secondary" : "ghost"}
            size="icon"
            aria-label={following ? "Pause live stream" : "Follow live stream"}
            data-testid="logs-follow-toggle"
            disabled={previous}
            onClick={() => setFollowing((value) => !value)}
          >
            <Radio />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Download logs" data-testid="logs-download" onClick={download}>
            <Download />
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div className="log-viewer-search" data-testid="logs-search-bar">
          <input
            autoFocus
            placeholder="Search in buffer (Enter / Shift+Enter)"
            aria-label="Search in logs"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchQuery) {
                if (event.shiftKey) searchRef.current?.findPrevious(searchQuery);
                else searchRef.current?.findNext(searchQuery);
              }
              if (event.key === "Escape") setSearchOpen(false);
            }}
          />
          <span className="log-viewer-search-count">{matchLabel}</span>
          <Button size="icon" variant="ghost" aria-label="Close search" onClick={() => setSearchOpen(false)}>
            <X />
          </Button>
        </div>
      )}

      <div className="log-viewer-terminal-wrap">
        <div ref={hostRef} className="log-viewer-terminal" data-testid="pod-logs" />
        {paused && following && (
          <button type="button" className="log-viewer-jump" data-testid="logs-jump-bottom" onClick={jumpToBottom}>
            <ArrowDownToLine size={13} />
            New logs
          </button>
        )}
      </div>
    </div>
  );
}
