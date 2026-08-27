import { Container, FileCode2, RotateCw, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Object-scoped write actions, described once and consumed by the detail header
 * (inline buttons and the narrow-window More menu). This is the local precursor
 * to the shared command registry: keep the shape declarative so row context
 * menus and the palette can consume the same descriptors later.
 */
export type ResourceActionId = "image" | "restart" | "edit" | "delete";

export interface ResourceActionDescriptor {
  id: ResourceActionId;
  label: string;
  icon: LucideIcon;
  /** Destructive actions stay outside the More menu and carry the destructive tone. */
  danger: boolean;
  /** Collects a value in a dialog before the dry-run instead of dispatching straight away. */
  needsInput: boolean;
  /** Keyboard hint shown beside the action (Linear-style object shortcuts). */
  shortcut?: string;
}

const ROLLABLE_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

const UPDATE_IMAGE: ResourceActionDescriptor = {
  id: "image",
  label: "Update image",
  icon: Container,
  danger: false,
  needsInput: true,
  shortcut: "I",
};

const RESTART: ResourceActionDescriptor = {
  id: "restart",
  label: "Restart",
  icon: RotateCw,
  danger: false,
  needsInput: false,
  shortcut: "R",
};

/**
 * Full-YAML editing is the universal write path: it stays anchored immediately
 * left of Delete so its position is identical across every kind.
 */
const EDIT: ResourceActionDescriptor = {
  id: "edit",
  label: "Edit",
  icon: FileCode2,
  danger: false,
  needsInput: false,
  shortcut: "E",
};

const DELETE: ResourceActionDescriptor = {
  id: "delete",
  label: "Delete",
  icon: Trash2,
  danger: true,
  needsInput: false,
  shortcut: "⌘⌫",
};

export function resourceActionsFor(kind: string): ResourceActionDescriptor[] {
  const actions: ResourceActionDescriptor[] = [];
  if (ROLLABLE_KINDS.has(kind)) actions.push(UPDATE_IMAGE, RESTART);
  // Secrets stay read-only: their data never leaves the core, so no Edit anchor.
  if (kind !== "Secret") actions.push(EDIT);
  actions.push(DELETE);
  return actions;
}
