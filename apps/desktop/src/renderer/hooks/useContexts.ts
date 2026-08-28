import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextHealthMap, ContextInfo, CoreStatus } from "../../shared/types";
import { filterContexts, retainedContextChoice, type ContextLayout } from "../lib/context-picker";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export type AppView = "contexts" | "workbench" | "settings";

export interface ContextsState {
  view: AppView;
  /** The view settings was opened from; the page's back button returns there. */
  settingsFrom: AppView;
  contexts: ContextInfo[];
  contextId: string;
  contextChoice: string;
  contextQuery: string;
  contextLayout: ContextLayout;
  contextsLoading: boolean;
  contextsError: string;
  /** Per-context reachability, filled in asynchronously after each list load. */
  contextHealth: ContextHealthMap;
  /** True while a health probe round is in flight (rows show a checking dot). */
  healthProbing: boolean;
  activeContext?: ContextInfo;
  chosenContext?: ContextInfo;
  visibleContexts: ContextInfo[];
  setView(view: AppView): void;
  setSettingsFrom(view: AppView): void;
  setContextId(id: string): void;
  setContextChoice(id: string): void;
  setContextQuery(query: string): void;
  setContextLayout(layout: ContextLayout): void;
  loadContexts(): Promise<void>;
}

/**
 * Owns the kubeconfig context inventory and which context the workbench is
 * connected to. Cross-domain resets on connect/disconnect stay in the
 * composition root (App), which orchestrates the other hooks.
 */
export function useContexts(core: CoreStatus): ContextsState {
  const [view, setView] = useState<AppView>("contexts");
  // Where settings was opened from, so its back button returns there. Only
  // the contexts view opens settings today; recording the origin keeps a
  // future workbench entry correct for free.
  const [settingsFrom, setSettingsFrom] = useState<AppView>("contexts");
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [contextId, setContextId] = useState("");
  const [contextChoice, setContextChoice] = useState(() => localStorage.getItem("aster.lastContext") || "");
  const [contextQuery, setContextQuery] = useState("");
  const [contextLayout, setContextLayout] = useState<ContextLayout>("list");
  const [contextsLoading, setContextsLoading] = useState(false);
  const [contextsError, setContextsError] = useState("");
  const [contextHealth, setContextHealth] = useState<ContextHealthMap>({});
  const [healthProbing, setHealthProbing] = useState(false);
  // Guards against a slow list/probe round overwriting a newer one (Refresh
  // while a previous probe is still waiting on a dead cluster).
  const loadSeq = useRef(0);

  const loadContexts = useCallback(async () => {
    setContextsLoading(true);
    setContextsError("");
    const seq = ++loadSeq.current;
    try {
      const next = await desktop.contexts.list();
      if (loadSeq.current !== seq) return;
      setContexts(next);
      setContextChoice((current) => {
        // Preselect the last connected context across launches; connecting
        // still requires an explicit click.
        const preferred = retainedContextChoice(next, current);
        const stored = localStorage.getItem("aster.lastContext");
        if (current === "" && stored && next.some((item) => item.id === stored)) {
          return stored;
        }
        return preferred;
      });
      // The list is usable now; probes below must not hold the loading
      // spinner (a dead cluster waits out its probe timeout).
      setContextsLoading(false);
      // Reachability probes are advisory and run after the list renders.
      // Contexts with a static config error are skipped — they cannot dial.
      const probeIds = next.filter((item) => !item.error).map((item) => item.id);
      setContextHealth({});
      if (!probeIds.length) {
        setHealthProbing(false);
        return;
      }
      setHealthProbing(true);
      try {
        const health = await desktop.contexts.health(probeIds);
        if (loadSeq.current !== seq) return;
        setContextHealth(Object.fromEntries(health.map((entry) => [entry.id, entry])));
      } catch {
        // A failed probe round just clears the checking dots; the list itself
        // is already usable, so this stays silent.
        if (loadSeq.current === seq) setContextHealth({});
      } finally {
        if (loadSeq.current === seq) setHealthProbing(false);
      }
    } catch (cause) {
      if (loadSeq.current !== seq) return;
      setContextsError(messageOf(cause));
    } finally {
      if (loadSeq.current === seq) setContextsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (core.state === "ready") void loadContexts();
  }, [core.state, loadContexts]);

  const activeContext = contexts.find((item) => item.id === contextId);
  const chosenContext = contexts.find((item) => item.id === contextChoice);
  const visibleContexts = useMemo(() => filterContexts(contexts, contextQuery), [contextQuery, contexts]);

  return {
    view,
    settingsFrom,
    contexts,
    contextId,
    contextChoice,
    contextQuery,
    contextLayout,
    contextsLoading,
    contextsError,
    contextHealth,
    healthProbing,
    activeContext,
    chosenContext,
    visibleContexts,
    setView,
    setSettingsFrom,
    setContextId,
    setContextChoice,
    setContextQuery,
    setContextLayout,
    loadContexts,
  };
}
