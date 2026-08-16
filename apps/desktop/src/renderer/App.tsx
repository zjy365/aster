import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { AsterSettings, RelatedResource, ResourceKind } from "../shared/types";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateNotice } from "./components/UpdateNotice";
import { ResourceTable, TableState } from "./components/ResourceTable";
import { useContexts } from "./hooks/useContexts";
import { useCoreStatus } from "./hooks/useCoreStatus";
import { useDiagnostics } from "./hooks/useDiagnostics";
import { useDiscovery } from "./hooks/useDiscovery";
import { useMutation } from "./hooks/useMutation";
import { useNamespaces } from "./hooks/useNamespaces";
import { useResourceDetail } from "./hooks/useResourceDetail";
import { useResourceList } from "./hooks/useResourceList";
import { useTheme } from "./hooks/useTheme";
import { useUpdater } from "./hooks/useUpdater";
import { useWritePolicy } from "./hooks/useWritePolicy";
import { buildCommandItems, searchResultItems, type CommandAction } from "./lib/command-palette";
import { pluralize } from "./lib/format";
import { customResourceGroups, DEFAULT_KIND, findKindInGroups, flattenResourceGroups, SIDEBAR_RESOURCE_GROUPS } from "./lib/resource-catalog";
import { Sidebar } from "./shell/Sidebar";
import { UnifiedToolbar } from "./shell/UnifiedToolbar";
import { WorkbenchShell } from "./shell/WorkbenchShell";
import { ContextPicker } from "./views/ContextPicker";
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
  const { theme, setTheme, cycleTheme } = useTheme();
  const contexts = useContexts(core);
  const { contextId } = contexts;
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ResourceKind>(DEFAULT_KIND);
  const namespaces = useNamespaces(contextId, contexts.contexts, setError);
  const policy = useWritePolicy(contextId, setError);
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
    execAllowed: !policy.readOnly && policy.writePolicySynced,
  });
  const mutation = useMutation({
    contextId,
    kind,
    namespace: namespaces.namespace,
    selected: detail.selected,
    readOnly: policy.readOnly,
    writePolicySynced: policy.writePolicySynced,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AsterSettings>({ kubeconfigSources: [] });
  const discovered = useDiscovery(contextId, core.state === "ready");
  const resourceGroups = useMemo(() => {
    const custom = customResourceGroups(discovered);
    return custom.length ? [...SIDEBAR_RESOURCE_GROUPS, ...custom] : SIDEBAR_RESOURCE_GROUPS;
  }, [discovered]);
  const [pendingSelect, setPendingSelect] = useState<{ name: string; namespace: string }>();
  const [paletteQuery, setPaletteQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RelatedResource[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("aster.sidebar.collapsed") === "true");
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((value) => {
      const next = !value;
      localStorage.setItem("aster.sidebar.collapsed", String(next));
      return next;
    });
  }, []);

  // Shared navigation for related resources and palette search results:
  // switch kind/namespace, then select the row once its list page arrives.
  const openResource = useCallback((target: { group: string; version: string; resource: string; name: string; namespace?: string }) => {
    const match = flattenResourceGroups(resourceGroups)
      .find((item) => item.group === target.group && item.version === target.version && item.resource === target.resource && item.enabled !== false);
    if (!match) return;
    const { icon: _icon, label: _label, enabled: _enabled, pinned: _pinned, ...nextKind } = match;
    const namespace = target.namespace || "";
    if (namespace !== namespaces.namespace) namespaces.setNamespace(namespace);
    setPendingSelect({ name: target.name, namespace });
    if (nextKind.id !== kind.id) setKind(nextKind);
  }, [resourceGroups, namespaces, kind.id]);

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
    contexts.setView("contexts");
  }, [contexts, contextId, namespaces, resources, detail]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (contexts.view === "workbench") setPaletteOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (contexts.view === "workbench") toggleSidebarCollapsed();
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
  }, [detail, paletteOpen, contexts.view, toggleSidebarCollapsed]);

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
        resources.refresh();
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
        if (next.id === kind.id) {
          detail.clear();
          return;
        }
        setKind(next);
        return;
      }
      case "open-resource":
        openResource(action);
    }
  }, [resources, showContextPicker, connectContext, namespaces, setTheme, resourceGroups, kind.id, detail, openResource]);

  useEffect(() => desktop.app.onCommand((command) => {
    if (command === "show-contexts") {
      showContextPicker();
      return;
    }
    if (command === "focus-filter") {
      searchRef.current?.focus();
      return;
    }
    if (command === "refresh" && contexts.view === "workbench") {
      resources.refresh();
      return;
    }
    if (command === "go-back" && detail.selected) {
      detail.clear();
    }
  }), [detail, showContextPicker, contexts.view, resources]);

  const searchItems = useMemo(() => searchResultItems(searchResults, paletteQuery), [searchResults, paletteQuery]);

  useEffect(() => {
    void desktop.settings.get().then(setSettings).catch(() => setSettings({ kubeconfigSources: [] }));
  }, []);

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
        theme={theme}
        onQueryChange={contexts.setContextQuery}
        onLayoutChange={contexts.setContextLayout}
        onSelect={contexts.setContextChoice}
        onRefresh={() => void contexts.loadContexts()}
        onConnect={connectContext}
        onToggleTheme={cycleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onApply={async (sources) => {
          await desktop.settings.applyKubeconfigSources(sources);
          setSettings({ kubeconfigSources: sources });
        }}
        onPickFile={() => desktop.settings.pickKubeconfigFile()}
        onPickFolder={() => desktop.settings.pickKubeconfigFolder()}
      />
      {updateCard && <UpdateNotice card={updateCard} />}
      </>
    );
  }

  return (
    <WorkbenchShell
      className={sidebarCollapsed ? "sidebar-rail" : undefined}
      sidebar={(
        <Sidebar
          context={contexts.activeContext}
          coreState={core.state}
          resourceGroups={resourceGroups}
          activeKind={kind}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
          onSelectKind={(next) => {
            if (next.id === kind.id) {
              detail.clear();
              return;
            }
            setKind(next);
          }}
          onShowContexts={showContextPicker}
        />
      )}
      toolbar={(
        <UnifiedToolbar
          namespaces={namespaces.namespaces}
          namespace={namespaces.namespace}
          onNamespaceChange={namespaces.setNamespace}
          namespaceDisabled={!kind.namespaced || !namespaces.namespaces.length}
          query={resources.query}
          onQueryChange={resources.setQuery}
          queryInputRef={searchRef}
          readOnly={policy.readOnly}
          onToggleReadOnly={policy.toggleReadOnly}
          readOnlyDisabled={!policy.writePolicySynced}
          refreshing={resources.loading}
          onRefresh={resources.refresh}
          theme={theme}
          onThemeChange={setTheme}
          canGoBack={Boolean(detail.selected)}
          onBack={detail.clear}
        />
      )}
    >
      <div className="workbench">
          <section className="resource-pane" aria-label={`${kind.kind} resources`} hidden={Boolean(detail.selected)}>
            <div className="pane-heading">
              <div>
                <h1>{pluralize(kind.kind)}</h1>
                <p>{kind.category} · {contexts.activeContext?.name || "Kubernetes"}</p>
              </div>
              <div className="resource-summary">
                <span>{resources.visibleRows.length} loaded</span>
                {contexts.activeContext && <span className="cluster-name">{contexts.activeContext.cluster}</span>}
                <button
                  className="load-more new-resource"
                  data-testid="new-resource"
                  disabled={!mutation.canCreate}
                  onClick={() => setCreateOpen(true)}
                >
                  New
                </button>
              </div>
            </div>

            <ResourceTable
              rows={resources.visibleRows}
              selected={detail.selected}
              loading={resources.loading}
              error={error}
              onSelect={detail.select}
            />

            <footer className="table-footer">
              <span>{resources.list.resourceVersion ? `Resource version ${resources.list.resourceVersion}` : "Direct Kubernetes API"}</span>
              {resources.list.continueToken && (
                <button className="load-more" onClick={() => void resources.loadMore()} disabled={resources.loadingMore}>
                  {resources.loadingMore && <LoaderCircle className="spin" size={14} />}
                  Load next 100
                </button>
              )}
            </footer>
          </section>

          {detail.selected && (
            <Suspense fallback={<TableState icon={LoaderCircle} title="Opening resource" detail="Loading the resource workspace." spinning />}>
              <ResourceDetailView
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
              logs={diagnostics.logs}
              following={diagnostics.following}
              followLines={diagnostics.followLines}
              podMetric={diagnostics.podMetric}
              portForward={diagnostics.portForward}
              portForwardMessage={diagnostics.portForwardMessage}
              execResult={diagnostics.execResult}
              onToggleFollow={diagnostics.toggleFollow}
              onStartPortForward={diagnostics.startPortForward}
              onStopPortForward={diagnostics.stopPortForward}
              onExec={diagnostics.runExec}
              onMutate={mutation.mutate}
              onApplyMutation={mutation.applyPendingMutation}
              onCancelMutation={mutation.cancelMutation}
              onNavigateRelated={openResource}
              canExec={!policy.readOnly && policy.writePolicySynced}
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onApply={async (sources) => {
          await desktop.settings.applyKubeconfigSources(sources);
          setSettings({ kubeconfigSources: sources });
        }}
        onPickFile={() => desktop.settings.pickKubeconfigFile()}
        onPickFolder={() => desktop.settings.pickKubeconfigFolder()}
      />
    </WorkbenchShell>
  );
}
