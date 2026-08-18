import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Ship } from "lucide-react";
import type { AsterSettings, RelatedResource, ResourceKind, ResourceRow, SourcesReport } from "../shared/types";
import { CommandPalette } from "./components/CommandPalette";
import { UpdateNotice } from "./components/UpdateNotice";
import { ResourceTable, rowKey, TableState } from "./components/ResourceTable";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useContexts } from "./hooks/useContexts";
import { useCoreStatus } from "./hooks/useCoreStatus";
import { useDiagnostics } from "./hooks/useDiagnostics";
import { useDiscovery } from "./hooks/useDiscovery";
import { useHelm } from "./hooks/useHelm";
import { useMutation } from "./hooks/useMutation";
import { useNamespaces } from "./hooks/useNamespaces";
import { useOverview } from "./hooks/useOverview";
import { useResourceDetail } from "./hooks/useResourceDetail";
import { useResourceList } from "./hooks/useResourceList";
import { useTheme } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";
import { buildCommandItems, searchResultItems, type CommandAction } from "./lib/command-palette";
import { messageOf, pluralize } from "./lib/format";
import { customResourceGroups, DEFAULT_KIND, findKindInGroups, flattenResourceGroups, SIDEBAR_RESOURCE_GROUPS } from "./lib/resource-catalog";
import { Sidebar, type SidebarToolGroup } from "./shell/Sidebar";
import { UnifiedToolbar } from "./shell/UnifiedToolbar";
import { WorkbenchShell } from "./shell/WorkbenchShell";
import { ContextPicker } from "./views/ContextPicker";
import { HelmView } from "./views/HelmView";
import { OverviewView } from "./views/OverviewView";
import { SettingsPage } from "./views/SettingsPage";
import { desktop } from "./lib/desktop";

const ResourceDetailView = lazy(() => import("./detail/ResourceDetailView").then((module) => ({
  default: module.ResourceDetailView,
})));
const CreateResourceDialog = lazy(() => import("./detail/CreateResourceDialog").then((module) => ({
  default: module.CreateResourceDialog,
})));

/**
 * Composition root: every domain owns its state in a hook above; this
 * component only wires cross-domain orchestration (connect/disconnect,
 * global shortcuts, app menu commands) and renders the shell.
 */
export default function App() {
  const core = useCoreStatus();
  const updateCard = useUpdater();
  const { theme, effectiveTheme, palette, setTheme, setPalette } = useTheme();
  const contexts = useContexts(core);
  const { contextId } = contexts;
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ResourceKind>(DEFAULT_KIND);
  const namespaces = useNamespaces(contextId, contexts.contexts, setError);
  const resources = useResourceList({
    contextId,
    kind,
    namespace: namespaces.namespace,
    coreReady: core.state === "ready",
    setError,
  });
  const detail = useResourceDetail({
    contextId,
    kind,
    namespace: namespaces.namespace,
    generation: resources.generation,
    items: resources.list.items,
  });
  const diagnostics = useDiagnostics({
    contextId,
    kind,
    selected: detail.selected,
  });
  const mutation = useMutation({
    contextId,
    kind,
    namespace: namespaces.namespace,
    selected: detail.selected,
  });
  const [overviewActive, setOverviewActive] = useState(false);
  const overview = useOverview({
    contextId,
    coreReady: core.state === "ready",
    enabled: overviewActive,
  });
  const helm = useHelm({
    contextId,
    namespace: namespaces.namespace,
    coreReady: core.state === "ready",
  });
  const [helmActive, setHelmActive] = useState(false);
  const helmToolGroups: SidebarToolGroup[] = useMemo(() => [{
    label: "Helm",
    items: [{ id: "helm", label: "Releases", icon: Ship }],
  }], []);
  const searchRef = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settings, setSettings] = useState<AsterSettings>({ kubeconfigSources: [], includeStandardChain: true });
  const [sourcesReport, setSourcesReport] = useState<SourcesReport>({ chain: [], configured: [] });
  const [appVersion, setAppVersion] = useState("");
  const reloadSources = useCallback(async () => {
    try {
      setSourcesReport(await desktop.contexts.sourcesReport());
    } catch {
      // Keep the last report; the settings dialog degrades to paths only.
    }
  }, []);
  const checkForUpdates = useCallback(async () => {
    await desktop.updater.check();
    return desktop.updater.state();
  }, []);
  const discovered = useDiscovery(contextId, core.state === "ready");
  const resourceGroups = useMemo(() => {
    const custom = customResourceGroups(discovered);
    return custom.length ? [...SIDEBAR_RESOURCE_GROUPS, ...custom] : SIDEBAR_RESOURCE_GROUPS;
  }, [discovered]);
  const [pendingSelect, setPendingSelect] = useState<{ name: string; namespace: string }>();
  const [paletteQuery, setPaletteQuery] = useState("");

  // Checkbox multi-select over the currently loaded rows (uids). Resets
  // whenever the list's scope changes so stale uids can never linger.
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setCheckedKeys(new Set());
  }, [contextId, kind.id, namespaces.namespace]);
  const checkedRows = useMemo(
    () => resources.visibleRows.filter((row) => checkedKeys.has(rowKey(row))),
    [resources.visibleRows, checkedKeys],
  );
  const toggleRowChecked = useCallback((row: ResourceRow) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleAllChecked = useCallback(() => {
    setCheckedKeys((prev) => {
      const rows = resources.visibleRows;
      const allChecked = rows.length > 0 && rows.every((row) => prev.has(rowKey(row)));
      return allChecked ? new Set<string>() : new Set(rows.map(rowKey));
    });
  }, [resources.visibleRows]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const deleteCheckedRows = useCallback(async () => {
    if (!contextId || !checkedRows.length) return;
    setBulkBusy(true);
    try {
      for (const row of checkedRows) {
        await desktop.resources.mutate({
          contextId,
          resourceKind: kind,
          namespace: row.namespace || undefined,
          name: row.name,
          resourceVersion: row.resourceVersion,
          operation: "delete",
          dryRun: false,
        });
      }
      setCheckedKeys(new Set());
      setBulkDeleteOpen(false);
      resources.refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBulkBusy(false);
    }
  }, [contextId, checkedRows, kind, resources]);

  const [searchResults, setSearchResults] = useState<RelatedResource[]>([]);

  // Selecting a resource kind always leaves the overview and the Helm pane;
  // the kind switches only when it differs, otherwise the row selection resets.
  const selectKind = useCallback((next: ResourceKind) => {
    setOverviewActive(false);
    setHelmActive(false);
    if (next.id === kind.id) {
      detail.clear();
      return;
    }
    setKind(next);
  }, [kind.id, detail]);

  const showOverview = useCallback(() => {
    detail.clear();
    helm.clear();
    setHelmActive(false);
    setOverviewActive(true);
  }, [detail, helm]);

  const showHelm = useCallback(() => {
    detail.clear();
    setOverviewActive(false);
    setHelmActive(true);
  }, [detail]);

  // Shared navigation for related resources and palette search results:
  // switch kind/namespace, then select the row once its list page arrives.
  const openResource = useCallback((target: { group: string; version: string; resource: string; name: string; namespace?: string }) => {
    const match = flattenResourceGroups(resourceGroups)
      .find((item) => item.group === target.group && item.version === target.version && item.resource === target.resource && item.enabled !== false);
    if (!match) return;
    const { icon: _icon, label: _label, enabled: _enabled, ...nextKind } = match;
    const namespace = target.namespace || "";
    if (namespace !== namespaces.namespace) namespaces.setNamespace(namespace);
    setPendingSelect({ name: target.name, namespace });
    selectKind(nextKind);
  }, [resourceGroups, namespaces, selectKind]);

  useEffect(() => {
    if (!pendingSelect) return;
    const row = resources.list.items.find((item) => item.name === pendingSelect.name && (item.namespace || "") === pendingSelect.namespace);
    if (row) {
      detail.select(row);
      setPendingSelect(undefined);
    }
  }, [pendingSelect, resources.list.items, detail]);

  useEffect(() => {
    const query = paletteQuery.trim();
    if (!paletteOpen || query.length < 2 || !contextId) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      desktop.resources.search({
        contextId,
        query,
        namespace: namespaces.namespace || contexts.activeContext?.namespace || "default",
      })
        .then((items) => { if (active) setSearchResults(items); })
        .catch(() => { if (active) setSearchResults([]); });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [paletteQuery, paletteOpen, contextId, namespaces.namespace, contexts.activeContext]);

  const connectContext = useCallback((targetId?: string) => {
    const target = targetId ? contexts.contexts.find((item) => item.id === targetId) : contexts.chosenContext;
    if (!target || target.error || core.state !== "ready") return;
    setError("");
    namespaces.setNamespace("");
    contexts.setContextChoice(target.id);
    contexts.setContextId(target.id);
    contexts.setView("workbench");
    localStorage.setItem("aster.lastContext", target.id);
  }, [contexts, core.state, namespaces]);

  const showContextPicker = useCallback(() => {
    contexts.setContextChoice(contextId);
    contexts.setContextQuery("");
    contexts.setContextId("");
    namespaces.setNamespace("");
    resources.setQuery("");
    detail.clear();
    resources.reset();
    helm.clear();
    setOverviewActive(false);
    setHelmActive(false);
    contexts.setView("contexts");
  }, [contexts, contextId, namespaces, resources, detail, helm]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (contexts.view === "workbench") setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (!paletteOpen) searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (paletteOpen) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          active.blur();
          return;
        }
        if (detail.selected) detail.clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, paletteOpen, contexts.view]);

  const paletteItems = useMemo(() => buildCommandItems({
    coreReady: core.state === "ready",
    contexts: contexts.contexts,
    activeContextId: contextId,
    resourceGroups,
    activeKindId: kind.id,
    namespaces: namespaces.namespaces,
    activeNamespace: namespaces.namespace,
    theme,
  }), [core.state, contexts.contexts, contextId, resourceGroups, kind.id, namespaces.namespaces, namespaces.namespace, theme]);

  const executePaletteCommand = useCallback((action: CommandAction) => {
    switch (action.type) {
      case "refresh":
        if (helmActive) helm.refresh();
        else if (overviewActive) overview.refresh();
        else resources.refresh();
        return;
      case "show-contexts":
        showContextPicker();
        return;
      case "connect-context":
        connectContext(action.contextId);
        return;
      case "select-namespace":
        namespaces.setNamespace(action.namespace);
        return;
      case "set-theme":
        setTheme(action.theme);
        return;
      case "select-kind": {
        const next = findKindInGroups(resourceGroups, action.kindId);
        if (!next) return;
        selectKind(next);
        return;
      }
      case "open-resource":
        openResource(action);
    }
  }, [overview, overviewActive, helm, helmActive, resources, showContextPicker, connectContext, namespaces, setTheme, resourceGroups, selectKind, openResource]);

  useEffect(() => desktop.app.onCommand((command) => {
    if (command === "show-contexts") {
      showContextPicker();
      return;
    }
    if (command === "focus-filter") {
      if (!overviewActive && !helmActive) searchRef.current?.focus();
      return;
    }
    if (command === "refresh" && contexts.view === "workbench") {
      if (helmActive) helm.refresh();
      else if (overviewActive) overview.refresh();
      else resources.refresh();
      return;
    }
    if (command === "go-back") {
      if (helmActive && helm.selected) helm.clear();
      else if (detail.selected) detail.clear();
    }
  }), [detail, showContextPicker, contexts.view, resources, overview, overviewActive, helm, helmActive]);

  const searchItems = useMemo(() => searchResultItems(searchResults, paletteQuery), [searchResults, paletteQuery]);

  useEffect(() => {
    void desktop.settings.get().then(setSettings).catch(() => setSettings({ kubeconfigSources: [], includeStandardChain: true }));
    void desktop.app.version().then(setAppVersion).catch(() => undefined);
  }, []);

  if (contexts.view === "settings") {
    return (
      <>
      <SettingsPage
        settings={settings}
        theme={theme}
        effectiveTheme={effectiveTheme}
        palette={palette}
        onThemeChange={setTheme}
        onPaletteChange={setPalette}
        appVersion={appVersion}
        core={core}
        sources={sourcesReport}
        onRefreshSources={reloadSources}
        onApply={async (sources, includeStandardChain) => {
          await desktop.settings.applyKubeconfigSources(sources, includeStandardChain);
          setSettings({ kubeconfigSources: sources, includeStandardChain });
          await reloadSources();
        }}
        onPickFile={() => desktop.settings.pickKubeconfigFile()}
        onPickFolder={() => desktop.settings.pickKubeconfigFolder()}
        onCheckUpdates={checkForUpdates}
        onOpenExternal={(url) => void desktop.app.openExternal(url)}
        onBack={() => contexts.setView(contexts.settingsFrom)}
      />
      {updateCard && <UpdateNotice card={updateCard} />}
      </>
    );
  }

  if (contexts.view === "contexts") {
    return (
      <>
      <ContextPicker
        core={core}
        contexts={contexts.visibleContexts}
        totalContexts={contexts.contexts.length}
        selectedId={contexts.contextChoice}
        query={contexts.contextQuery}
        layout={contexts.contextLayout}
        loading={contexts.contextsLoading}
        error={contexts.contextsError}
        onQueryChange={contexts.setContextQuery}
        onLayoutChange={contexts.setContextLayout}
        onSelect={contexts.setContextChoice}
        onRefresh={() => void contexts.loadContexts()}
        onConnect={connectContext}
        onOpenSettings={() => {
          contexts.setSettingsFrom(contexts.view);
          contexts.setView("settings");
        }}
      />
      {updateCard && <UpdateNotice card={updateCard} />}
      </>
    );
  }

  return (
    <WorkbenchShell
      sidebar={(
        <Sidebar
          context={contexts.activeContext}
          resourceGroups={resourceGroups}
          activeKind={kind}
          onSelectKind={selectKind}
          overviewActive={overviewActive}
          onSelectOverview={showOverview}
          toolGroups={helmToolGroups}
          activeToolId={helmActive ? "helm" : undefined}
          onSelectTool={(toolId) => {
            if (toolId === "helm") showHelm();
          }}
          onShowContexts={showContextPicker}
        />
      )}
      toolbar={(
        <UnifiedToolbar
          namespaces={namespaces.namespaces}
          namespace={namespaces.namespace}
          onNamespaceChange={namespaces.setNamespace}
          namespaceDisabled={overviewActive || (!helmActive && !kind.namespaced) || !namespaces.namespaces.length}
          query={helmActive || overviewActive ? "" : resources.query}
          onQueryChange={helmActive || overviewActive ? () => undefined : resources.setQuery}
          queryInputRef={searchRef}
          refreshing={helmActive ? helm.loading : overviewActive ? overview.loading : resources.loading}
          onRefresh={helmActive ? helm.refresh : overviewActive ? overview.refresh : resources.refresh}
          theme={theme}
          onThemeChange={setTheme}
          onOpenSettings={() => {
            contexts.setSettingsFrom("workbench");
            contexts.setView("settings");
          }}
          canGoBack={helmActive ? Boolean(helm.selected) : Boolean(detail.selected)}
          onBack={helmActive ? helm.clear : detail.clear}
        />
      )}
    >
      <div className="workbench">
          {overviewActive && (
            <OverviewView
              overview={overview.overview}
              loading={overview.loading}
              error={overview.error}
              contextName={contexts.activeContext?.name}
              onRefresh={overview.refresh}
              onNavigate={(kindId) => {
                const next = findKindInGroups(resourceGroups, kindId);
                if (next) selectKind(next);
              }}
            />
          )}
          {helmActive && (
            <HelmView
              contextName={contexts.activeContext?.name}
              namespace={namespaces.namespace}
              releases={helm.releases}
              loading={helm.loading}
              error={helm.error}
              selected={helm.selected}
              detailLoading={helm.detailLoading}
              detailError={helm.detailError}
              busy={helm.busy}
              message={helm.message}
              onRefresh={helm.refresh}
              onSelect={(name) => void helm.select(name)}
              onBack={helm.clear}
              onUninstall={(name) => void helm.uninstall(name)}
              onRollback={(name, revision) => void helm.rollback(name, revision)}
            />
          )}
          <section className="resource-pane" aria-label={`${kind.kind} resources`} hidden={overviewActive || helmActive || Boolean(detail.selected)}>
            <div className="pane-heading">
              <div>
                <h1>{pluralize(kind.kind)}</h1>
                <p>{kind.category} · {contexts.activeContext?.name || "Kubernetes"}</p>
              </div>
              <div className="resource-summary">
                {checkedRows.length > 0 && (
                  <>
                    <span className="selection-count" data-testid="selection-count">{checkedRows.length} selected</span>
                    <button className="load-more" data-testid="clear-selection" onClick={() => setCheckedKeys(new Set())}>
                      Clear
                    </button>
                    {mutation.canCreate && (
                      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
                        <AlertDialogTrigger render={<Button variant="destructive" size="sm" data-testid="delete-selected" />}>
                          Delete
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {checkedRows.length} {pluralize(kind.kind)}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently deletes the selected resources from {contexts.activeContext?.name || "the cluster"}. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel render={<Button variant="outline" size="sm" />}>
                              Cancel
                            </AlertDialogCancel>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={bulkBusy}
                              onClick={() => void deleteCheckedRows()}
                              data-testid="confirm-delete-selected"
                            >
                              {bulkBusy ? "Deleting…" : "Delete"}
                            </Button>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </>
                )}
                <span>{resources.visibleRows.length} loaded</span>
                {contexts.activeContext && <span className="cluster-name">{contexts.activeContext.cluster}</span>}
                <Button
                  variant="default"
                  size="default"
                  data-testid="new-resource"
                  disabled={!mutation.canCreate}
                  onClick={() => setCreateOpen(true)}
                >
                  New
                </Button>
              </div>
            </div>

            <ResourceTable
              rows={resources.visibleRows}
              selected={detail.selected}
              checkedRows={checkedKeys}
              onToggleRow={toggleRowChecked}
              onToggleAll={toggleAllChecked}
              hasMore={Boolean(resources.list.continueToken)}
              loadingMore={resources.loadingMore}
              onLoadMore={() => void resources.loadMore()}
              loading={resources.loading}
              error={error}
              onSelect={detail.select}
            />
          </section>

          {detail.selected && !overviewActive && !helmActive && (
            <Suspense fallback={<TableState icon={LoaderCircle} title="Opening resource" detail="Loading the resource workspace." spinning />}>
              <ResourceDetailView
              contextId={contextId}
              coreReady={core.state === "ready"}
              row={detail.selected}
              detail={detail.detail}
              detailError={detail.detailError}
              canMutate={mutation.canMutate}
              mutationBusy={mutation.mutationBusy}
              mutationMessage={mutation.mutationMessage}
              mutationPreview={mutation.mutationPreview}
              pendingMutation={mutation.pendingMutation}
              journal={mutation.journal}
              events={diagnostics.events}
              related={diagnostics.related}
              onMutate={mutation.mutate}
              onApplyMutation={mutation.applyPendingMutation}
              onCancelMutation={mutation.cancelMutation}
              onNavigateRelated={openResource}
              onBack={detail.clear}
              />
            </Suspense>
          )}
      </div>
      {updateCard && <UpdateNotice card={updateCard} />}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          if (!open) setPaletteQuery("");
        }}
        items={[...searchItems, ...paletteItems]}
        onExecute={executePaletteCommand}
        onQueryChange={setPaletteQuery}
      />
      {createOpen && (
        <Suspense fallback={null}>
          <CreateResourceDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            kind={kind}
            namespace={namespaces.namespace}
            busy={mutation.mutationBusy}
            message={mutation.mutationMessage}
            preview={mutation.mutationPreview}
            pendingMutation={mutation.pendingMutation}
            onPrepare={(yaml) => mutation.mutate({ operation: "create", yaml })}
            onApply={mutation.applyPendingMutation}
            onCancel={mutation.cancelMutation}
          />
        </Suspense>
      )}
    </WorkbenchShell>
  );
}
