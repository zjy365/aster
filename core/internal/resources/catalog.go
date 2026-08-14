package resources

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

type resourceDefinition struct {
	Group      string
	Version    string
	Resource   string
	Kind       string
	Namespaced bool
}

var resourceCatalog = map[string]resourceDefinition{
	"apps/v1/deployments":                              {Group: "apps", Version: "v1", Resource: "deployments", Kind: "Deployment", Namespaced: true},
	"apps/v1/statefulsets":                             {Group: "apps", Version: "v1", Resource: "statefulsets", Kind: "StatefulSet", Namespaced: true},
	"apps/v1/daemonsets":                               {Group: "apps", Version: "v1", Resource: "daemonsets", Kind: "DaemonSet", Namespaced: true},
	"apps/v1/replicasets":                              {Group: "apps", Version: "v1", Resource: "replicasets", Kind: "ReplicaSet", Namespaced: true},
	"batch/v1/jobs":                                    {Group: "batch", Version: "v1", Resource: "jobs", Kind: "Job", Namespaced: true},
	"batch/v1/cronjobs":                                {Group: "batch", Version: "v1", Resource: "cronjobs", Kind: "CronJob", Namespaced: true},
	"core/v1/pods":                                     {Version: "v1", Resource: "pods", Kind: "Pod", Namespaced: true},
	"core/v1/configmaps":                               {Version: "v1", Resource: "configmaps", Kind: "ConfigMap", Namespaced: true},
	"core/v1/events":                                   {Version: "v1", Resource: "events", Kind: "Event", Namespaced: true},
	"core/v1/secrets":                                  {Version: "v1", Resource: "secrets", Kind: "Secret", Namespaced: true},
	"core/v1/services":                                 {Version: "v1", Resource: "services", Kind: "Service", Namespaced: true},
	"core/v1/namespaces":                               {Version: "v1", Resource: "namespaces", Kind: "Namespace"},
	"core/v1/nodes":                                    {Version: "v1", Resource: "nodes", Kind: "Node"},
	"core/v1/serviceaccounts":                          {Version: "v1", Resource: "serviceaccounts", Kind: "ServiceAccount", Namespaced: true},
	"core/v1/persistentvolumeclaims":                   {Version: "v1", Resource: "persistentvolumeclaims", Kind: "PersistentVolumeClaim", Namespaced: true},
	"core/v1/persistentvolumes":                        {Version: "v1", Resource: "persistentvolumes", Kind: "PersistentVolume"},
	"networking.k8s.io/v1/ingresses":                   {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses", Kind: "Ingress", Namespaced: true},
	"networking.k8s.io/v1/networkpolicies":             {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies", Kind: "NetworkPolicy", Namespaced: true},
	"storage.k8s.io/v1/storageclasses":                 {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses", Kind: "StorageClass"},
	"rbac.authorization.k8s.io/v1/roles":               {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles", Kind: "Role", Namespaced: true},
	"rbac.authorization.k8s.io/v1/rolebindings":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings", Kind: "RoleBinding", Namespaced: true},
	"rbac.authorization.k8s.io/v1/clusterroles":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles", Kind: "ClusterRole"},
	"rbac.authorization.k8s.io/v1/clusterrolebindings": {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings", Kind: "ClusterRoleBinding"},
}

func validateGVR(value GVR) (schema.GroupVersionResource, resourceDefinition, error) {
	value.Group = strings.TrimSpace(value.Group)
	value.Version = strings.TrimSpace(value.Version)
	value.Resource = strings.ToLower(strings.TrimSpace(value.Resource))
	if value.Version == "" || value.Resource == "" {
		return schema.GroupVersionResource{}, resourceDefinition{}, invalid("gvr.version and gvr.resource are required")
	}
	groupKey := value.Group
	if groupKey == "" {
		groupKey = "core"
	}
	definition, exists := resourceCatalog[groupKey+"/"+value.Version+"/"+value.Resource]
	if !exists {
		return schema.GroupVersionResource{}, resourceDefinition{}, invalid(fmt.Sprintf("unsupported resource %q for %s/%s", value.Resource, groupKey, value.Version))
	}
	return schema.GroupVersionResource{Group: definition.Group, Version: definition.Version, Resource: definition.Resource}, definition, nil
}
