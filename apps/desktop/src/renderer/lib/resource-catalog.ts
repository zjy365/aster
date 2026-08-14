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
    label: "Pinned",
    items: [
      resource("pods", "", "v1", "pods", "Pod", true, "Pinned", Container),
      resource("nodes", "", "v1", "nodes", "Node", false, "Pinned", Server),
    ],
  },
  {
    label: "Workloads",
    items: [
      resource("deployments", "apps", "v1", "deployments", "Deployment", true, "Workloads", Boxes),
      resource("statefulsets", "apps", "v1", "statefulsets", "StatefulSet", true, "Workloads", Database),
      resource("daemonsets", "apps", "v1", "daemonsets", "DaemonSet", true, "Workloads", Layers3),
      resource("pods-workloads", "", "v1", "pods", "Pod", true, "Workloads", Container),
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
    pinned: group.label === "Pinned",
  })),
}));

export const DEFAULT_KIND: ResourceKind = toResourceKind(RESOURCE_GROUPS[1].items[0]);

export function toResourceKind(value: ResourceKind & { icon?: ResourceIcon }): ResourceKind {
  const { icon: _icon, ...resourceKind } = value;
  return resourceKind;
}

export function findEnabledResourceKind(id: string): ResourceKind | undefined {
  return findKindInGroups(SIDEBAR_RESOURCE_GROUPS, id);
}

export function findKindInGroups(groups: SidebarResourceGroup[], id: string): ResourceKind | undefined {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.id === id && item.enabled !== false) {
        const { icon: _icon, label: _label, enabled: _enabled, pinned: _pinned, ...kind } = item;
        return kind;
      }
    }
  }
  return undefined;
}

export function customKindId(resource: Pick<DiscoveredResource, "group" | "version" | "resource">): string {
  return `crd:${resource.group}/${resource.version}/${resource.resource}`;
}

/**
 * Maps lazily discovered custom resources into sidebar groups, one per API
 * group. Custom kinds are always enabled: the server resolved them through
 * discovery, so list/watch/get work through the same pipeline as core kinds.
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
  return [...byGroup.entries()].map(([label, items]) => ({ label, items }));
}
