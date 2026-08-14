// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/fake"
)

func relatedFixture(t *testing.T) (*Service, []runtime.Object) {
	t.Helper()
	deployment := testObject("apps/v1", "Deployment", "web", "apps")
	deployment.SetUID("uid-deploy-web")
	deployment.Object["spec"] = map[string]any{
		"template": map[string]any{
			"metadata": map[string]any{"labels": map[string]any{"app": "web"}},
			"spec": map[string]any{
				"serviceAccountName": "web-sa",
				"containers":         []any{map[string]any{"name": "app", "image": "web:1"}},
				"volumes": []any{
					map[string]any{"name": "config", "configMap": map[string]any{"name": "web-config"}},
					map[string]any{"name": "creds", "secret": map[string]any{"secretName": "web-secret"}},
					map[string]any{"name": "data", "persistentVolumeClaim": map[string]any{"claimName": "web-data"}},
				},
			},
		},
	}
	replicaSet := testObject("apps/v1", "ReplicaSet", "web-abc123", "apps")
	replicaSet.SetUID("uid-rs-web")
	replicaSet.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", UID: "uid-deploy-web"}})
	pod := testObject("v1", "Pod", "web-abc123-x1", "apps")
	pod.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "web-abc123", UID: "uid-rs-web"}})
	service := testObject("v1", "Service", "web-svc", "apps")
	service.Object["spec"] = map[string]any{"selector": map[string]any{"app": "web"}}
	objects := []runtime.Object{deployment, replicaSet, pod, service}
	return NewService(fakeProvider{client: newListableFakeClient(objects...)}), objects
}

func newListableFakeClient(objects ...runtime.Object) *fake.FakeDynamicClient {
	listKinds := make(map[schema.GroupVersionResource]string)
	for _, definition := range resourceCatalog {
		gvr := schema.GroupVersionResource{Group: definition.Group, Version: definition.Version, Resource: definition.Resource}
		listKinds[gvr] = definition.Kind + "List"
	}
	return fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), listKinds, objects...)
}

func TestRelatedResources(t *testing.T) {
	service, _ := relatedFixture(t)

	response, err := service.Related(context.Background(), GetRequest{
		ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Namespace: "apps", Name: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	byKey := make(map[string]string)
	for _, item := range response.Related {
		byKey[item.Kind+"/"+item.Name] = item.Relation
	}
	if byKey["ReplicaSet/web-abc123"] != "owned" {
		t.Fatalf("owned replicaset missing: %#v", response.Related)
	}
	if byKey["ConfigMap/web-config"] != "uses" || byKey["Secret/web-secret"] != "uses" || byKey["PersistentVolumeClaim/web-data"] != "uses" || byKey["ServiceAccount/web-sa"] != "uses" {
		t.Fatalf("pod template references missing: %#v", response.Related)
	}
	if byKey["Service/web-svc"] != "selected-by" {
		t.Fatalf("selecting service missing: %#v", response.Related)
	}

	podResponse, err := service.Related(context.Background(), GetRequest{
		ContextID: "context", GVR: GVR{Version: "v1", Resource: "pods"}, Namespace: "apps", Name: "web-abc123-x1",
	})
	if err != nil {
		t.Fatal(err)
	}
	owners := make(map[string]string)
	for _, item := range podResponse.Related {
		owners[item.Kind+"/"+item.Name] = item.Relation
	}
	if owners["ReplicaSet/web-abc123"] != "owner" {
		t.Fatalf("pod owner missing: %#v", podResponse.Related)
	}
}

func TestSearchScopedByNamespace(t *testing.T) {
	service, objects := relatedFixture(t)
	otherNamespacePod := testObject("v1", "Pod", "web-elsewhere", "other-ns")
	service.clients = fakeProvider{client: newListableFakeClient(append(objects, otherNamespacePod)...)}

	response, err := service.Search(context.Background(), SearchRequest{ContextID: "context", Query: "web", Namespace: "apps"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Results) == 0 {
		t.Fatal("expected search results")
	}
	for _, item := range response.Results {
		if item.Namespace != "" && item.Namespace != "apps" {
			t.Fatalf("search escaped namespace: %#v", item)
		}
	}
	found := false
	for _, item := range response.Results {
		if item.Kind == "Deployment" && item.Name == "web" {
			found = true
		}
	}
	if !found {
		t.Fatalf("deployment not found in results: %#v", response.Results)
	}

	if _, err := service.Search(context.Background(), SearchRequest{ContextID: "context", Query: "  "}); err == nil {
		t.Fatal("blank query was accepted")
	}
}
