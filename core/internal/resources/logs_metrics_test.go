// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"fmt"
	"io"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

func TestStreamLogsDeliversLinesAndCloses(t *testing.T) {
	provider := fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), logs: "line one\nline two\n"}
	service := NewService(provider)
	lines, err := service.StreamLogs(context.Background(), LogsRequest{ContextID: "context", Namespace: "apps", Name: "web"})
	if err != nil {
		t.Fatal(err)
	}
	var texts []string
	for line := range lines {
		if line.Type == "error" {
			t.Fatalf("unexpected stream error: %s", line.Message)
		}
		texts = append(texts, line.Text)
	}
	if strings.Join(texts, ",") != "line one,line two" {
		t.Fatalf("lines=%v", texts)
	}

	if _, err := service.StreamLogs(context.Background(), LogsRequest{ContextID: "context", Namespace: "apps"}); err == nil {
		t.Fatal("missing pod name was accepted")
	}
}

func TestLogsAttachContainersAndPassOptions(t *testing.T) {
	provider := &recordingLogsProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), logs: "line\n"}}
	service := NewService(provider)
	result, err := service.Logs(context.Background(), LogsRequest{
		ContextID: "context", Namespace: "apps", Name: "web", Container: "app",
		TailLines: 100, Previous: true, Timestamps: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Containers) != 2 || result.Containers[0] != "app" || result.Containers[1] != "init" {
		t.Fatalf("containers=%v", result.Containers)
	}
	if !provider.previous || !provider.timestamps || provider.container != "app" || provider.tail != 100 {
		t.Fatalf("forwarded options container=%q tail=%d previous=%v timestamps=%v", provider.container, provider.tail, provider.previous, provider.timestamps)
	}
}

type recordingLogsProvider struct {
	fakeProvider
	container  string
	tail       int64
	previous   bool
	timestamps bool
}

func (f *recordingLogsProvider) PodLogs(_ context.Context, _, _, _, container string, tailLines int64, previous, timestamps bool) (io.ReadCloser, error) {
	f.container, f.tail, f.previous, f.timestamps = container, tailLines, previous, timestamps
	return io.NopCloser(strings.NewReader(f.logs)), nil
}

func (f *recordingLogsProvider) PodContainers(context.Context, string, string, string) ([]string, error) {
	return []string{"app", "init"}, nil
}

func TestPodMetrics(t *testing.T) {
	podMetric := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "PodMetrics",
		"metadata":   map[string]any{"name": "web-x1", "namespace": "apps"},
		"containers": []any{
			map[string]any{"name": "app", "usage": map[string]any{"cpu": "12m", "memory": "48Mi"}},
		},
	}}
	gvr := schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "PodMetricsList"})
	// The fake tracker guesses "podmetrics" from the kind, so serve the list directly.
	client.PrependReactor("list", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{Object: map[string]any{"apiVersion": "metrics.k8s.io/v1beta1", "kind": "PodMetricsList"}}
		list.Items = []unstructured.Unstructured{*podMetric}
		return true, list, nil
	})
	service := NewService(fakeProvider{client: client})

	response, err := service.PodMetrics(context.Background(), MetricsRequest{ContextID: "context", Namespace: "apps"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Pods) != 1 || response.Pods[0].Containers[0].CPU != "12m" || response.Pods[0].Containers[0].Memory != "48Mi" {
		t.Fatalf("metrics=%#v", response.Pods)
	}
}

func TestPodMetricsFollowsPagination(t *testing.T) {
	first := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "PodMetrics",
		"metadata":   map[string]any{"name": "web-a", "namespace": "apps"},
		"containers": []any{map[string]any{"name": "app", "usage": map[string]any{"cpu": "1m", "memory": "1Mi"}}},
	}}
	second := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "PodMetrics",
		"metadata":   map[string]any{"name": "web-b", "namespace": "apps"},
		"containers": []any{map[string]any{"name": "app", "usage": map[string]any{"cpu": "2m", "memory": "2Mi"}}},
	}}
	gvr := schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "PodMetricsList"})
	pages := [][]unstructured.Unstructured{{*first}, {*second}}
	client.PrependReactor("list", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{Object: map[string]any{"apiVersion": "metrics.k8s.io/v1beta1", "kind": "PodMetricsList"}}
		listAction, ok := action.(clienttesting.ListActionImpl)
		if !ok {
			return true, list, nil
		}
		token := listAction.ListOptions.Continue
		index := 0
		if token == "page-1" {
			index = 1
		}
		if index >= len(pages) {
			return true, list, nil
		}
		list.Items = pages[index]
		if index < len(pages)-1 {
			list.SetContinue(fmt.Sprintf("page-%d", index+1))
		}
		return true, list, nil
	})
	service := NewService(fakeProvider{client: client})

	response, err := service.PodMetrics(context.Background(), MetricsRequest{ContextID: "context", Namespace: "apps"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Pods) != 2 || response.Pods[0].Name != "web-a" || response.Pods[1].Name != "web-b" {
		t.Fatalf("expected both pages collected, got %#v", response.Pods)
	}
}

func TestNodeMetrics(t *testing.T) {
	nodeMetric := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "NodeMetrics",
		"metadata":   map[string]any{"name": "worker-1"},
		"timestamp":  "2026-10-17T00:00:00Z",
		"window":     "30s",
		"usage":      map[string]any{"cpu": "62110470n", "memory": "8388608Ki"},
	}}
	gvr := schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "NodeMetricsList"})
	client.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{Object: map[string]any{"apiVersion": "metrics.k8s.io/v1beta1", "kind": "NodeMetricsList"}}
		list.Items = []unstructured.Unstructured{*nodeMetric}
		return true, list, nil
	})
	service := NewService(fakeProvider{client: client})

	response, err := service.NodeMetrics(context.Background(), NodeMetricsRequest{ContextID: "context"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Nodes) != 1 {
		t.Fatalf("nodes=%#v", response.Nodes)
	}
	node := response.Nodes[0]
	if node.Name != "worker-1" || node.CPU != "62110470n" || node.Memory != "8388608Ki" || node.Window != "30s" || node.Timestamp != "2026-10-17T00:00:00Z" {
		t.Fatalf("node=%#v", node)
	}

	if _, err := service.NodeMetrics(context.Background(), NodeMetricsRequest{}); err == nil {
		t.Fatal("missing contextId was accepted")
	}
}

func TestNodeMetricsFollowsPagination(t *testing.T) {
	first := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "NodeMetrics",
		"metadata":   map[string]any{"name": "worker-a"},
		"usage":      map[string]any{"cpu": "100m", "memory": "1Gi"}},
	}
	second := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "metrics.k8s.io/v1beta1",
		"kind":       "NodeMetrics",
		"metadata":   map[string]any{"name": "worker-b"},
		"usage":      map[string]any{"cpu": "200m", "memory": "2Gi"}},
	}
	gvr := schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}
	client := fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{gvr: "NodeMetricsList"})
	// The fake dynamic client drops Continue from cluster-scoped list actions,
	// so pages key off the call count instead of the token; the service must
	// still issue the second request because page one returned a token.
	calls := 0
	client.PrependReactor("list", "nodes", func(clienttesting.Action) (bool, runtime.Object, error) {
		list := &unstructured.UnstructuredList{Object: map[string]any{"apiVersion": "metrics.k8s.io/v1beta1", "kind": "NodeMetricsList"}}
		switch calls {
		case 0:
			list.Items = []unstructured.Unstructured{*first}
			list.SetContinue("page-1")
		case 1:
			list.Items = []unstructured.Unstructured{*second}
		}
		calls++
		return true, list, nil
	})
	service := NewService(fakeProvider{client: client})

	response, err := service.NodeMetrics(context.Background(), NodeMetricsRequest{ContextID: "context"})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("expected the continue token to drive a second page, calls=%d", calls)
	}
	if len(response.Nodes) != 2 || response.Nodes[0].Name != "worker-a" || response.Nodes[1].Name != "worker-b" {
		t.Fatalf("expected both pages collected, got %#v", response.Nodes)
	}
}
