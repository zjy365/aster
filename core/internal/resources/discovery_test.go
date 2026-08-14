// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/discovery"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

type fakeDiscoveryProvider struct {
	client    dynamic.Interface
	discovery discovery.DiscoveryInterface
}

func (f fakeDiscoveryProvider) Client(string) (dynamic.Interface, error) { return f.client, nil }
func (f fakeDiscoveryProvider) Discovery(string) (discovery.DiscoveryInterface, error) {
	return f.discovery, nil
}

func customDiscoveryClient() discovery.DiscoveryInterface {
	client := &clienttesting.Fake{}
	fakeDiscovery := &fakediscovery.FakeDiscovery{Fake: client}
	fakeDiscovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "v1",
			APIResources: []metav1.APIResource{
				{Name: "configmaps", Kind: "ConfigMap", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "watch", "create", "update", "delete"}},
				{Name: "secrets", Kind: "Secret", Namespaced: true, Verbs: metav1.Verbs{"get", "list"}},
			},
		},
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Kind: "Deployment", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "watch", "create", "update", "delete"}},
			},
		},
		{
			GroupVersion: "example.com/v1",
			APIResources: []metav1.APIResource{
				{Name: "widgets", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"get", "list", "watch", "create", "update", "delete"}},
				{Name: "widgets/status", Kind: "Widget", Namespaced: true, Verbs: metav1.Verbs{"get", "update"}},
				{Name: "gadgets", Kind: "Gadget", Namespaced: false, Verbs: metav1.Verbs{"get", "list"}},
			},
		},
	}
	return fakeDiscovery
}

func TestDiscoverReturnsOnlyCustomResources(t *testing.T) {
	scheme := runtime.NewScheme()
	widget := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "example.com/v1",
		"kind":     "Widget",
		"metadata": map[string]any{"name": "demo", "namespace": "apps"},
	}}
	client := fake.NewSimpleDynamicClient(scheme, widget)
	service := NewService(fakeDiscoveryProvider{client: client, discovery: customDiscoveryClient()})

	resources, err := service.Discover(context.Background(), "context")
	if err != nil {
		t.Fatal(err)
	}
	byResource := make(map[string]DiscoveredResource)
	for _, item := range resources {
		byResource[item.Group+"/"+item.Resource] = item
	}
	if _, exists := byResource["/configmaps"]; exists {
		t.Fatal("static catalog resource leaked into discovery results")
	}
	widgetResource, exists := byResource["example.com/widgets"]
	if !exists || widgetResource.Kind != "Widget" || !widgetResource.Namespaced {
		t.Fatalf("widget discovery = %#v (exists=%v)", widgetResource, exists)
	}
	if _, exists := byResource["example.com/widgets/status"]; exists {
		t.Fatal("subresource leaked into discovery results")
	}
	gadget, exists := byResource["example.com/gadgets"]
	if !exists || gadget.Namespaced {
		t.Fatalf("gadget discovery = %#v (exists=%v)", gadget, exists)
	}

	// The custom resource is listable through the resolved GVR.
	list, err := service.List(context.Background(), ListRequest{ContextID: "context", GVR: GVR{Group: "example.com", Version: "v1", Resource: "widgets"}, Namespace: "apps"})
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 1 || list.Items[0].Name != "demo" || list.Items[0].Kind != "Widget" {
		t.Fatalf("widget list = %#v", list.Items)
	}

	// Unknown groups still fail with the static catalog error.
	_, err = service.List(context.Background(), ListRequest{ContextID: "context", GVR: GVR{Group: "missing.io", Version: "v1", Resource: "things"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported resource") {
		t.Fatalf("unknown group err=%v", err)
	}
}

func TestDiscoverCachesPerContext(t *testing.T) {
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	discoveryClient := customDiscoveryClient()
	service := NewService(fakeDiscoveryProvider{client: client, discovery: discoveryClient})

	first, err := service.Discover(context.Background(), "context")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Discover(context.Background(), "context")
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != len(second) {
		t.Fatalf("cached discovery changed: %d vs %d", len(first), len(second))
	}
	if _, err = service.Discover(context.Background(), "  "); err == nil {
		t.Fatal("blank contextId was accepted")
	}
}
