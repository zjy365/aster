// SPDX-License-Identifier: Apache-2.0
import {
  ArrowLeft,
  Asterisk,
  AtSign,
  Boxes,
  FilePlus2,
  FolderOpen,
  Info,
  LoaderCircle,
  Moon,
  Settings,
  Star,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BUILT_IN_THEMES,
  getThemeDefinition,
  themeOrbBackground,
  themeWireframeColors,
  type ThemeWireframeColors,
} from "../../shared/themes";
import type { EffectiveTheme } from "../hooks/useTheme";
import type {
  AppearanceTheme,
  AsterSettings,
  CoreStatus,
  SourceReport,
  SourcesReport,
  UpdaterSnapshot,
} from "../../shared/types";

export interface SettingsPageProps {
  settings: AsterSettings;
  theme: AppearanceTheme;
  effectiveTheme: EffectiveTheme;
  palette: string;
  onThemeChange(theme: AppearanceTheme): void;
  onPaletteChange(palette: string): void;
  appVersion: string;
  core: CoreStatus;
  sources: SourcesReport;
  /** Re-fetches the core's per-source report (e.g. after an apply restart). */
  onRefreshSources(): Promise<void>;
  /** Applies the given source list and chain flag, then restarts the core. */
  onApply(sources: string[], includeStandardChain: boolean): Promise<void>;
  onPickFile(): Promise<string | null>;
  onPickFolder(): Promise<string | null>;
  onCheckUpdates(): Promise<UpdaterSnapshot>;
  /** Opens an external URL in the system browser via the shell. */
  onOpenExternal(url: string): void;
  onBack(): void;
}

type Section = "general" | "kubeconfig" | "about";

const SECTION_TITLES: Record<Section, string> = {
  general: "Appearance",
  kubeconfig: "Kubeconfig",
  about: "About",
};

/** Community links pinned at the bottom of the settings sidebar. */
const COMMUNITY_LINKS: { label: string; url: string; icon: typeof Star }[] = [
  { label: "Star on GitHub", url: "https://github.com/zjy365", icon: Star },
  { label: "Follow on X", url: "https://x.com/zjy365", icon: AtSign },
];

const THEME_OPTIONS: { value: AppearanceTheme; label: string }[] = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Settings as a full-page, System-Settings-style layout: a sidebar flush to
 * the window's left edge carries the Aster brand on top (the workbench
 * deliberately omits branding, so this is where the logo lives) above the
 * three section entries; the right column renders the active section on a
 * readable fixed-width column. The kubeconfig section keeps its contract —
 * the standard chain (default ~/.kube/config plus $KUBECONFIG) is a default,
 * not a privilege: the user can turn it off, and with no sources at all the
 * app simply has no clusters. User sources are path references only, files
 * are never copied or modified. Applying restarts the core and refreshes the
 * per-source report in place; the page stays open so the new counts are
 * visible.
 */
export function SettingsPage({
  settings,
  theme,
  effectiveTheme,
  palette,
  onThemeChange,
  onPaletteChange,
  appVersion,
  core,
  sources,
  onRefreshSources,
  onApply,
  onPickFile,
  onPickFolder,
  onCheckUpdates,
  onOpenExternal,
  onBack,
}: SettingsPageProps) {
  const [section, setSection] = useState<Section>("general");
  const [sourcePaths, setSourcePaths] = useState<string[]>(settings.kubeconfigSources);
  const [includeChain, setIncludeChain] = useState(settings.includeStandardChain);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [updateState, setUpdateState] = useState<{ phase: "idle" | "checking" | "done"; message?: string }>({
    phase: "idle",
  });

  // The page mounts fresh each time it becomes the view, so state starts from
  // the settings snapshot passed in, and the live per-source report is pulled
  // again — a previous apply restart has already taken effect by now.
  useEffect(() => {
    setSourcePaths(settings.kubeconfigSources);
    setIncludeChain(settings.includeStandardChain);
    setApplied(false);
    void onRefreshSources();
  }, [settings, onRefreshSources]);

  const dirty = !arrayEquals(sourcePaths, settings.kubeconfigSources) || includeChain !== settings.includeStandardChain;

  async function refreshSources() {
    setReportLoading(true);
    try {
      await onRefreshSources();
    } finally {
      setReportLoading(false);
    }
  }

  async function add(pick: () => Promise<string | null>) {
    const picked = await pick();
    if (picked && !sourcePaths.includes(picked)) setSourcePaths((current) => [...current, picked]);
  }

  function addPath() {
    const value = pathInput.trim();
    if (!value || sourcePaths.includes(value)) return;
    setSourcePaths((current) => [...current, value]);
    setPathInput("");
  }

  function revert() {
    setSourcePaths(settings.kubeconfigSources);
    setIncludeChain(settings.includeStandardChain);
    setPathInput("");
  }

  function apply() {
    setBusy(true);
    void onApply(sourcePaths, includeChain)
      .then(() => {
        setApplied(true);
        void refreshSources();
      })
      .finally(() => setBusy(false));
  }

  async function checkUpdates() {
    setUpdateState({ phase: "checking" });
    try {
      const snapshot = await onCheckUpdates();
      switch (snapshot.state) {
        case "available":
        case "downloading":
        case "downloaded":
          setUpdateState({ phase: "done", message: `Version ${snapshot.version} is available — use the update card to download it.` });
          break;
        case "not-available":
        case "idle":
          setUpdateState({ phase: "done", message: "Aster is up to date." });
          break;
        case "disabled":
          setUpdateState({ phase: "done", message: "Update checking is not available in this build." });
          break;
        default:
          setUpdateState({ phase: "done", message: "Update check failed. Try again later." });
      }
    } catch {
      setUpdateState({ phase: "done", message: "Update check failed. Try again later." });
    }
  }

  const configuredReports = sourcePaths.map((path) => ({
    path,
    report: sources.configured.find((item) => item.path === path),
  }));

  return (
    <div className="settings-page" data-testid="settings-page">
      <Tabs
        className="settings-shell"
        orientation="vertical"
        value={section}
        onValueChange={(value) => setSection(value as Section)}
      >
        <aside className="settings-sidebar" aria-label="Settings sections">
          <div className="settings-sidebar-titlebar" aria-hidden="true" data-tauri-drag-region />
          <div className="settings-brand">
            <span className="brand-mark" aria-hidden="true">
              <Asterisk size={19} strokeWidth={2.1} />
            </span>
            <strong>Aster</strong>
          </div>
          <TabsList className="settings-tab-list" variant="line">
            <TabsTrigger value="general" data-testid="settings-tab-general">
              <Settings aria-hidden="true" className="size-[15px]" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="kubeconfig" data-testid="settings-tab-kubeconfig">
              <Boxes aria-hidden="true" className="size-[15px]" />
              Kubeconfig
            </TabsTrigger>
            <TabsTrigger value="about" data-testid="settings-tab-about">
              <Info aria-hidden="true" className="size-[15px]" />
              About
            </TabsTrigger>
          </TabsList>
          <div className="settings-sidebar-bottom">
            <div className="settings-sidebar-links">
              {COMMUNITY_LINKS.map(({ label, url, icon: Icon }) => (
                <button
                  key={url}
                  type="button"
                  className="settings-sidebar-link"
                  onClick={() => onOpenExternal(url)}
                  data-testid={`settings-link-${label === "Star on GitHub" ? "github" : "x"}`}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {appVersion ? (
              <div className="settings-sidebar-footer">v{appVersion}</div>
            ) : null}
          </div>
        </aside>

        <div className="settings-content">
          <header className="settings-content-titlebar">
            <div className="titlebar-drag" aria-hidden="true" data-tauri-drag-region />
            <div className="settings-content-title-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="settings-page-back"
                onClick={onBack}
                data-testid="settings-back"
              >
                <ArrowLeft aria-hidden="true" />
                Choose a cluster
              </Button>
            </div>
          </header>

          <main className="settings-content-main">
            <div className="settings-content-column">
              <h1 className="settings-content-heading">{SECTION_TITLES[section]}</h1>

              <TabsContent value="general" className="settings-section">
                <p className="settings-section-intro">
                  Appearance is stored on this device and applied to every window.
                </p>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="appearance">Appearance</label>
                  <div className="settings-appearance-options" role="radiogroup" aria-label="Appearance" id="appearance">
                    {THEME_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className="settings-appearance-card"
                        data-active={theme === value || undefined}
                        role="radio"
                        aria-checked={theme === value}
                        onClick={() => onThemeChange(value)}
                        data-testid={`settings-theme-${value}`}
                      >
                        <span className="settings-appearance-preview" aria-hidden="true">
                          <AppearancePreview value={value} palette={palette} />
                        </span>
                        <span className="settings-appearance-label">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-field">
                  <span className="settings-field-label" id="settings-palette-label">Theme</span>
                  <div className="settings-palette-grid" role="radiogroup" aria-labelledby="settings-palette-label">
                    {BUILT_IN_THEMES.map((definition) => {
                      const active = palette === definition.id;
                      return (
                        <button
                          key={definition.id}
                          type="button"
                          className="settings-palette-card"
                          data-active={active || undefined}
                          role="radio"
                          aria-checked={active}
                          onClick={() => onPaletteChange(definition.id)}
                          data-testid={`settings-palette-${definition.id}`}
                        >
                          <span className="settings-palette-orbs" aria-hidden="true">
                            <span className="theme-orb-frame" data-mode-active={effectiveTheme === "light" || undefined}>
                              <span className="theme-orb" style={{ background: themeOrbBackground(definition.light, "light") }} />
                              {effectiveTheme === "light" && (
                                <span className="theme-orb-badge">
                                  <Sun size={12} />
                                </span>
                              )}
                            </span>
                            <span className="theme-orb-frame" data-mode-active={effectiveTheme === "dark" || undefined}>
                              <span className="theme-orb" style={{ background: themeOrbBackground(definition.dark, "dark") }} />
                              {effectiveTheme === "dark" && (
                                <span className="theme-orb-badge">
                                  <Moon size={12} />
                                </span>
                              )}
                            </span>
                          </span>
                          {definition.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="kubeconfig" className="settings-section">
                <p className="settings-section-intro">
                  Aster lists clusters from your kubeconfigs. The standard chain (~/.kube/config plus
                  $KUBECONFIG) is included by default but can be turned off; add more files or folders to
                  list their clusters too — applying restarts the local core.
                </p>

                <div className="settings-source-block">
                  <div className="settings-source-block-header">
                    <h3 className="settings-source-heading">Standard chain</h3>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={includeChain}
                      aria-label="Include the standard kubeconfig chain"
                      className="settings-switch"
                      disabled={busy}
                      onClick={() => setIncludeChain((current) => !current)}
                      data-testid="settings-chain-toggle"
                    >
                      <span className="settings-switch-thumb" aria-hidden="true" />
                    </button>
                  </div>
                  {includeChain ? (
                    <ul className="settings-source-list" data-testid="settings-chain-list">
                      {sources.chain.length === 0 && (
                        <li className="settings-source-empty">No kubeconfig found in the standard chain.</li>
                      )}
                      {sources.chain.map((report) => (
                        <SourceRow key={report.path} report={report} badge={report.default ? "Default" : "KUBECONFIG"} />
                      ))}
                    </ul>
                  ) : (
                    <p className="settings-chain-off" data-testid="settings-chain-off">
                      Standard chain off — ~/.kube/config and $KUBECONFIG are not consulted.
                    </p>
                  )}
                </div>

                <div className="settings-source-block">
                  <h3 className="settings-source-heading">Additional sources</h3>
                  <ul className="settings-source-list" data-testid="settings-source-list">
                    {configuredReports.length === 0 && (
                      <li className="settings-source-empty">
                        {includeChain
                          ? "No extra sources. All clusters come from the standard chain."
                          : "No sources at all — the app has no clusters until you add a file or turn the chain back on."}
                      </li>
                    )}
                    {configuredReports.map(({ path, report }) => (
                      <SourceRow
                        key={path}
                        path={path}
                        report={report}
                        badge={report?.inChain ? "In chain" : report?.kind === "directory" ? "Folder" : undefined}
                        loading={reportLoading && !report}
                        onRemove={() => setSourcePaths((current) => current.filter((item) => item !== path))}
                        removeDisabled={busy}
                      />
                    ))}
                  </ul>
                  <div className="settings-source-actions">
                    <Button variant="outline" disabled={busy} data-testid="settings-add-file" onClick={() => void add(onPickFile)}>
                      <FilePlus2 data-icon="inline-start" />
                      Add file…
                    </Button>
                    <Button variant="outline" disabled={busy} data-testid="settings-add-folder" onClick={() => void add(onPickFolder)}>
                      <FolderOpen data-icon="inline-start" />
                      Add folder…
                    </Button>
                    <form
                      className="settings-path-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        addPath();
                      }}
                    >
                      <input
                        className="settings-path-input"
                        value={pathInput}
                        onChange={(event) => setPathInput(event.target.value)}
                        placeholder="Or enter a path…"
                        aria-label="Kubeconfig path"
                        data-testid="settings-path-input"
                        spellCheck={false}
                      />
                      <Button type="submit" size="sm" disabled={!pathInput.trim() || busy}>
                        Add
                      </Button>
                    </form>
                  </div>
                </div>

                <div className="settings-section-footer">
                  {applied ? (
                    <span className="settings-applied" role="status" data-testid="settings-applied">
                      Applied — the local core is restarting.
                    </span>
                  ) : null}
                  <Button variant="outline" disabled={!dirty || busy} onClick={revert}>
                    Revert
                  </Button>
                  <Button disabled={!dirty || busy} data-testid="settings-apply" onClick={apply}>
                    Apply & restart core
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="about" className="settings-section settings-about">
                <div className="settings-about-hero">
                  <span className="settings-about-logo" aria-hidden="true">
                    <Asterisk size={30} strokeWidth={2.1} />
                  </span>
                  <h2 className="settings-about-name">Aster</h2>
                  <p className="settings-about-version" data-testid="settings-about-version">
                    Version {appVersion || "—"}
                  </p>
                </div>
                <div className="settings-about-card">
                  <div className="settings-about-row">
                    <span className="settings-about-label">Local core</span>
                    <span className="settings-core-state" data-state={core.state} role="status">
                      <span className="settings-core-dot" aria-hidden="true" />
                      {core.state === "ready" ? "Ready" : core.state === "starting" ? "Starting" : core.state === "error" ? "Error" : "Stopped"}
                    </span>
                  </div>
                  <div className="settings-about-row">
                    <span className="settings-about-label">Updates</span>
                    <span className="settings-update-control">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updateState.phase === "checking"}
                        onClick={() => void checkUpdates()}
                        data-testid="settings-check-updates"
                      >
                        {updateState.phase === "checking" ? (
                          <LoaderCircle className="spin" data-icon="inline-start" aria-hidden="true" />
                        ) : null}
                        {updateState.phase === "checking" ? "Checking…" : "Check for updates"}
                      </Button>
                      {updateState.message && (
                        <span className="settings-update-message" role="status" data-testid="settings-update-message">
                          {updateState.message}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </TabsContent>
            </div>
          </main>
        </div>
      </Tabs>
    </div>
  );
}

/**
 * Thumbnail of the Aster workbench (source list + resource table) rendered
 * from a palette's semantic colors, used for the appearance cards. The
 * system card splits into light/dark halves with a 1px seam so both sides of
 * the palette read at a glance.
 */
function AppearancePreview({ value, palette }: { value: AppearanceTheme; palette: string }) {
  const definition = getThemeDefinition(palette) ?? BUILT_IN_THEMES[0];
  if (value === "system") {
    return (
      <span className="settings-preview">
        <span className="settings-preview-pane settings-preview-pane-left" aria-hidden="true">
          <WorkbenchThumb colors={themeWireframeColors(definition.light)} />
        </span>
        <span className="settings-preview-pane settings-preview-pane-right" aria-hidden="true">
          <WorkbenchThumb colors={themeWireframeColors(definition.dark)} />
        </span>
      </span>
    );
  }
  const colors = themeWireframeColors(value === "dark" ? definition.dark : definition.light);
  return (
    <span className="settings-preview">
      <WorkbenchThumb colors={colors} />
    </span>
  );
}

function WorkbenchThumb({ colors }: { colors: ThemeWireframeColors }) {
  const line = "rgb(127 127 127 / 0.25)";
  return (
    <span className="workbench-thumb" aria-hidden="true">
      <span className="wt-canvas" style={{ background: colors.canvas }} />
      <span className="wt-sidebar" style={{ background: colors.sidebar, boxShadow: `inset -1px 0 0 ${line}` }}>
        <span className="wt-sidebar-item" style={{ background: colors.sidebarActive }} />
        <span className="wt-sidebar-item" style={{ background: line }} />
        <span className="wt-sidebar-item" style={{ background: line }} />
      </span>
      <span className="wt-toolbar" style={{ background: colors.toolbar, boxShadow: `inset 0 -1px 0 ${line}` }}>
        <span className="wt-toolbar-pill" style={{ background: colors.toolbarAction }} />
      </span>
      <span className="wt-row" style={{ background: colors.row, boxShadow: `inset 0 0 0 1px ${line}` }}>
        <span className="wt-row-key" style={{ background: colors.rowHighlight }} />
      </span>
      <span className="wt-row" style={{ background: colors.row, boxShadow: `inset 0 0 0 1px ${line}` }} />
      <span className="wt-row" style={{ background: colors.row, boxShadow: `inset 0 0 0 1px ${line}` }} />
    </span>
  );
}

function SourceRow({
  path,
  report,
  badge,
  loading,
  onRemove,
  removeDisabled,
}: {
  path?: string;
  report?: SourceReport;
  badge?: string;
  loading?: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const displayPath = path ?? report?.path ?? "";
  const meta = report?.error
    ? { text: report.error, error: true }
    : report?.kind === "directory"
      ? { text: `${report.files} file${report.files === 1 ? "" : "s"} · ${report.contexts} context${report.contexts === 1 ? "" : "s"}`, error: false }
      : report
        ? { text: `${report.contexts} context${report.contexts === 1 ? "" : "s"}`, error: false }
        : null;

  return (
    <li className="settings-source-item">
      <span className="settings-source-path" data-testid="settings-source-path" title={displayPath}>
        {displayPath}
      </span>
      {meta && (
        <span className={`settings-source-meta${meta.error ? " settings-source-error" : ""}`} role={meta.error ? "alert" : undefined}>
          {meta.text}
        </span>
      )}
      {loading && <LoaderCircle className="spin settings-source-meta" aria-hidden="true" />}
      {badge && <Badge variant="outline">{badge}</Badge>}
      {onRemove && (
        <Button
          aria-label={`Remove ${displayPath}`}
          data-testid="settings-source-remove"
          size="icon-sm"
          variant="ghost"
          disabled={removeDisabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
