package resources

import (
	"reflect"
	"testing"
)

func TestExtendedResourceProjections(t *testing.T) {
	tests := []struct {
		name   string
		object map[string]any
		check  func(t *testing.T, row ResourceRow)
	}{
		{
			name: "statefulset",
			object: map[string]any{
				"apiVersion": "apps/v1", "kind": "StatefulSet", "metadata": map[string]any{"name": "db", "namespace": "apps"},
				"spec":   map[string]any{"replicas": int64(2), "template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"image": "db:v1"}}}}},
				"status": map[string]any{"readyReplicas": int64(2), "updatedReplicas": int64(2)},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Status != "Ready" || row.Ready == nil || *row.Ready != 2 || !reflect.DeepEqual(row.Images, []string{"db:v1"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "daemonset",
			object: map[string]any{
				"apiVersion": "apps/v1", "kind": "DaemonSet", "metadata": map[string]any{"name": "agent", "namespace": "apps"},
				"spec":   map[string]any{"template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"image": "agent:v1"}}}}},
				"status": map[string]any{"desiredNumberScheduled": int64(3), "numberReady": int64(2), "numberAvailable": int64(2), "updatedNumberScheduled": int64(3)},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Status != "Progressing" || row.Desired == nil || *row.Desired != 3 {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "service",
			object: map[string]any{
				"apiVersion": "v1", "kind": "Service", "metadata": map[string]any{"name": "api", "namespace": "apps"},
				"spec": map[string]any{"type": "ClusterIP", "clusterIP": "10.0.0.1", "externalIPs": []any{"1.2.3.4"}, "ports": []any{map[string]any{"name": "http", "port": int64(80), "protocol": "TCP"}}},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Type != "ClusterIP" || !reflect.DeepEqual(row.Addresses, []string{"1.2.3.4", "10.0.0.1"}) || !reflect.DeepEqual(row.Ports, []string{"http:80/TCP"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "ingress",
			object: map[string]any{
				"apiVersion": "networking.k8s.io/v1", "kind": "Ingress", "metadata": map[string]any{"name": "web", "namespace": "apps"},
				"spec": map[string]any{"ingressClassName": "nginx", "rules": []any{map[string]any{"host": "b.example.test"}, map[string]any{"host": "a.example.test"}}},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Type != "nginx" || !reflect.DeepEqual(row.Addresses, []string{"a.example.test", "b.example.test"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "node",
			object: map[string]any{
				"apiVersion": "v1", "kind": "Node", "metadata": map[string]any{"name": "worker"},
				"status": map[string]any{
					"conditions": []any{map[string]any{"type": "Ready", "status": "True"}},
					"addresses":  []any{map[string]any{"type": "InternalIP", "address": "10.0.0.2"}},
					"nodeInfo":   map[string]any{"kubeletVersion": "v1.36.3"},
				},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Status != "Ready" || row.Version != "v1.36.3" || !reflect.DeepEqual(row.Addresses, []string{"InternalIP:10.0.0.2"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "role",
			object: map[string]any{
				"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "Role", "metadata": map[string]any{"name": "reader", "namespace": "apps"},
				"rules": []any{map[string]any{"verbs": []any{"list", "get"}, "resources": []any{"pods"}}},
			},
			check: func(t *testing.T, row ResourceRow) {
				if !reflect.DeepEqual(row.Rules, []string{"get,list:pods"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "binding",
			object: map[string]any{
				"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "ClusterRoleBinding", "metadata": map[string]any{"name": "readers"},
				"roleRef":  map[string]any{"kind": "ClusterRole", "name": "reader"},
				"subjects": []any{map[string]any{"kind": "ServiceAccount", "namespace": "apps", "name": "viewer"}},
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.RoleRef != "ClusterRole/reader" || !reflect.DeepEqual(row.Subjects, []string{"ServiceAccount/apps/viewer"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "event",
			object: map[string]any{
				"apiVersion": "v1", "kind": "Event", "metadata": map[string]any{"name": "web.1", "namespace": "apps"},
				"reason": "Pulled", "message": "Container image pulled", "type": "Normal", "count": int64(3), "lastTimestamp": "2026-01-01T00:00:00Z",
			},
			check: func(t *testing.T, row ResourceRow) {
				if row.Reason != "Pulled" || row.Message != "Container image pulled" || row.Type != "Normal" || row.Count == nil || *row.Count != 3 || row.LastTimestamp == nil {
					t.Fatalf("row = %#v", row)
				}
			},
		},
		{
			name: "related owner",
			object: map[string]any{
				"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": "web", "namespace": "apps", "ownerReferences": []any{map[string]any{"kind": "ReplicaSet", "name": "web-abc"}}},
			},
			check: func(t *testing.T, row ResourceRow) {
				if !reflect.DeepEqual(row.Related, []string{"ReplicaSet/web-abc"}) {
					t.Fatalf("row = %#v", row)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			object := testObject("v1", "Unused", "resource", "apps")
			object.Object = test.object
			test.check(t, project(object))
		})
	}
}
