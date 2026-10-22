// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Pod metrics via metrics.k8s.io, accessed directly by GVR — the metrics API
// is not part of the resource catalog and never goes through discovery.

var (
	podsMetricsGVR  = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}
	nodesMetricsGVR = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}
)

func (s *Service) PodMetrics(ctx context.Context, request MetricsRequest) (MetricsResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return MetricsResponse{}, invalid("contextId is required")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return MetricsResponse{}, err
	}
	// metrics.k8s.io may page large clusters like any other list endpoint;
	// follow continue tokens so usage columns do not silently disappear past
	// the first page.
	response := MetricsResponse{Pods: make([]PodMetric, 0)}
	continueToken := ""
	pages := 0
	for {
		pages++
		if pages > maxMetricsPages {
			return MetricsResponse{}, fmt.Errorf("pod metrics exceeded %d pages", maxMetricsPages)
		}
		options := metav1.ListOptions{Limit: maxPageSize, Continue: continueToken}
		var list *unstructured.UnstructuredList
		if request.Namespace == "" {
			list, err = client.Resource(podsMetricsGVR).List(ctx, options)
		} else {
			list, err = client.Resource(podsMetricsGVR).Namespace(request.Namespace).List(ctx, options)
		}
		if err != nil {
			return MetricsResponse{}, err
		}
		for index := range list.Items {
			item := &list.Items[index]
			metric := PodMetric{Name: item.GetName(), Namespace: item.GetNamespace()}
			containers, _, _ := unstructured.NestedSlice(item.Object, "containers")
			for _, raw := range containers {
				container, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				name, _ := container["name"].(string)
				usage, _, _ := unstructured.NestedStringMap(container, "usage")
				metric.Containers = append(metric.Containers, ContainerMetric{
					Name:   strings.TrimSpace(name),
					CPU:    usage["cpu"],
					Memory: usage["memory"],
				})
			}
			response.Pods = append(response.Pods, metric)
		}
		continueToken = list.GetContinue()
		if continueToken == "" {
			break
		}
	}
	return response, nil
}

// maxMetricsPages bounds pagination so a broken API server that loops the
// same continue token cannot spin the request forever. At 5000 per page this
// covers 100k pods, matching the overview snapshot ceiling.
const maxMetricsPages = 20

// NodeMetrics lists current per-node CPU/memory usage from metrics.k8s.io.
// Nodes are cluster-scoped, so there is no namespace branch; pagination and
// the missing-Metrics-Server error path are shared with PodMetrics, and a
// cluster without the metrics API surfaces as the same stable error.
func (s *Service) NodeMetrics(ctx context.Context, request NodeMetricsRequest) (NodeMetricsResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return NodeMetricsResponse{}, invalid("contextId is required")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return NodeMetricsResponse{}, err
	}
	response := NodeMetricsResponse{Nodes: make([]NodeMetric, 0)}
	continueToken := ""
	pages := 0
	for {
		pages++
		if pages > maxMetricsPages {
			return NodeMetricsResponse{}, fmt.Errorf("node metrics exceeded %d pages", maxMetricsPages)
		}
		options := metav1.ListOptions{Limit: maxPageSize, Continue: continueToken}
		list, err := client.Resource(nodesMetricsGVR).List(ctx, options)
		if err != nil {
			return NodeMetricsResponse{}, err
		}
		for index := range list.Items {
			item := &list.Items[index]
			usage, _, _ := unstructured.NestedStringMap(item.Object, "usage")
			metric := NodeMetric{
				Name:   item.GetName(),
				CPU:    usage["cpu"],
				Memory: usage["memory"],
			}
			metric.Window, _, _ = unstructured.NestedString(item.Object, "window")
			metric.Timestamp, _, _ = unstructured.NestedString(item.Object, "timestamp")
			response.Nodes = append(response.Nodes, metric)
		}
		continueToken = list.GetContinue()
		if continueToken == "" {
			break
		}
	}
	return response, nil
}
