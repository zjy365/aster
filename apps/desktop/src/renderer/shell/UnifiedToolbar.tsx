import type { Ref } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Command,
  LockKeyhole,
  Moon,
  RefreshCw,
  Search,
  Sun,
  SunMoon,
  UnlockKeyhole,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NamespaceInfo } from "../../shared/types";

export type AppearanceTheme = "system" | "light" | "dark";

export interface UnifiedToolbarProps {
  namespaces: NamespaceInfo[];
  namespace: string;
  onNamespaceChange(namespace: string): void;
  namespaceDisabled?: boolean;
  query: string;
  onQueryChange(query: string): void;
  queryInputRef?: Ref<HTMLInputElement>;
  searchPlaceholder?: string;
  readOnly: boolean;
  onToggleReadOnly(): void;
  readOnlyDisabled?: boolean;
  refreshing?: boolean;
  onRefresh(): void;
  theme: AppearanceTheme;
  onThemeChange(theme: AppearanceTheme): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?(): void;
  onForward?(): void;
  className?: string;
}

const ALL_NAMESPACES_VALUE = "__aster_all_namespaces__";

export function UnifiedToolbar({
  namespaces,
  namespace,
  onNamespaceChange,
  namespaceDisabled = false,
  query,
  onQueryChange,
  queryInputRef,
  searchPlaceholder = "Filter current resources",
  readOnly,
  onToggleReadOnly,
  readOnlyDisabled = false,
  refreshing = false,
  onRefresh,
  theme,
  onThemeChange,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  className,
}: UnifiedToolbarProps) {
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;

  return (
    <header
      aria-label="Workbench toolbar"
      className={cn("unified-toolbar", className)}
      data-testid="unified-toolbar"
    >
      <div aria-hidden="true" className="unified-toolbar-drag-region" />

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
        <Select
          disabled={namespaceDisabled}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            onNamespaceChange(value === ALL_NAMESPACES_VALUE ? "" : value);
          }}
          value={namespace || ALL_NAMESPACES_VALUE}
        >
          <SelectTrigger
            aria-label="Namespace"
            className="namespace-select"
            data-testid="namespace-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ALL_NAMESPACES_VALUE}>All namespaces</SelectItem>
            {namespaces.map((item) => (
              <SelectItem key={item.name} value={item.name}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="toolbar-search">
        <Search aria-hidden="true" />
        <input
          aria-label="Filter current resources"
          data-testid="resource-search"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchPlaceholder}
          ref={queryInputRef}
          type="search"
          value={query}
        />
        <Badge aria-hidden="true" className="shortcut" variant="outline">
          <Command aria-hidden="true" className="size-2.5" />F
        </Badge>
      </label>

      <div className="toolbar-actions">
        <Button
          aria-label={readOnly ? "Read-only" : "Writes on"}
          aria-pressed={!readOnly}
          className="read-only-toggle"
          data-testid="read-only-toggle"
          disabled={readOnlyDisabled}
          onClick={onToggleReadOnly}
          variant={readOnly ? "outline" : "destructive"}
        >
          {readOnly ? <LockKeyhole aria-hidden="true" /> : <UnlockKeyhole aria-hidden="true" />}
          {readOnly ? "Read-only" : "Writes on"}
        </Button>

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
      </div>
    </header>
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
