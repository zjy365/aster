package resources

import (
	"context"
	"fmt"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

func TestServiceOverviewAggregatesClusterSnapshot(t *testing.T) {
	objects := []runtime.Object{}

	node := func(name, ready string, cpuAlloc, memAlloc string) *unstructured.Unstructured {
		object := testObject("v1", "Node", name, "")
		object.Object["status"] = map[string]any{
			"conditions": []any{
				map[string]any{"type": "Ready", "status": ready},
			},
			"allocatable": map[string]any{"cpu": cpuAlloc, "memory": memAlloc},
		}
		return object
	}
	objects = append(objects,
		node("node-a", "True", "4", "8Gi"),
		node("node-b", "True", "4", "8Gi"),
		node("node-c", "False", "4", "8Gi"),
	)

	pod := func(name, phase string, requests map[string]any, limits map[string]any) *unstructured.Unstructured {
		object := testObject("v1", "Pod", name, "default")
		object.Object["status"] = map[string]any{"phase": phase}
		resources := map[string]any{}
		if requests != nil {
			resources["requests"] = requests
		}
		if limits != nil {
			resources["limits"] = limits
		}
		object.Object["spec"] = map[string]any{
			"containers": []any{
				map[string]any{"name": "app", "image": "example/app:v1", "resources": resources},
			},
		}
		return object
	}
	objects = append(objects,
		pod("web-1", "Running", map[string]any{"cpu": "500m", "memory": "1Gi"}, map[string]any{"cpu": "1", "memory": "2Gi"}),
		pod("web-2", "Running", map[string]any{"cpu": "500m", "memory": "1Gi"}, map[string]any{"cpu": "1", "memory": "2Gi"}),
		pod("web-3", "Pending", map[string]any{"cpu": "500m", "memory": "1Gi"}, map[string]any{"cpu": "1", "memory": "2Gi"}),
	)

	namespace := func(name string) *unstructured.Unstructured {
		object := testObject("v1", "Namespace", name, "")
		object.Object["status"] = map[string]any{"phase": "Active"}
		return object
	}
	objects = append(objects, namespace("default"), namespace("kube-system"))

	service := func(name string) *unstructured.Unstructured {
		return testObject("v1", "Service", name, "default")
	}
	objects = append(objects, service("web"), service("api"), service("db"))

	event := func(name, namespace, eventType, reason string, secondsAgo int) *unstructured.Unstructured {
		object := testObject("v1", "Event", name, namespace)
		object.Object["type"] = eventType
		object.Object["reason"] = reason
		object.Object["message"] = "message for " + name
		object.Object["count"] = int64(2)
		object.Object["lastTimestamp"] = time.Now().UTC().Add(-time.Duration(secondsAgo) * time.Second).Format(time.RFC3339)
		return object
	}
	objects = append(objects,
		event("old", "default", "Normal", "Scheduled", 300),
		event("mid", "default", "Warning", "BackOff", 30),
		event("new", "default", "Normal", "Started", 5),
	)

	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), overviewListKinds(), objects...)
	result, err := NewService(fakeProvider{client: client}).Overview(context.Background(), OverviewRequest{ContextID: "context"})
	if err != nil {
		t.Fatal(err)
	}

	if result.Nodes != (OverviewCount{Total: 3, Ready: 2}) {
		t.Fatalf("nodes = %#v", result.Nodes)
	}
	if result.Pods != (OverviewCount{Total: 3, Ready: 2}) {
		t.Fatalf("pods = %#v", result.Pods)
	}
	if result.Namespaces != 2 || result.Services != 3 {
		t.Fatalf("namespaces=%d services=%d", result.Namespaces, result.Services)
	}

	// CPU is reported in milli-cores: 3 pods × 500m requested, 3 × 1000m
	// limited, 3 nodes × 4 cores allocatable.
	if result.Resource.CPU.Requested != 1500 || result.Resource.CPU.Limited != 3000 || result.Resource.CPU.Allocatable != 12000 {
		t.Fatalf("cpu usage = %#v", result.Resource.CPU)
	}
	// Memory is reported in bytes: 3 Gi requested, 6 Gi limited, 24 Gi allocatable.
	const gib = int64(1 << 30)
	if result.Resource.Memory.Requested != 3*gib || result.Resource.Memory.Limited != 6*gib || result.Resource.Memory.Allocatable != 24*gib {
		t.Fatalf("memory usage = %#v", result.Resource.Memory)
	}

	if len(result.Events) != 3 {
		t.Fatalf("events = %#v", result.Events)
	}
	if result.Events[0].Name != "new" || result.Events[1].Name != "mid" || result.Events[2].Name != "old" {
		t.Fatalf("events not newest-first: %#v", result.Events)
	}
	if result.Events[0].Reason != "Started" || result.Events[0].Type != "Normal" || result.Events[0].Count == nil || *result.Events[0].Count != 2 {
		t.Fatalf("event row = %#v", result.Events[0])
	}
}

func TestServiceOverviewBoundsEventsAndPages(t *testing.T) {
	// 25 events with distinct names (the fake tracker keys on name): the 20
	// newest survive the pool ranking, the five oldest fall off.
	objects := make([]runtime.Object, 0, 25)
	for i := 0; i < 25; i++ {
		event := testObject("v1", "Event", fmt.Sprintf("e-%d", i), "default")
		event.Object["lastTimestamp"] = time.Now().UTC().Add(-time.Duration(i) * time.Second).Format(time.RFC3339)
		objects = append(objects, event)
	}

	// Nodes page over a continue token so the two-page loop is exercised.
	var nodeListCalls int
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), overviewListKinds(), objects...)
	client.PrependReactor("list", "nodes", func(action clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "NodeList"})
		nodeListCalls++
		if nodeListCalls == 1 {
			list.SetContinue("next-page")
		}
		return true, list, nil
	})

	result, err := NewService(fakeProvider{client: client}).Overview(context.Background(), OverviewRequest{ContextID: "context"})
	if err != nil {
		t.Fatal(err)
	}
	if nodeListCalls != 2 {
		t.Fatalf("node list calls = %d, want 2", nodeListCalls)
	}
	if len(result.Events) != 20 {
		t.Fatalf("events = %d, want 20", len(result.Events))
	}
	// Newest first: e-0 is the freshest, e-19 the oldest survivor.
	if result.Events[0].Name != "e-0" || result.Events[19].Name != "e-19" {
		t.Fatalf("events[0]=%q events[19]=%q", result.Events[0].Name, result.Events[19].Name)
	}
}

func TestServiceOverviewRequiresContext(t *testing.T) {
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), overviewListKinds())
	if _, err := NewService(fakeProvider{client: client}).Overview(context.Background(), OverviewRequest{}); err == nil {
		t.Fatal("expected contextId validation error")
	}
}

func TestServiceOverviewFlagsTruncatedCounts(t *testing.T) {
	// Namespaces always carry a continue token so the page cap is hit: the
	// dashboard must report truncated instead of pretending 10k is the count.
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), overviewListKinds())
	var namespaceListCalls int
	client.PrependReactor("list", "namespaces", func(action clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{}
		list.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "NamespaceList"})
		namespaceListCalls++
		if namespaceListCalls < overviewMaxPages+1 {
			list.SetContinue("next-page")
		}
		return true, list, nil
	})

	result, err := NewService(fakeProvider{client: client}).Overview(context.Background(), OverviewRequest{ContextID: "context"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Truncated {
		t.Fatal("expected truncated flag when a kind hits the page cap")
	}
	if namespaceListCalls != overviewMaxPages {
		t.Fatalf("namespace list calls = %d, want %d", namespaceListCalls, overviewMaxPages)
	}
}

// overviewListKinds registers a list kind for every resource the fake client
// must LIST during an Overview call.
func overviewListKinds() map[schema.GroupVersionResource]string {
	return map[schema.GroupVersionResource]string{
		{Version: "v1", Resource: "nodes"}:      "NodeList",
		{Version: "v1", Resource: "pods"}:       "PodList",
		{Version: "v1", Resource: "namespaces"}: "NamespaceList",
		{Version: "v1", Resource: "services"}:   "ServiceList",
		{Version: "v1", Resource: "events"}:     "EventList",
	}
}
