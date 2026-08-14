// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Pod metrics via metrics.k8s.io, accessed directly by GVR — the metrics API
// is not part of the resource catalog and never goes through discovery.

var podsMetricsGVR = schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}

func (s *Service) PodMetrics(ctx context.Context, request MetricsRequest) (MetricsResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return MetricsResponse{}, invalid("contextId is required")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return MetricsResponse{}, err
	}
	var list *unstructured.UnstructuredList
	if request.Namespace == "" {
		list, err = client.Resource(podsMetricsGVR).List(ctx, metav1.ListOptions{Limit: maxPageSize})
	} else {
		list, err = client.Resource(podsMetricsGVR).Namespace(request.Namespace).List(ctx, metav1.ListOptions{Limit: maxPageSize})
	}
	if err != nil {
		return MetricsResponse{}, err
	}
	response := MetricsResponse{Pods: make([]PodMetric, 0, len(list.Items))}
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
	return response, nil
}
