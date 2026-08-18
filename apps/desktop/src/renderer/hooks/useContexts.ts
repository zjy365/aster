import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextInfo, CoreStatus } from "../../shared/types";
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

  const loadContexts = useCallback(async () => {
    setContextsLoading(true);
    setContextsError("");
    try {
      const next = await desktop.contexts.list();
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
    } catch (cause) {
      setContextsError(messageOf(cause));
    } finally {
      setContextsLoading(false);
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
