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
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
)

type workloadLogsProvider struct {
	client    dynamic.Interface
	logs      map[string]string
	failAfter map[string]bool
}

func (f workloadLogsProvider) Client(string) (dynamic.Interface, error) { return f.client, nil }

func (f workloadLogsProvider) PodLogs(_ context.Context, _, _, name, _ string, _ int64, _, _ bool) (io.ReadCloser, error) {
	text, ok := f.logs[name]
	if !ok {
		return nil, fmt.Errorf("pod %q not found", name)
	}
	return io.NopCloser(strings.NewReader(text)), nil
}

func (f workloadLogsProvider) PodLogsFollow(_ context.Context, _, _, name, _ string, _ int64, _, _ bool) (io.ReadCloser, error) {
	if f.failAfter[name] {
		return nil, fmt.Errorf("pod %q was evicted", name)
	}
	return f.PodLogs(context.Background(), "", "", name, "", 0, false, false)
}

func workloadFixture(podCount int) dynamic.Interface {
	scheme := runtime.NewScheme()
	deployment := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata":   map[string]any{"name": "web", "namespace": "apps"},
		"spec":       map[string]any{"selector": map[string]any{"matchLabels": map[string]any{"app": "web"}}},
	}}
	objects := []runtime.Object{deployment}
	for index := 0; index < podCount; index++ {
		pod := &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]any{
				"name":              fmt.Sprintf("web-%d", index),
				"namespace":         "apps",
				"labels":            map[string]any{"app": "web"},
				"creationTimestamp": fmt.Sprintf("2026-08-17T08:00:%02dZ", index),
			},
		}}
		objects = append(objects, pod)
	}
	listKinds := map[schema.GroupVersionResource]string{
		{Version: "v1", Resource: "pods"}: "PodList",
	}
	return fake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, objects...)
}

func TestWorkloadLogsMergeSortedByTimestamp(t *testing.T) {
	provider := workloadLogsProvider{
		client: workloadFixture(2),
		logs: map[string]string{
			"web-0": "2026-08-17T08:45:01.0Z first\n2026-08-17T08:45:03.0Z third\n",
			"web-1": "2026-08-17T08:45:02.0Z second\n",
		},
	}
	service := NewService(provider)
	result, err := service.WorkloadLogs(context.Background(), WorkloadLogsRequest{
		ContextID: "context", Namespace: "apps", Kind: "Deployment", Name: "web", TailLines: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 3 {
		t.Fatalf("lines=%v", result.Lines)
	}
	got := []string{result.Lines[0].Text, result.Lines[1].Text, result.Lines[2].Text}
	if !strings.HasSuffix(got[0], "first") || !strings.HasSuffix(got[1], "second") || !strings.HasSuffix(got[2], "third") {
		t.Fatalf("merge order=%v", got)
	}
	if result.Lines[0].Pod != "web-0" || result.Lines[1].Pod != "web-1" {
		t.Fatalf("pod tags=%v", result.Lines)
	}
	if len(result.Pods) != 2 || result.Truncated || result.Note != "" {
		t.Fatalf("pods=%v truncated=%v note=%q", result.Pods, result.Truncated, result.Note)
	}
}

func TestWorkloadLogsCapsPodsAndNotesSampling(t *testing.T) {
	logs := map[string]string{}
	for index := 0; index < 7; index++ {
		logs[fmt.Sprintf("web-%d", index)] = "2026-08-17T08:45:01.0Z line\n"
	}
	service := NewService(workloadLogsProvider{client: workloadFixture(7), logs: logs})
	result, err := service.WorkloadLogs(context.Background(), WorkloadLogsRequest{
		ContextID: "context", Namespace: "apps", Kind: "Deployment", Name: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Pods) != workloadMaxPods {
		t.Fatalf("pods=%v", result.Pods)
	}
	// Newest first: web-6 has the latest creationTimestamp.
	if result.Pods[0] != "web-6" {
		t.Fatalf("newest pod first: %v", result.Pods)
	}
	if !strings.Contains(result.Note, "5 of 7") {
		t.Fatalf("note=%q", result.Note)
	}
}

func TestWorkloadLogsRejectsUnsupportedKindsAndMissingPods(t *testing.T) {
	service := NewService(workloadLogsProvider{client: workloadFixture(1)})
	if _, err := service.WorkloadLogs(context.Background(), WorkloadLogsRequest{
		ContextID: "context", Namespace: "apps", Kind: "Pod", Name: "web-0",
	}); err == nil {
		t.Fatal("Pod kind was accepted for workload logs")
	}
	if _, err := service.WorkloadLogs(context.Background(), WorkloadLogsRequest{
		ContextID: "context", Namespace: "apps", Kind: "Deployment", Name: "ghost",
	}); err == nil {
		t.Fatal("missing workload was accepted")
	}
}

func TestStreamWorkloadLogsTagsPodsAndIsolatesFailures(t *testing.T) {
	service := NewService(workloadLogsProvider{
		client: workloadFixture(2),
		logs: map[string]string{
			"web-0": "2026-08-17T08:45:01.0Z ok\n",
		},
		failAfter: map[string]bool{"web-1": true},
	})
	lines, err := service.StreamWorkloadLogs(context.Background(), WorkloadLogsRequest{
		ContextID: "context", Namespace: "apps", Kind: "Deployment", Name: "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	var sawLine, sawError bool
	for line := range lines {
		if line.Type == "line" {
			sawLine = true
			if line.Pod == "" {
				t.Fatal("streamed line lost its pod tag")
			}
		}
		if line.Type == "error" && strings.Contains(line.Message, "evicted") {
			sawError = true
			if line.Pod != "web-1" {
				t.Fatalf("error pod tag=%q", line.Pod)
			}
		}
	}
	if !sawLine || !sawError {
		t.Fatalf("sawLine=%v sawError=%v", sawLine, sawError)
	}
}
