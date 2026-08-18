import {
  Activity,
  Boxes,
  Braces,
  Cloud,
  Container,
  Database,
  FileKey,
  HardDrive,
  KeyRound,
  Layers3,
  Network,
  Puzzle,
  Server,
  ShieldCheck,
  Workflow,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";
import type { DiscoveredResource, ResourceKind } from "../../shared/types";
import { pluralize } from "./format";
import type { SidebarResourceGroup } from "../shell/Sidebar";

export type ResourceIcon = ComponentType<LucideProps>;

export interface ResourceCatalogEntry extends ResourceKind {
  icon: ResourceIcon;
}

interface ResourceGroup {
  label: string;
  items: ResourceCatalogEntry[];
}

function resource(
  id: string,
  group: string,
  version: string,
  resourceName: string,
  kind: string,
  namespaced: boolean,
  category: string,
  icon: ResourceIcon,
): ResourceCatalogEntry {
  return { id, group, version, resource: resourceName, kind, namespaced, category, icon };
}

export const RESOURCE_GROUPS: ResourceGroup[] = [
  {
    label: "Workloads",
    items: [
      resource("deployments", "apps", "v1", "deployments", "Deployment", true, "Workloads", Boxes),
      resource("statefulsets", "apps", "v1", "statefulsets", "StatefulSet", true, "Workloads", Database),
      resource("daemonsets", "apps", "v1", "daemonsets", "DaemonSet", true, "Workloads", Layers3),
      resource("pods", "", "v1", "pods", "Pod", true, "Workloads", Container),
      resource("jobs", "batch", "v1", "jobs", "Job", true, "Workloads", Workflow),
      resource("cronjobs", "batch", "v1", "cronjobs", "CronJob", true, "Workloads", Activity),
    ],
  },
  {
    label: "Traffic",
    items: [
      resource("services", "", "v1", "services", "Service", true, "Traffic", Network),
      resource("ingresses", "networking.k8s.io", "v1", "ingresses", "Ingress", true, "Traffic", Cloud),
      resource("networkpolicies", "networking.k8s.io", "v1", "networkpolicies", "NetworkPolicy", true, "Traffic", ShieldCheck),
    ],
  },
  {
    label: "Storage",
    items: [
      resource("persistentvolumeclaims", "", "v1", "persistentvolumeclaims", "PersistentVolumeClaim", true, "Storage", HardDrive),
      resource("persistentvolumes", "", "v1", "persistentvolumes", "PersistentVolume", false, "Storage", Database),
      resource("storageclasses", "storage.k8s.io", "v1", "storageclasses", "StorageClass", false, "Storage", Layers3),
    ],
  },
  {
    label: "Config",
    items: [
      resource("configmaps", "", "v1", "configmaps", "ConfigMap", true, "Config", Braces),
      resource("secrets", "", "v1", "secrets", "Secret", true, "Config", FileKey),
      resource("namespaces", "", "v1", "namespaces", "Namespace", false, "Config", Boxes),
      resource("nodes", "", "v1", "nodes", "Node", false, "Config", Server),
    ],
  },
  {
    label: "Access",
    items: [
      resource("serviceaccounts", "", "v1", "serviceaccounts", "ServiceAccount", true, "Access", KeyRound),
      resource("roles", "rbac.authorization.k8s.io", "v1", "roles", "Role", true, "Access", ShieldCheck),
      resource("rolebindings", "rbac.authorization.k8s.io", "v1", "rolebindings", "RoleBinding", true, "Access", ShieldCheck),
      resource("clusterroles", "rbac.authorization.k8s.io", "v1", "clusterroles", "ClusterRole", false, "Access", ShieldCheck),
    ],
  },
];

const ENABLED_RESOURCES = new Set([
  "deployments", "statefulsets", "daemonsets", "pods", "jobs", "cronjobs",
  "services", "ingresses", "networkpolicies", "persistentvolumeclaims",
  "persistentvolumes", "storageclasses", "configmaps", "secrets",
  "namespaces", "nodes", "serviceaccounts", "roles", "rolebindings",
  "clusterroles", "clusterrolebindings",
]);

export const SIDEBAR_RESOURCE_GROUPS: SidebarResourceGroup[] = RESOURCE_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.map((item) => ({
    ...item,
    enabled: ENABLED_RESOURCES.has(item.resource),
  })),
}));

export const DEFAULT_KIND: ResourceKind = toResourceKind(RESOURCE_GROUPS[0].items[0]);

/** Kind glyph for the detail header; matches on kind + resolved apiVersion. */
export function findCatalogIcon(kind: string, apiVersion: string): ResourceIcon | undefined {
  for (const item of RESOURCE_GROUPS.flatMap((group) => group.items)) {
    const itemApiVersion = item.group ? `${item.group}/${item.version}` : item.version;
    if (item.kind === kind && itemApiVersion === apiVersion) return item.icon;
  }
  return undefined;
}

export function toResourceKind(value: ResourceKind & { icon?: ResourceIcon }): ResourceKind {
  const { icon: _icon, ...resourceKind } = value;
  return resourceKind;
}

export function findEnabledResourceKind(id: string): ResourceKind | undefined {
  return findKindInGroups(SIDEBAR_RESOURCE_GROUPS, id);
}

export function findKindInGroups(groups: SidebarResourceGroup[], id: string): ResourceKind | undefined {
  for (const item of flattenResourceGroups(groups)) {
    if (item.id === id && item.enabled !== false) {
      const { icon: _icon, label: _label, enabled: _enabled, ...kind } = item;
      return kind;
    }
  }
  return undefined;
}

/**
 * Yields every selectable item, descending into nested subgroup children.
 * Lookup paths (palette, related-resource navigation) must not depend on how
 * the sidebar visually nests groups.
 */
export function flattenResourceGroups(groups: SidebarResourceGroup[]): SidebarResourceGroup["items"] {
  return groups.flatMap((group) => [
    ...group.items,
    ...flattenResourceGroups(group.children ?? []),
  ]);
}

export function customKindId(resource: Pick<DiscoveredResource, "group" | "version" | "resource">): string {
  return `crd:${resource.group}/${resource.version}/${resource.resource}`;
}

/**
 * Legacy Kubernetes API groups predate the DNS-subdomain convention, so they
 * carry no domain suffix. Bucket them under k8s.io with the rest of the
 * Kubernetes project groups.
 */
const LEGACY_K8S_GROUPS = new Set(["apps", "autoscaling", "batch", "extensions", "policy"]);

/** Registrable domain of an API group: the last two DNS labels. */
function domainRoot(group: string): string {
  if (LEGACY_K8S_GROUPS.has(group)) return "k8s.io";
  const labels = group.split(".");
  return labels.length > 2 ? labels.slice(-2).join(".") : group;
}

/** Label for an API group nested under its domain root: the leading part. */
function subgroupLabel(group: string, root: string): string {
  const suffix = `.${root}`;
  return group.endsWith(suffix) ? group.slice(0, -suffix.length) : group;
}

/**
 * Maps lazily discovered custom resources into one umbrella sidebar group
 * ("Custom Resources"). API groups fold into a section per registrable
 * domain (devbox.sealos.io and user.sealos.io both nest under sealos.io);
 * a domain holding a single API group stays flat. Custom kinds are always
 * enabled: the server resolved them through discovery, so list/watch/get
 * work through the same pipeline as core kinds.
 */
export function customResourceGroups(resources: DiscoveredResource[]): SidebarResourceGroup[] {
  const byGroup = new Map<string, SidebarResourceGroup["items"]>();
  for (const resource of resources) {
    const item = {
      id: customKindId(resource),
      group: resource.group,
      version: resource.version,
      resource: resource.resource,
      kind: resource.kind,
      namespaced: resource.namespaced,
      category: "Custom",
      icon: Puzzle,
      label: pluralize(resource.kind),
      enabled: true,
    };
    const label = resource.group || "core";
    byGroup.set(label, [...(byGroup.get(label) || []), item]);
  }
  if (byGroup.size === 0) return [];

  const byDomain = new Map<string, string[]>();
  for (const group of byGroup.keys()) {
    const root = domainRoot(group);
    byDomain.set(root, [...(byDomain.get(root) || []), group]);
  }

  const children: SidebarResourceGroup[] = [...byDomain.entries()].map(([root, groups]) => {
    if (groups.length === 1) {
      return { label: groups[0], items: byGroup.get(groups[0]) ?? [] };
    }
    return {
      label: root,
      items: [],
      children: groups.map((group) => ({
        label: subgroupLabel(group, root),
        items: byGroup.get(group) ?? [],
      })),
    };
  });

  return [{
    label: "Custom Resources",
    items: [],
    children,
  }];
}
