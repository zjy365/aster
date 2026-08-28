import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardPaste,
  LayoutGrid,
  List as ListIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { AsterMark } from "../components/AsterMark";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { ContextHealthMap, ContextInfo, CoreStatus, RenameConflictRequest } from "../../shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContextLayout } from "../lib/context-picker";
import { PasteKubeconfigDialog } from "./PasteKubeconfigDialog";

interface ContextPickerProps {
  core: CoreStatus;
  contexts: ContextInfo[];
  totalContexts: number;
  selectedId: string;
  query: string;
  layout: ContextLayout;
  loading: boolean;
  error: string;
  /** Per-context reachability; a missing entry means unknown or still probing. */
  health: ContextHealthMap;
  healthProbing: boolean;
  onQueryChange(value: string): void;
  onLayoutChange(value: ContextLayout): void;
  onSelect(value: string): void;
  onRefresh(): void;
  onConnect(contextId?: string): void;
  onOpenSettings(): void;
  /**
   * Imports pasted kubeconfig content and applies it immediately (the empty
   * state has no settings page behind it), resolving to the stored path.
   */
  onPasteKubeconfig(name: string, content: string): Promise<string>;
  /** Renames a colliding entry inside its kubeconfig file, then reloads contexts. */
  onRenameConflict(request: RenameConflictRequest): Promise<void>;
}

function ContextPicker({
  core,
  contexts,
  totalContexts,
  selectedId,
  query,
  layout,
  loading,
  error,
  health,
  healthProbing,
  onQueryChange,
  onLayoutChange,
  onSelect,
  onRefresh,
  onConnect,
  onOpenSettings,
  onPasteKubeconfig,
  onRenameConflict,
}: ContextPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [conflictDialog, setConflictDialog] = useState<ContextInfo | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Key of the conflict row whose rename form is open: path|kind|name.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const selected = contexts.find((context) => context.id === selectedId);
  const firstSelectableId = contexts.find((context) => !context.error)?.id;
  const canConnect =
    core.state === "ready" && !loading && Boolean(selected) && !selected?.error;
  const coreLabel = {
    ready: "Core ready",
    starting: "Starting",
    error: "Error",
    stopped: "Stopped",
  }[core.state];

  function connect(context: ContextInfo) {
    if (core.state !== "ready" || loading || context.error) return;
    if (context.id !== selectedId) onSelect(context.id);
    onConnect(context.id);
  }

  function openConflictDialog(context: ContextInfo) {
    setRenaming(null);
    setRenameError("");
    setConflictDialog(context);
  }

  async function renameConflict(path: string, kind: "cluster" | "context", name: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) return;
    setRenameBusy(true);
    setRenameError("");
    try {
      await onRenameConflict({ path, kind, name, newName: trimmed });
      setConflictDialog(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenameBusy(false);
    }
  }

  function focusOption(edgeOrOffset: "first" | "last" | -1 | 1) {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-context-option]:not(:disabled)",
      ) ?? [],
    );
    if (!options.length) return;

    const currentIndex = options.findIndex(
      (option) => option.dataset.contextId === selectedId,
    );
    const nextIndex =
      edgeOrOffset === "first"
        ? 0
        : edgeOrOffset === "last"
          ? options.length - 1
          : Math.max(
              0,
              Math.min(
                options.length - 1,
                (currentIndex < 0 ? 0 : currentIndex) + edgeOrOffset,
              ),
            );
    const next = options[nextIndex];
    const nextId = next.dataset.contextId;
    next.focus();
    if (nextId) onSelect(nextId);
  }

  function handleOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    context: ContextInfo,
  ) {
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        connect(context);
        break;
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusOption(1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusOption(-1);
        break;
      case "Home":
        event.preventDefault();
        focusOption("first");
        break;
      case "End":
        event.preventDefault();
        focusOption("last");
        break;
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption("first");
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      connect(selected);
    }
  }

  return (
    <div className="context-picker" data-testid="context-picker">
      <header className="context-picker-titlebar">
        <div className="titlebar-drag" aria-hidden="true" data-tauri-drag-region />
        <div className="context-picker-title-actions">
          <div
            className="context-picker-core-status"
            data-state={core.state}
            role="status"
            aria-live="polite"
            title={core.message || `Core ${core.state}`}
          >
            {core.state === "ready" ? (
              <CheckCircle2 aria-hidden="true" />
            ) : core.state === "starting" ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <AlertCircle aria-hidden="true" />
            )}
            <span>{coreLabel}</span>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  className="context-picker-theme-toggle"
                  variant="ghost"
                  size="icon"
                  aria-label="Settings"
                  onClick={onOpenSettings}
                  data-testid="context-picker-settings"
                />
              }
            >
              <Settings aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="context-picker-main">
        <section
          className="context-picker-panel"
          aria-labelledby="context-picker-heading"
        >
          <div className="context-picker-heading">
            <div className="context-picker-brand" aria-hidden="true">
              <span className="brand-mark">
                <AsterMark size={25} />
              </span>
              <strong>Aster</strong>
            </div>
            <h1 id="context-picker-heading">Choose a cluster</h1>
            <p>Select a Kubernetes context to open its resource workbench.</p>
          </div>

          <div
            className="context-picker-toolbar"
            role="group"
            aria-label="Cluster controls"
          >
            <label className="context-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search contexts"
                aria-label="Search contexts"
                autoComplete="off"
                data-testid="context-picker-search"
              />
            </label>

            <div
              className="context-layout-toggle"
              role="group"
              aria-label="Context layout"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      className="context-layout-button"
                      variant={layout === "grid" ? "secondary" : "ghost"}
                      size="icon"
                      aria-label="Grid view"
                      aria-pressed={layout === "grid"}
                      onClick={() => onLayoutChange("grid")}
                      data-testid="context-layout-grid"
                    />
                  }
                >
                  <LayoutGrid aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Grid view</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      className="context-layout-button"
                      variant={layout === "list" ? "secondary" : "ghost"}
                      size="icon"
                      aria-label="List view"
                      aria-pressed={layout === "list"}
                      onClick={() => onLayoutChange("list")}
                      data-testid="context-layout-list"
                    />
                  }
                >
                  <ListIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>List view</TooltipContent>
              </Tooltip>
            </div>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    className="context-refresh-button"
                    variant="ghost"
                    size="icon"
                    aria-label={loading ? "Refreshing contexts" : "Refresh contexts"}
                    disabled={loading}
                    onClick={onRefresh}
                    data-testid="context-picker-refresh"
                  />
                }
              >
                <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                {loading ? "Refreshing contexts" : "Refresh contexts"}
              </TooltipContent>
            </Tooltip>
          </div>

          <div
            ref={listRef}
            className={`context-list context-list-${layout}`}
            data-layout={layout}
            data-testid="context-picker-list"
            aria-live="polite"
            aria-busy={loading}
            role="listbox"
            aria-label="Kubernetes contexts"
          >
            {core.state === "starting" || (loading && totalContexts === 0) ? (
              <ContextState
                kind="loading"
                icon={<LoaderCircle className="spin" aria-hidden="true" />}
                title={
                  core.state === "starting"
                    ? "Starting local core"
                    : "Reading kubeconfig"
                }
                description={
                  core.state === "starting"
                    ? "Preparing the secure local Kubernetes connection."
                    : "Discovering local Kubernetes contexts."
                }
              />
            ) : core.state === "error" || core.state === "stopped" ? (
              <ContextState
                kind="core-error"
                tone="error"
                icon={<AlertCircle aria-hidden="true" />}
                title="Local core is unavailable"
                description={core.message || `Core ${core.state}`}
              />
            ) : error ? (
              <ContextState
                kind="load-error"
                tone="error"
                icon={<AlertCircle aria-hidden="true" />}
                title="Could not load contexts"
                description={error}
                action={
                  <Button type="button" variant="outline" onClick={onRefresh}>
                    Try again
                  </Button>
                }
              />
            ) : contexts.length ? (
              contexts.map((context) => {
                const isSelected = context.id === selectedId;
                const isTabStop = isSelected || (!selected && context.id === firstSelectableId);
                const hasConflicts = Boolean(context.conflicts?.length);
                const healthEntry = health[context.id];
                // Static config errors already render below the name; the dot
                // is only for dialable contexts. A missing entry is "checking"
                // while a probe round runs, otherwise the row shows nothing.
                const healthState = context.error
                  ? null
                  : healthEntry
                    ? healthEntry.status
                    : healthProbing
                      ? "checking"
                      : null;
                const healthLabel =
                  healthState === "ok"
                    ? `Reachable${healthEntry?.version ? ` · ${healthEntry.version}` : ""}${
                        healthEntry?.latencyMs != null ? ` · ${healthEntry.latencyMs} ms` : ""
                      }`
                    : healthState === "error"
                      ? `Unreachable${healthEntry?.message ? `: ${healthEntry.message}` : ""}`
                      : "Checking reachability…";

                return (
                  <Button
                    type="button"
                    className="context-card"
                    variant="ghost"
                    role="option"
                    aria-selected={isSelected}
                    disabled={Boolean(context.error)}
                    tabIndex={isTabStop ? 0 : -1}
                    data-context-option
                    data-context-id={context.id}
                    data-selected={isSelected || undefined}
                    data-current={isSelected || undefined}
                    data-testid={`context-option-${context.id}`}
                    onClick={() => onSelect(context.id)}
                    onDoubleClick={() => connect(context)}
                    onKeyDown={(event) => handleOptionKeyDown(event, context)}
                  >
                    <span className="context-card-icon">
                      <span className="kubernetes-mark" aria-hidden="true">
                        <Boxes />
                      </span>
                      {healthState && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span
                                className="context-health"
                                data-state={healthState}
                                data-testid={`context-health-${context.id}`}
                                aria-label={healthLabel}
                                onClick={(event) => event.stopPropagation()}
                                onDoubleClick={(event) => event.stopPropagation()}
                              />
                            }
                          >
                            <span className="context-health-dot" aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent className="block max-w-sm leading-relaxed break-all">
                            {healthLabel}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                    <span className="context-card-copy">
                      <strong>{context.name}</strong>
                      <span className="context-card-sub">
                        <span className="context-card-cluster">
                          {context.cluster || "Kubernetes cluster"}
                        </span>
                        {hasConflicts && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  className="context-conflict-warning"
                                  data-testid={`context-conflict-${context.id}`}
                                  aria-label="Show conflict details"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openConflictDialog(context);
                                  }}
                                  onDoubleClick={(event) => event.stopPropagation()}
                                />
                              }
                            >
                              <AlertTriangle aria-hidden="true" />
                              <span>
                                {context.conflicts!.length}{" "}
                                {context.conflicts!.length === 1 ? "other source" : "other sources"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="block max-w-sm leading-relaxed break-all">
                              This name is defined by {context.conflicts!.length + 1} sources.
                              Connecting to <strong>{context.server || context.cluster}</strong>{" "}
                              from <strong>{context.source || "an unknown source"}</strong>. Click
                              the warning for details and fixes.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                      {context.error && <small>{context.error}</small>}
                    </span>
                    {isSelected && (
                      <span className="current-context-badge">Current</span>
                    )}
                    <span className="context-selected-indicator" aria-hidden="true">
                      <CheckCircle2 />
                    </span>
                  </Button>
                );
              })
            ) : (
              <ContextState
                kind="empty"
                icon={<Search aria-hidden="true" />}
                title={totalContexts ? "No matching contexts" : "No contexts found"}
                description={
                  totalContexts
                    ? "Try another name or cluster."
                    : "Paste a kubeconfig to import its clusters, or add a file in Settings."
                }
                action={
                  totalContexts ? undefined : (
                    <>
                      <Button
                        type="button"
                        data-testid="context-picker-empty-paste"
                        onClick={() => setPasteOpen(true)}
                      >
                        <ClipboardPaste data-icon="inline-start" aria-hidden="true" />
                        Paste kubeconfig
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={onOpenSettings}
                        data-testid="context-picker-empty-settings"
                      >
                        <Settings data-icon="inline-start" aria-hidden="true" />
                        Open Settings
                      </Button>
                    </>
                  )
                }
              />
            )}
          </div>

          <footer className="context-picker-footer">
            <span className="context-picker-selection" role="status" aria-live="polite">
              {selected ? (
                <>
                  <strong>{selected.name}</strong> selected
                </>
              ) : (
                `${totalContexts} context${totalContexts === 1 ? "" : "s"} available`
              )}
            </span>
            <Button
              type="button"
              className="connect-context"
              size="lg"
              disabled={!canConnect}
              onClick={() => selected && connect(selected)}
              data-testid="context-picker-connect"
            >
              Connect
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </footer>
        </section>
      </main>

      <PasteKubeconfigDialog open={pasteOpen} onOpenChange={setPasteOpen} onImport={onPasteKubeconfig} />

      <Dialog
        open={Boolean(conflictDialog)}
        onOpenChange={(open) => {
          if (!open) setConflictDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md" data-testid="context-conflict-dialog">
          <DialogHeader>
            <DialogTitle>Kubeconfig name conflict</DialogTitle>
            <DialogDescription>
              <strong>{conflictDialog?.name}</strong> is defined by{" "}
              {(conflictDialog?.conflicts?.length ?? 0) + 1} sources. Aster connects to{" "}
              <strong>{conflictDialog?.server || conflictDialog?.cluster}</strong> from{" "}
              <strong>{conflictDialog?.source || "an unknown source"}</strong>; the definitions
              below disagree, so the first one silently wins.
            </DialogDescription>
          </DialogHeader>
          <div className="context-conflict-files">
            {conflictDialog?.conflicts?.map((conflict) => {
              const key = `${conflict.path}|${conflict.kind}|${conflict.name}`;
              return (
                <div className="context-conflict-file" key={key}>
                  <div className="context-conflict-entry">
                    <span className="context-conflict-name">
                      {conflict.kind} <strong>{conflict.name}</strong>
                    </span>
                    <span className="context-conflict-path" title={conflict.path}>
                      {conflict.path}
                    </span>
                  </div>
                  {renaming === key ? (
                    <form
                      className="context-conflict-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameConflict(conflict.path, conflict.kind, conflict.name);
                      }}
                    >
                      <input
                        className="context-conflict-input"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        aria-label="New name"
                        data-testid="context-conflict-input"
                        spellCheck={false}
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={renameBusy || !newName.trim() || newName.trim() === conflict.name}
                        data-testid="context-conflict-rename-apply"
                      >
                        {renameBusy ? "Renaming…" : "Rename"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={renameBusy}
                        onClick={() => setRenaming(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRenaming(key);
                        setNewName(conflict.suggestion);
                        setRenameError("");
                      }}
                      data-testid="context-conflict-rename"
                    >
                      Rename in file
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {renameError && <p className="context-conflict-error" role="alert">{renameError}</p>}
          <p className="context-conflict-note">
            Renaming edits the file in place and updates every reference to the entry; the
            original is preserved next to it as a .aster.bak file.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConflictDialog(null)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConflictDialog(null);
                onOpenSettings();
              }}
            >
              Open Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContextState({
  kind,
  tone,
  icon,
  title,
  description,
  action,
}: {
  kind: "loading" | "core-error" | "load-error" | "empty";
  tone?: "error";
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty
      className="context-picker-state"
      data-state={kind}
      data-tone={tone}
      data-testid={`context-picker-${kind}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export { ContextPicker };
export type { ContextPickerProps };
