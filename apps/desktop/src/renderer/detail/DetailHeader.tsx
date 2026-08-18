import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, MoreHorizontal } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import type { ResourceRow } from "../../shared/types";
import { findCatalogIcon } from "../lib/resource-catalog";
import type { ResourceActionDescriptor, ResourceActionId } from "./resource-actions";

export interface DetailHeaderProps {
  row: ResourceRow;
  actions: ResourceActionDescriptor[];
  canMutate: boolean;
  mutationBusy: boolean;
  /** Live write feedback; falls back to the standing dry-run promise. */
  statusMessage: string;
  onAction(id: ResourceActionId): void;
  onBack(): void;
}

/**
 * The 72px identity header owns every object-scoped action. Actions sit beside
 * the name and namespace they operate on, stay reachable from every tab, and
 * never scroll out of view — mutation feedback appears directly beneath them.
 */
export function DetailHeader({
  row,
  actions,
  canMutate,
  mutationBusy,
  statusMessage,
  onAction,
  onBack,
}: DetailHeaderProps) {
  const safeActions = actions.filter((action) => !action.danger);
  const dangerActions = actions.filter((action) => action.danger);
  const disabled = !canMutate || mutationBusy;
  const status = resolveStatus(canMutate, statusMessage);
  const KindIcon = findCatalogIcon(row.kind, row.apiVersion);

  return (
    <div className="resource-detail-headline">
      <header className="resource-detail-header">
        <Button
          aria-label="Back to resource list"
          data-testid="resource-detail-back"
          size="icon"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>

        {KindIcon && (
          <span className="resource-detail-kind-icon" aria-hidden="true">
            <KindIcon size={15} />
          </span>
        )}

        <div className="resource-detail-identity">
          <span className="resource-detail-breadcrumb">
            {row.namespace || "Cluster scoped"} · {row.kind}
          </span>
          <div className="resource-detail-title-row">
            <h1 title={row.name}>{row.name}</h1>
            <StatusBadge status={row.status} deleting={row.deleting} />
          </div>
        </div>

        <div className="resource-detail-actions" data-testid="resource-detail-actions">
          {safeActions.length > 0 && (
            <>
              {/* Wide layout: safe actions inline. The CSS breakpoint hides this
                  group below 1120px, where the More menu takes over. */}
              <div className="resource-detail-actions-inline">
                {safeActions.map((action) => (
                  <Button
                    key={action.id}
                    data-testid={`resource-action-${action.id}`}
                    disabled={disabled}
                    size="lg"
                    variant="outline"
                    onClick={() => onAction(action.id)}
                  >
                    <action.icon data-icon="inline-start" />
                    {action.label}
                  </Button>
                ))}
              </div>

              {/* Narrow layout: one More menu, per the toolbar collapse rule.
                  `display: none` above the breakpoint keeps it out of the
                  accessibility tree so actions are never announced twice. */}
              <div className="resource-detail-actions-overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label="More actions"
                        data-testid="resource-actions-more"
                        disabled={disabled}
                        size="icon-lg"
                        variant="outline"
                      />
                    }
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {safeActions.map((action) => (
                      <DropdownMenuItem
                        key={action.id}
                        data-testid={`resource-action-menu-${action.id}`}
                        onClick={() => onAction(action.id)}
                      >
                        <action.icon aria-hidden="true" />
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {dangerActions.length > 0 && <span aria-hidden="true" className="resource-detail-actions-divider" />}
            </>
          )}

          {dangerActions.map((action) => (
            <Button
              key={action.id}
              data-testid={action.id === "delete" ? "delete-resource" : `resource-action-${action.id}`}
              disabled={disabled}
              size="lg"
              variant="destructive"
              onClick={() => onAction(action.id)}
            >
              <action.icon data-icon="inline-start" />
              {action.label}
            </Button>
          ))}
        </div>
      </header>

      <p
        aria-live="polite"
        className="resource-detail-status"
        data-testid="resource-detail-status"
        data-tone={status.tone}
      >
        {status.tone === "error" && <AlertCircle aria-hidden="true" />}
        {status.text}
      </p>
    </div>
  );
}

function resolveStatus(canMutate: boolean, message: string): { text: string; tone: "quiet" | "error" } {
  if (!canMutate) {
    return { text: "Secrets can't be edited — their data never leaves the cluster.", tone: "quiet" };
  }
  if (!message) return { text: "Changes are previewed before apply.", tone: "quiet" };
  const failed = /(fail|error|denied|forbidden|refused|reject|conflict)/i.test(message);
  return { text: message, tone: failed ? "error" : "quiet" };
}

export function StatusBadge({ status, deleting }: { status?: string; deleting?: boolean }) {
  const normalized = (deleting ? "Terminating" : status || "Unknown").toLowerCase();
  const destructive = /(fail|error|crash|backoff|unavailable|terminat)/.test(normalized);
  const healthy = /(ready|running|active|bound|succeeded|available)/.test(normalized);
  return (
    <Badge
      className="resource-status-badge"
      variant={destructive ? "destructive" : healthy ? "secondary" : "outline"}
    >
      {healthy ? (
        <CheckCircle2 aria-hidden="true" />
      ) : destructive ? (
        <AlertCircle aria-hidden="true" />
      ) : (
        <Clock3 aria-hidden="true" />
      )}
      {deleting ? "Terminating" : status || "Unknown"}
    </Badge>
  );
}
