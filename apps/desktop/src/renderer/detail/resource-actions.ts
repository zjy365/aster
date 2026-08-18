import { Container, RotateCw, Scale3d, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Object-scoped write actions, described once and consumed by the detail header
 * (inline buttons and the narrow-window More menu). This is the local precursor
 * to the shared command registry: keep the shape declarative so row context
 * menus and the palette can consume the same descriptors later.
 */
export type ResourceActionId = "scale" | "image" | "restart" | "delete";

export interface ResourceActionDescriptor {
  id: ResourceActionId;
  label: string;
  icon: LucideIcon;
  /** Destructive actions stay outside the More menu and carry the destructive tone. */
  danger: boolean;
  /** Collects a value in a dialog before the dry-run instead of dispatching straight away. */
  needsInput: boolean;
}

const ROLLABLE_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
/** A DaemonSet's replica count is derived from matching nodes, so it is not scalable. */
const SCALABLE_KINDS = new Set(["Deployment", "StatefulSet"]);

const SCALE: ResourceActionDescriptor = {
  id: "scale",
  label: "Scale",
  icon: Scale3d,
  danger: false,
  needsInput: true,
};

const UPDATE_IMAGE: ResourceActionDescriptor = {
  id: "image",
  label: "Update image",
  icon: Container,
  danger: false,
  needsInput: true,
};

const RESTART: ResourceActionDescriptor = {
  id: "restart",
  label: "Restart",
  icon: RotateCw,
  danger: false,
  needsInput: false,
};

const DELETE: ResourceActionDescriptor = {
  id: "delete",
  label: "Delete",
  icon: Trash2,
  danger: true,
  needsInput: false,
};

export function resourceActionsFor(kind: string): ResourceActionDescriptor[] {
  const actions: ResourceActionDescriptor[] = [];
  if (SCALABLE_KINDS.has(kind)) actions.push(SCALE);
  if (ROLLABLE_KINDS.has(kind)) actions.push(UPDATE_IMAGE, RESTART);
  actions.push(DELETE);
  return actions;
}
