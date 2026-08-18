// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Aggregated workload logs: one stream merged from the pods a Deployment,
// StatefulSet, DaemonSet, or Job selects. Pod fan-out is capped — past a
// handful of replicas an interleaved stream stops being readable, so the
// viewer samples the newest pods and says so.

const workloadMaxPods = 5
const workloadMaxLineLength = followMaxLineLength

var workloadLogGVRs = map[string]GVR{
	"Deployment":  {Group: "apps", Version: "v1", Resource: "deployments"},
	"StatefulSet": {Group: "apps", Version: "v1", Resource: "statefulsets"},
	"DaemonSet":   {Group: "apps", Version: "v1", Resource: "daemonsets"},
	"Job":         {Group: "batch", Version: "v1", Resource: "jobs"},
}

func (s *Service) WorkloadLogs(ctx context.Context, request WorkloadLogsRequest) (WorkloadLogsResponse, error) {
	provider, ok := s.clients.(LogsProvider)
	if !ok {
		return WorkloadLogsResponse{}, invalid("logs provider is unavailable")
	}
	pods, note, err := s.resolveWorkloadPods(ctx, request)
	if err != nil {
		return WorkloadLogsResponse{}, err
	}
	if len(pods) == 0 {
		return WorkloadLogsResponse{Note: "the workload currently has no pods"}, nil
	}

	tail := request.TailLines
	if tail <= 0 || tail > 100_000 {
		tail = 2_000
	}
	// Timestamps are forced on: they are the merge key, and the renderer
	// formats or hides them client-side.
	type podLines struct {
		pod   string
		lines []string
	}
	results := make([]podLines, len(pods))
	truncated := false
	var wait sync.WaitGroup
	for index, pod := range pods {
		wait.Add(1)
		go func() {
			defer wait.Done()
			reader, err := provider.PodLogs(ctx, request.ContextID, request.Namespace, pod, request.Container, tail, false, true)
			if err != nil {
				results[index] = podLines{pod, []string{fmt.Sprintf("! failed to read logs: %v", err)}}
				return
			}
			defer reader.Close()
			const perPodMax = 1 << 20
			value, readErr := io.ReadAll(io.LimitReader(reader, perPodMax+1))
			if readErr != nil {
				results[index] = podLines{pod, []string{fmt.Sprintf("! failed to read logs: %v", readErr)}}
				return
			}
			if len(value) > perPodMax {
				truncated = true
				value = value[:perPodMax]
			}
			results[index] = podLines{pod, strings.Split(strings.TrimRight(string(value), "\n"), "\n")}
		}()
	}
	wait.Wait()

	merged := make([]WorkloadLogLine, 0, 256)
	for _, result := range results {
		for _, line := range result.lines {
			if line == "" {
				continue
			}
			if len(line) > workloadMaxLineLength {
				line = strings.TrimSpace(line[:workloadMaxLineLength]) + "…"
			}
			merged = append(merged, WorkloadLogLine{Pod: result.pod, Text: line})
		}
	}
	sort.SliceStable(merged, func(a, b int) bool {
		return logLineSortKey(merged[a].Text) < logLineSortKey(merged[b].Text)
	})
	// Aggregate byte budget mirrors the pod logs cap.
	const maxBytes = 4 << 20
	total := 0
	cut := 0
	for index := len(merged) - 1; index >= 0; index-- {
		total += len(merged[index].Text)
		if total > maxBytes {
			cut = index + 1
			truncated = true
			break
		}
	}
	merged = merged[cut:]

	response := WorkloadLogsResponse{Lines: merged, Pods: pods, Truncated: truncated, Note: note}
	if containers, ok := s.clients.(PodContainersProvider); ok {
		if names, err := containers.PodContainers(ctx, request.ContextID, request.Namespace, pods[0]); err == nil {
			response.Containers = names
		}
	}
	return response, nil
}

func (s *Service) StreamWorkloadLogs(ctx context.Context, request WorkloadLogsRequest) (<-chan LogLine, error) {
	provider, ok := s.clients.(LogsFollowProvider)
	if !ok {
		return nil, invalid("logs follow provider is unavailable")
	}
	pods, note, err := s.resolveWorkloadPods(ctx, request)
	if err != nil {
		return nil, err
	}
	if len(pods) == 0 {
		return nil, invalid("the workload currently has no pods")
	}
	tail := request.TailLines
	if tail <= 0 || tail > 100_000 {
		tail = followDefaultTail
	}

	lines := make(chan LogLine, 256)
	if note != "" {
		lines <- LogLine{Type: "note", Message: note}
	}
	var wait sync.WaitGroup
	started := 0
	for _, pod := range pods {
		reader, err := provider.PodLogsFollow(ctx, request.ContextID, request.Namespace, pod, request.Container, tail, false, true)
		if err != nil {
			// One evicted or pending pod must not kill the aggregate stream.
			lines <- LogLine{Type: "error", Pod: pod, Message: err.Error()}
			continue
		}
		started++
		wait.Add(1)
		go func(pod string, reader io.ReadCloser) {
			defer wait.Done()
			defer reader.Close()
			scanLogLines(ctx, reader, pod, lines)
		}(pod, reader)
	}
	if started == 0 {
		close(lines)
		return nil, invalid("no pod log streams could be opened")
	}
	go func() {
		wait.Wait()
		close(lines)
	}()
	return lines, nil
}

// resolveWorkloadPods lists the pods selected by the workload, newest first,
// capped at workloadMaxPods. The note tells the viewer when sampling cut in.
func (s *Service) resolveWorkloadPods(ctx context.Context, request WorkloadLogsRequest) ([]string, string, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return nil, "", invalid("contextId, namespace and name are required")
	}
	gvr, ok := workloadLogGVRs[request.Kind]
	if !ok {
		return nil, "", invalid(fmt.Sprintf("logs are not supported for %s", request.Kind))
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return nil, "", err
	}
	workload, err := client.Resource(schema.GroupVersionResource(gvr)).Namespace(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("get %s %q: %w", request.Kind, request.Name, err)
	}

	selector, _, _ := unstructured.NestedStringMap(workload.Object, "spec", "selector", "matchLabels")
	if len(selector) == 0 && request.Kind == "Job" {
		selector = map[string]string{"batch.kubernetes.io/job-name": request.Name}
	}
	if len(selector) == 0 {
		return nil, "", invalid(fmt.Sprintf("%s %q has no label selector", request.Kind, request.Name))
	}

	pods, err := client.Resource(schema.GroupVersionResource{Version: "v1", Resource: "pods"}).Namespace(request.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labels.SelectorFromSet(selector).String(),
	})
	if err != nil {
		return nil, "", fmt.Errorf("list pods for %s %q: %w", request.Kind, request.Name, err)
	}
	sort.SliceStable(pods.Items, func(a, b int) bool {
		return pods.Items[a].GetCreationTimestamp().After(pods.Items[b].GetCreationTimestamp().Time)
	})
	names := make([]string, 0, workloadMaxPods)
	for _, pod := range pods.Items {
		names = append(names, pod.GetName())
		if len(names) == workloadMaxPods {
			break
		}
	}
	note := ""
	if len(pods.Items) > workloadMaxPods {
		note = fmt.Sprintf("showing the newest %d of %d pods; scale down or view a single pod for full coverage", workloadMaxPods, len(pods.Items))
	}
	return names, note, nil
}

// logLineSortKey extracts the leading RFC3339 timestamp the Kubernetes logs
// API prepends; lines without one sort to the end, keeping input order.
func logLineSortKey(line string) string {
	if index := strings.IndexByte(line, ' '); index > 0 {
		return line[:index]
	}
	return "~"
}
