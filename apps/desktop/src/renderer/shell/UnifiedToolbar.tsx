import type { Ref } from "react";
import { useMemo, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Command,
  LoaderCircle,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  SunMoon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NamespaceInfo, NamespaceScope } from "../../shared/types";
import { searchNamespaces } from "../lib/namespace-search";
import { MAX_NAMESPACE_SELECTION, namespaceScopeSummary, toggleNamespace } from "../lib/namespace-scope";

export type AppearanceTheme = "system" | "light" | "dark";

export interface UnifiedToolbarProps {
  namespaces: NamespaceInfo[];
  /** True when the core capped the namespace list; the picker footer says so. */
  namespacesTruncated?: boolean;
  /** True while the lazy first fetch runs; the picker shows a loading row. */
  namespacesLoading?: boolean;
  /** True after the lazy namespace inventory completed successfully. */
  namespacesLoaded?: boolean;
  /** Called when the namespace picker opens; the list loads lazily on first use. */
  onNamespaceOpen?(): void;
  namespaceScope: NamespaceScope;
  onNamespaceScopeChange(scope: NamespaceScope): void;
  namespaceDisabled?: boolean;
  query: string;
  onQueryChange(query: string): void;
  queryInputRef?: Ref<HTMLInputElement>;
  searchPlaceholder?: string;
  refreshing?: boolean;
  onRefresh(): void;
  theme: AppearanceTheme;
  onThemeChange(theme: AppearanceTheme): void;
  onOpenSettings?(): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?(): void;
  onForward?(): void;
  className?: string;
}

const ALL_NAMESPACES_VALUE = "__aster_all_namespaces__";
const ALL_NAMESPACES_ITEM: NamespaceItem = { value: ALL_NAMESPACES_VALUE, label: "All namespaces" };
/** Cap rendered matches so a 10k-namespace cluster never mounts 10k rows. */
const NAMESPACE_MATCH_LIMIT = 100;

interface NamespaceItem {
  value: string;
  label: string;
}

export function UnifiedToolbar({
  namespaces,
  namespacesTruncated = false,
  namespacesLoading = false,
  namespacesLoaded = false,
  onNamespaceOpen,
  namespaceScope,
  onNamespaceScopeChange,
  namespaceDisabled = false,
  query,
  onQueryChange,
  queryInputRef,
  searchPlaceholder = "Filter current resources",
  refreshing = false,
  onRefresh,
  theme,
  onThemeChange,
  onOpenSettings,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  className,
}: UnifiedToolbarProps) {
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;
  // The first item is the "All namespaces" choice under a sentinel value: in
  // multiple mode every selected value is an array element, so the zero-
  // selection state is expressed as the sentinel being the only member. The
  // label map keeps raw values out of the trigger (Base UI renders values by
  // default).
  const [namespaceQuery, setNamespaceQuery] = useState("");
  // IME composition text for the resource search. While it is non-null the
  // input displays the in-progress composition (a controlled input would
  // otherwise swallow it on the next render), but the query prop — and with it
  // the resource filter — stays on the last committed text.
  const [composingQuery, setComposingQuery] = useState<string | null>(null);
  // The All row is offered only while the filter is empty: with a query, its
  // "All namespaces" label would collide with a real namespace (e.g. "all") in
  // Base UI's autoHighlight and let Enter clear the scope by mistake, and
  // during loading it would sit highlighted above the direct-Enter commit.
  const namespaceItems = useMemo<NamespaceItem[]>(() => [
    ...(!namespaceQuery.trim() ? [ALL_NAMESPACES_ITEM] : []),
    ...namespaces.map((item) => ({ value: item.name, label: item.name })),
  ], [namespaces, namespaceQuery]);
  // Selection values are rebuilt from the scope (selected names need not be
  // list rows — a direct-Enter commit can add one before the inventory loads),
  // so item identity is bridged with isItemEqualToValue.
  const namespaceValue = useMemo<NamespaceItem[]>(() => (
    namespaceScope.length
      ? namespaceScope.map((name) => ({ value: name, label: name }))
      : [ALL_NAMESPACES_ITEM]
  ), [namespaceScope]);
  // The popup is controlled so a direct-Enter commit (below) can keep it open
  // and clear the filter on its own terms.
  const [namespaceOpen, setNamespaceOpen] = useState(false);
  // Set when a toggle or commit is rejected at the selection cap; the footer
  // slot explains it until the next successful change or close.
  const [capReached, setCapReached] = useState(false);
  // Progressive narrowing: a short prefix on a huge cluster matches tens of
  // thousands of names — rendering 100 of them is noise. The hint shows the
  // exact match count instead, and concrete rows appear as the user types.
  const namespaceSearch = useMemo(() => {
    const names = namespaces.map((item) => item.name);
    return searchNamespaces(names, namespaceQuery);
  }, [namespaces, namespaceQuery]);

  // Toggling rows applies immediately (no "Done" step). Base UI reports the
  // post-toggle array; the sentinel's intent — "clear the whole selection" —
  // is read from it being newly added, since the zero-selection state keeps
  // the sentinel selected and any later toggle would carry it along.
  const handleScopeChange = (next: NamespaceItem[]) => {
    const names = next
      .filter((item) => item.value !== ALL_NAMESPACES_VALUE)
      .map((item) => item.value);
    const allAdded = namespaceScope.length > 0 && next.some((item) => item.value === ALL_NAMESPACES_VALUE);
    if (allAdded) {
      setCapReached(false);
      onNamespaceScopeChange([]);
      return;
    }
    if (names.length > MAX_NAMESPACE_SELECTION) {
      setCapReached(true);
      return;
    }
    setCapReached(false);
    onNamespaceScopeChange(names);
  };

  // Direct-Enter: the user knows the exact namespace (e.g. "ns-abcdefg") and
  // should not wait for the whole inventory to load. kubernetes/dashboard's
  // selector does the same: Enter commits the raw input value without a list
  // hit. It only fires when no concrete row is selectable (list loading or
  // zero matches) — with rows on screen, Enter belongs to Base UI's
  // autoHighlight, which toggles the highlighted row instead. In multiple
  // mode the commit toggles the name into the selection and stays open.
  const commitNamespaceInput = () => {
    const value = namespaceQuery.trim();
    if (!value) return;
    const result = toggleNamespace(namespaceScope, value);
    if (!result.accepted) {
      setCapReached(true);
      return;
    }
    setCapReached(false);
    onNamespaceScopeChange(result.scope);
    setNamespaceQuery("");
  };

  return (
    <header
      aria-label="Workbench toolbar"
      className={cn("unified-toolbar", className)}
      data-testid="unified-toolbar"
    >
      <div aria-hidden="true" className="unified-toolbar-drag-region" data-tauri-drag-region />

      <div className="toolbar-history">
        <ToolbarIconButton
          disabled={!canGoBack || !onBack}
          label="Go back"
          onClick={onBack}
          testId="toolbar-back"
        >
          <ArrowLeft aria-hidden="true" />
        </ToolbarIconButton>
        <ToolbarIconButton
          disabled={!canGoForward || !onForward}
          label="Go forward"
          onClick={onForward}
          testId="toolbar-forward"
        >
          <ArrowRight aria-hidden="true" />
        </ToolbarIconButton>
      </div>

      <div className="toolbar-namespace">
        <Combobox.Root
          multiple
          autoHighlight
          disabled={namespaceDisabled}
          items={namespaceItems}
          isItemEqualToValue={(item, value) => item.value === value.value}
          inputValue={namespaceQuery}
          limit={NAMESPACE_MATCH_LIMIT}
          // IME-safe: Base UI's input holds composition text back and only
          // fires this for committed text (it calls setInputValue at
          // compositionend). The direct-Enter keydown below needs its own
          // isComposing guard because that handler is ours, not Base UI's.
          onInputValueChange={(inputValue) => setNamespaceQuery(inputValue)}
          onOpenChange={(open) => {
            setNamespaceOpen(open);
            if (open) onNamespaceOpen?.();
            if (!open) {
              setNamespaceQuery("");
              setCapReached(false);
            }
          }}
          onValueChange={(value) => handleScopeChange(value)}
          open={namespaceOpen}
          value={namespaceValue}
        >
          <Combobox.Trigger
            aria-label="Namespace"
            className="namespace-select"
            data-testid="namespace-select"
          >
            <span
              className="namespace-select-value"
              title={namespaceScope.length > 2 ? namespaceScope.join(", ") : undefined}
            >
              {/* Rendered from the hook state, not Combobox.Value: direct-Enter
                  commits and cap rejections can select namespaces that are not
                  list items, and Combobox.Value would fall back to the
                  placeholder for them. */}
              {namespaceScopeSummary(namespaceScope) || "All namespaces"}
            </span>
            <Combobox.Icon className="namespace-select-icon">
              <ChevronsUpDown aria-hidden="true" />
            </Combobox.Icon>
          </Combobox.Trigger>
          <Combobox.Portal>
            <Combobox.Positioner align="start" sideOffset={4}>
              <Combobox.Popup aria-label="Select namespace" className="namespace-combobox-popup">
                <div className="namespace-combobox-search">
                  <Search aria-hidden="true" />
                  <Combobox.Input
                    placeholder="Filter namespaces"
                    data-testid="namespace-filter"
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      // Yield to Base UI whenever a concrete row is selectable:
                      // with autoHighlight, Enter must toggle the highlighted
                      // row (e.g. "kube-system" for the prefix "kube-s"), not
                      // commit the raw prefix.
                      if (namespaceSearch.shown.length > 0) return;
                      // The Enter that commits an IME composition reports
                      // key "Enter" with isComposing (keyCode 229); it belongs
                      // to the input method, never to the direct-Enter commit.
                      if (event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      event.stopPropagation();
                      // Empty filter with no rows: the list is still loading
                      // (or the cluster has no namespaces) and the rendered
                      // "All namespaces" row is the only selectable scope, so
                      // clear the selection directly instead of leaning on
                      // Base UI's autoHighlight, which is unreliable while the
                      // selection is not in the still-loading items.
                      if (!namespaceQuery.trim()) {
                        onNamespaceScopeChange([]);
                        setNamespaceOpen(false);
                        return;
                      }
                      commitNamespaceInput();
                    }}
                  />
                </div>
                {!namespacesLoading && namespacesLoaded && (
                  <Combobox.Empty className="namespace-combobox-empty">
                    No matching namespaces
                  </Combobox.Empty>
                )}
                {namespacesLoading && (
                  // The first fetch can take seconds on a large cluster; say so
                  // instead of leaving the list looking empty.
                  <div className="namespace-combobox-loading" data-testid="namespace-loading">
                    <LoaderCircle aria-hidden="true" className="spin" />
                    Loading namespaces…
                  </div>
                )}
                <Combobox.List className="namespace-combobox-list">
                  {(item: NamespaceItem) => {
                    // Only rows that survive the prefix search are rendered;
                    // the narrowed hint below covers the rest.
                    if (item.value !== ALL_NAMESPACES_VALUE && !namespaceSearch.shown.includes(item.label)) return null;
                    return renderNamespaceItem(item);
                  }}
                </Combobox.List>
                {capReached ? (
                  <div className="namespace-combobox-footer" data-testid="namespace-cap-message">
                    Up to {MAX_NAMESPACE_SELECTION} namespaces selected
                  </div>
                ) : namespaceSearch.narrowed ? (
                  <div className="namespace-combobox-footer">
                    {namespaceSearch.total.toLocaleString()} namespaces match — keep typing to narrow
                  </div>
                ) : namespacesTruncated ? (
                  <div className="namespace-combobox-footer">
                    First {namespaces.length.toLocaleString()} namespaces — type to narrow (large cluster)
                  </div>
                ) : null}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>

      <label className="toolbar-search">
        <Search aria-hidden="true" />
        <input
          aria-label="Filter current resources"
          data-testid="resource-search"
          onChange={(event) => {
            // React fires onChange for every keystroke of an IME composition
            // (e.g. pinyin "d'e's"); those intermediate strings must not drive
            // the filter. The composition text is mirrored into local state so
            // the controlled input still displays it.
            if ((event.nativeEvent as InputEvent).isComposing) {
              setComposingQuery(event.target.value);
              return;
            }
            setComposingQuery(null);
            onQueryChange(event.target.value);
          }}
          onCompositionEnd={(event) => {
            // Commits once per composition; browsers that fire the final
            // input event after compositionend commit again via onChange with
            // the same text, which is idempotent.
            setComposingQuery(null);
            onQueryChange(event.currentTarget.value);
          }}
          placeholder={searchPlaceholder}
          ref={queryInputRef}
          type="search"
          value={composingQuery ?? query}
        />
        <Badge aria-hidden="true" className="shortcut" variant="outline">
          <Command aria-hidden="true" className="size-2.5" />F
        </Badge>
      </label>

      <div className="toolbar-actions">
        <ToolbarIconButton
          disabled={refreshing}
          label="Refresh resources"
          onClick={onRefresh}
          testId="refresh-resources"
        >
          <RefreshCw aria-hidden="true" className={cn(refreshing && "animate-spin")} />
        </ToolbarIconButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  aria-label="Appearance"
                  data-testid="theme-menu"
                  render={<Button size="icon" variant="ghost" />}
                />
              }
            >
              <ThemeIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Appearance</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ThemeMenuItem active={theme === "system"} onClick={() => onThemeChange("system")}>
                <SunMoon aria-hidden="true" />System
              </ThemeMenuItem>
              <ThemeMenuItem active={theme === "light"} onClick={() => onThemeChange("light")}>
                <Sun aria-hidden="true" />Light
              </ThemeMenuItem>
              <ThemeMenuItem active={theme === "dark"} onClick={() => onThemeChange("dark")}>
                <Moon aria-hidden="true" />Dark
              </ThemeMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {onOpenSettings && (
          <ToolbarIconButton
            label="Settings"
            onClick={onOpenSettings}
            testId="open-settings"
          >
            <Settings aria-hidden="true" />
          </ToolbarIconButton>
        )}
      </div>
    </header>
  );
}

function renderNamespaceItem(item: NamespaceItem) {
  return (
    <Combobox.Item
      key={item.value}
      value={item}
      className="namespace-combobox-item"
    >
      <span className="namespace-combobox-check">
        <Combobox.ItemIndicator>
          <Check aria-hidden="true" />
        </Combobox.ItemIndicator>
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
    </Combobox.Item>
  );
}

function ToolbarIconButton({
  label,
  testId,
  children,
  disabled,
  onClick,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
            size="icon"
            variant="ghost"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeMenuItem({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick(): void;
}) {
  return (
    <DropdownMenuItem onClick={onClick}>
      {children}
      {active ? <CheckCircle2 aria-hidden="true" className="ml-auto" /> : null}
    </DropdownMenuItem>
  );
}
