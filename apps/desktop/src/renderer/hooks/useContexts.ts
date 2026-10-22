import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { ContextHealthMap, ContextInfo, CoreStatus } from "../../shared/types";
import { filterContexts, retainedContextChoice, type ContextAliases, type ContextLayout } from "../lib/context-picker";
import { isAggregateSelection, retainClusterSelection } from "../lib/multi-cluster";
import { messageOf } from "../lib/format";
import { desktop } from "../lib/desktop";

export type AppView = "contexts" | "workbench" | "settings";

export interface ContextsState {
  view: AppView;
  /** The view settings was opened from; the page's back button returns there. */
  settingsFrom: AppView;
  contexts: ContextInfo[];
  contextId: string;
  /**
   * The connected selection: one id is the ordinary single-cluster workbench;
   * two or more is the aggregate view (one fan-out table across clusters).
   * `contextId` above is always its first element, so every single-cluster
   * surface keeps a well-defined cluster to talk to.
   */
  contextIds: string[];
  /** True while the workbench shows one aggregate view across 2+ clusters. */
  aggregate: boolean;
  /** The connected selection resolved against the inventory; order preserved. */
  activeContexts: ContextInfo[];
  contextChoice: string;
  contextQuery: string;
  contextLayout: ContextLayout;
  /** The picker's multi-select mode; checkboxes replace the radio highlight. */
  contextMulti: boolean;
  /** The picker's multi-selection draft, in click order; drives aggregate connect. */
  contextChoices: string[];
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
  setContextIds(ids: string[]): void;
  setContextChoice(id: string): void;
  setContextQuery(query: string): void;
  setContextLayout(layout: ContextLayout): void;
  setContextMulti(multi: boolean): void;
  /** Accepts the next selection or an updater (membership toggling). */
  setContextChoices(ids: SetStateAction<string[]>): void;
  loadContexts(): Promise<void>;
}

/**
 * Owns the kubeconfig context inventory and which context(s) the workbench is
 * connected to. The connected selection is an array: length one keeps every
 * existing single-cluster behavior (contextId === contextIds[0]); length two
 * or more is the aggregate view. Cross-domain resets on connect/disconnect
 * stay in the composition root (App), which orchestrates the other hooks. The
 * alias map only affects presentation: filtering, ordering, and display names.
 */
export function useContexts(core: CoreStatus, aliases: ContextAliases): ContextsState {
  const [view, setView] = useState<AppView>("contexts");
  // Where settings was opened from, so its back button can return there. Only
  // the contexts view opens settings today; recording the origin keeps a
  // future workbench entry correct for free.
  const [settingsFrom, setSettingsFrom] = useState<AppView>("contexts");
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [contextChoice, setContextChoice] = useState(() => localStorage.getItem("aster.lastContext") || "");
  const [contextQuery, setContextQuery] = useState("");
  const [contextLayout, setContextLayout] = useState<ContextLayout>("list");
  const [contextMulti, setContextMulti] = useState(false);
  const [contextChoices, setContextChoices] = useState<string[]>([]);
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
      // A multi-selection draft must not outlive the kubeconfig entries it
      // names, exactly like the single choice above.
      setContextChoices((current) => {
        const retained = retainClusterSelection(next.map((item) => item.id), current);
        return retained.length === current.length ? current : retained;
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

  const contextId = contextIds[0] ?? "";
  const activeContext = contexts.find((item) => item.id === contextId);
  const chosenContext = contexts.find((item) => item.id === contextChoice);
  const visibleContexts = useMemo(() => filterContexts(contexts, contextQuery, aliases), [contextQuery, contexts, aliases]);
  const activeContexts = useMemo(
    () => contextIds.flatMap((id) => {
      const context = contexts.find((item) => item.id === id);
      return context ? [context] : [];
    }),
    [contextIds, contexts],
  );

  // The single-connect compatibility setter: entering the workbench with one
  // cluster and leaving it ("" disconnect) both funnel through the array.
  const connectSingle = useCallback((id: string) => setContextIds(id ? [id] : []), []);
  const setMulti = useCallback((multi: boolean) => {
    setContextMulti(multi);
    // Leaving multi-select clears the draft; entering it seeds the draft with
    // the current single highlight so the first checkbox is one click closer.
    if (multi) setContextChoices((current) => (current.length ? current : contextChoice ? [contextChoice] : []));
    else setContextChoices([]);
  }, [contextChoice]);

  return {
    view,
    settingsFrom,
    contexts,
    contextId,
    contextIds,
    aggregate: isAggregateSelection(contextIds),
    activeContexts,
    contextChoice,
    contextQuery,
    contextLayout,
    contextMulti,
    contextChoices,
    contextsLoading,
    contextsError,
    contextHealth,
    healthProbing,
    activeContext,
    chosenContext,
    visibleContexts,
    setView,
    setSettingsFrom,
    setContextId: connectSingle,
    setContextIds,
    setContextChoice,
    setContextQuery,
    setContextLayout,
    setContextMulti: setMulti,
    setContextChoices,
    loadContexts,
  };
}
