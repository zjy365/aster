import { ArrowRightLeft, LoaderCircle, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePortForwardSessions } from "../hooks/usePortForwardSessions";
import { formatAge } from "../lib/format";

export interface PortForwardsIndicatorProps {
  coreReady: boolean;
  /** Resolves a context id to its display name for the cluster column. */
  contextLabel(contextId: string): string;
}

/**
 * Toolbar indicator for every active port-forward session the sidecar owns,
 * across contexts. The count and rows come from the sidecar's registry (the
 * source of truth) reconciled with the renderer's own forward store, so a
 * forward the renderer lost — a reload, a missed stop — still shows here and
 * can still be stopped. Starting/stopping a forward stays in the Ports tab;
 * this surface is read-and-stop only.
 */
export function PortForwardsIndicator({ coreReady, contextLabel }: PortForwardsIndicatorProps) {
  const sessions = usePortForwardSessions(coreReady);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Fresh list on open; the slow poll keeps the badge current otherwise.
    void sessions.refresh();
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase: Escape closes the panel before the app-level Escape
    // handler (back out of a detail view) sees the keystroke.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, sessions.refresh]);

  if (!sessions.count && !open) return null;

  return (
    <div className="port-forwards-indicator" data-testid="port-forwards-indicator" ref={rootRef}>
      <Tooltip>
        <TooltipTrigger
          aria-expanded={open}
          aria-label={`Port forwards (${sessions.count} active)`}
          data-testid="port-forwards-toggle"
          onClick={() => setOpen((value) => !value)}
          render={<Button aria-haspopup="dialog" size="icon" variant="ghost" />}
        >
          <ArrowRightLeft aria-hidden="true" />
          {sessions.count > 0 && (
            <span className="port-forwards-count" data-testid="port-forwards-count">{sessions.count}</span>
          )}
        </TooltipTrigger>
        <TooltipContent>Port forwards</TooltipContent>
      </Tooltip>

      {open && (
        <div aria-label="Active port forwards" className="port-forwards-panel" data-testid="port-forwards-panel" role="dialog">
          <div className="port-forwards-header">
            <div>
              <h2>Port forwards</h2>
              <p>{sessions.error ? `Session list unavailable: ${sessions.error}` : `${sessions.count} active across all clusters`}</p>
            </div>
            <div className="port-forwards-header-actions">
              <Button
                data-testid="port-forwards-stop-all"
                disabled={!sessions.rows.some((row) => !row.busy)}
                size="sm"
                variant="outline"
                onClick={() => void sessions.stopAll()}
              >
                <Square aria-hidden="true" />
                Stop all
              </Button>
              <Button aria-label="Close port forwards" size="icon-sm" variant="ghost" onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="port-forwards-columns" aria-hidden="true">
            <span>Cluster</span><span>Resource</span><span>Forward</span><span>Age</span><span />
          </div>
          <div className="port-forwards-list">
            {sessions.rows.length === 0 && (
              <p className="port-forwards-empty">
                {sessions.loading ? "Loading sessions…" : "No active port forwards."}
              </p>
            )}
            {sessions.rows.map((row) => (
              <div className="port-forward-session-row" data-testid="port-forward-session-row" key={row.key}>
                <span className="port-forwards-cluster" title={contextLabel(row.contextId)}>{contextLabel(row.contextId)}</span>
                <span className="port-forwards-resource">
                  <span className="port-forwards-resource-name" title={`${row.kind} ${row.namespace}/${row.name}`}>
                    {row.kind} {row.namespace}/{row.name}
                  </span>
                  {row.pod ? <span className="port-forwards-pod" title={row.pod}>via {row.pod}</span> : null}
                </span>
                <span className="port-forwards-ports">
                  {row.localPort ? `${row.localPort} → ${row.targetPort}` : `port ${row.targetPort}`}
                </span>
                <span className="port-forwards-age" title={row.startedAt || undefined}>{row.startedAt ? formatAge(row.startedAt) : "—"}</span>
                <span className="port-forwards-state">
                  {row.busy ? (
                    <>
                      <LoaderCircle aria-hidden="true" className="spin" />
                      {row.id ? "Stopping…" : "Starting…"}
                    </>
                  ) : row.error ? (
                    <span className="port-forwards-error" title={row.error}>Failed: {row.error}</span>
                  ) : (
                    <Button
                      data-testid="port-forward-session-stop"
                      disabled={!(row.id || row.stopKey)}
                      size="sm"
                      variant="outline"
                      onClick={() => void sessions.stop(row)}
                    >
                      <Square aria-hidden="true" />
                      Stop
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
