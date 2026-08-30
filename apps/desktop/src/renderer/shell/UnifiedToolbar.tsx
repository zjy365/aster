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
import type { NamespaceInfo } from "../../shared/types";
import { searchNamespaces } from "../lib/namespace-search";

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
  namespace: string;
  onNamespaceChange(namespace: string): void;
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
/** Cap rendered matches so a 10k-namespace cluster never mounts 10k rows. */
const NAMESPACE_MATCH_LIMIT = 100;

interface NamespaceItem {
  value: string | null;
  label: string;
}

export function UnifiedToolbar({
  namespaces,
  namespacesTruncated = false,
  namespacesLoading = false,
  namespacesLoaded = false,
  onNamespaceOpen,
  namespace,
  onNamespaceChange,
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
  // A null-valued first item is the "All namespaces" choice; the label map
  // keeps the raw value out of the trigger (Base UI renders values by default).
  const [namespaceQuery, setNamespaceQuery] = useState("");
  // IME composition text for the resource search. While it is non-null the
  // input displays the in-progress composition (a controlled input would
  // otherwise swallow it on the next render), but the query prop — and with it
  // the resource filter — stays on the last committed text.
  const [composingQuery, setComposingQuery] = useState<string | null>(null);
  // The null row is offered only while the filter is empty: with a query, its
  // "All namespaces" label would collide with a real namespace (e.g. "all") in
  // Base UI's autoHighlight and let Enter pick cluster scope by mistake, and
  // during loading it would sit highlighted above the direct-Enter commit.
  const namespaceItems = useMemo<NamespaceItem[]>(() => [
    ...(!namespaceQuery.trim() ? [{ value: null, label: "All namespaces" }] : []),
    ...namespaces.map((item) => ({ value: item.name as string | null, label: item.name })),
  ], [namespaces, namespaceQuery]);
  const selectedNamespace = namespaceItems.find((item) => item.value === (namespace || null)) ?? null;
  // The popup is controlled so a direct-Enter commit (below) can close it even
  // when the typed value is not a list row Base UI would auto-select.
  const [namespaceOpen, setNamespaceOpen] = useState(false);
  // Progressive narrowing: a short prefix on a huge cluster matches tens of
  // thousands of names — rendering 100 of them is noise. The hint shows the
  // exact match count instead, and concrete rows appear as the user types.
  const namespaceSearch = useMemo(() => {
    const names = namespaces.map((item) => item.name);
    return searchNamespaces(names, namespaceQuery);
  }, [namespaces, namespaceQuery]);
  const namespaceFooter = namespaceSearch.narrowed
    ? `${namespaceSearch.total.toLocaleString()} namespaces match — keep typing to narrow`
    : null;

  // Direct-Enter: the user knows the exact namespace (e.g. "ns-abcdefg") and
  // should not wait for the whole inventory to load. kubernetes/dashboard's
  // selector does the same: Enter commits the raw input value without a list
  // hit. It only fires when no concrete row is selectable (list loading or
  // zero matches) — with rows on screen, Enter belongs to Base UI's
  // autoHighlight, which selects the highlighted row instead.
  const commitNamespaceInput = () => {
    const value = namespaceQuery.trim();
    if (!value) return;
    onNamespaceChange(value);
    setNamespaceOpen(false);
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
          autoHighlight
          disabled={namespaceDisabled}
          items={namespaceItems}
          limit={NAMESPACE_MATCH_LIMIT}
          // IME-safe: Base UI's input holds composition text back and only
          // fires this for committed text (it calls setInputValue at
          // compositionend). The direct-Enter keydown below needs its own
          // isComposing guard because that handler is ours, not Base UI's.
          onInputValueChange={(inputValue) => setNamespaceQuery(inputValue)}
          onOpenChange={(open) => {
            setNamespaceOpen(open);
            if (open) onNamespaceOpen?.();
            if (!open) setNamespaceQuery("");
          }}
          onValueChange={(item) => onNamespaceChange(item?.value ?? "")}
          open={namespaceOpen}
          value={selectedNamespace}
        >
          <Combobox.Trigger
            aria-label="Namespace"
            className="namespace-select"
            data-testid="namespace-select"
          >
            <span className="namespace-select-value">
              {/* Rendered from the hook state, not Combobox.Value: a direct-Enter
                  commit can select a namespace that is not a list item, and
                  Combobox.Value would fall back to the placeholder for it. */}
              {namespace || "All namespaces"}
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
                      // with autoHighlight, Enter must select the highlighted
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
                      // commit the null scope directly instead of leaning on
                      // Base UI's autoHighlight, which is unreliable while the
                      // selection is not in the still-loading items.
                      if (!namespaceQuery.trim()) {
                        onNamespaceChange("");
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
                    if (item.value === null) return renderNamespaceItem(item, ALL_NAMESPACES_VALUE);
                    // Only rows that survive the prefix search are rendered;
                    // the narrowed hint below covers the rest.
                    if (!namespaceSearch.shown.includes(item.label)) return null;
                    return renderNamespaceItem(item, item.value as string);
                  }}
                </Combobox.List>
                {namespaceSearch.narrowed ? (
                  <div className="namespace-combobox-footer">{namespaceFooter}</div>
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

function renderNamespaceItem(item: NamespaceItem, key: string) {
  return (
    <Combobox.Item
      key={key}
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
