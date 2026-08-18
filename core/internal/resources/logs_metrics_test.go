// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
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
