package resources

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

const (
	// overviewPageSize caps each list round-trip; the page loop then bounds
	// every kind at overviewMaxPages pages, so counts reflect at most 10k
	// objects. The overview is a snapshot for a dashboard, not an inventory,
	// so truncating past that is a documented approximation.
	overviewPageSize int64 = 500
	overviewMaxPages       = 20
	// Events are ranked by lastTimestamp after a bounded one-page fetch; the
	// pool cap keeps a busy cluster's event storm from dominating the request
	// and the renderer.
	overviewEventPool  = 500
	overviewEventLimit = 20
)

type OverviewRequest struct {
	ContextID string `json:"contextId"`
}

type OverviewCount struct {
	Total int64 `json:"total"`
	Ready int64 `json:"ready"`
}

type OverviewUsage struct {
	Requested   int64 `json:"requested"`
	Limited     int64 `json:"limited"`
	Allocatable int64 `json:"allocatable"`
}

type OverviewResource struct {
	CPU    OverviewUsage `json:"cpu"`
	Memory OverviewUsage `json:"memory"`
}

type OverviewEvent struct {
	Namespace     string     `json:"namespace,omitempty"`
	Name          string     `json:"name"`
	Reason        string     `json:"reason,omitempty"`
	Message       string     `json:"message,omitempty"`
	Type          string     `json:"type,omitempty"`
	Count         *int64     `json:"count,omitempty"`
	LastTimestamp *time.Time `json:"lastTimestamp,omitempty"`
}

type Overview struct {
	Nodes      OverviewCount    `json:"nodes"`
	Pods       OverviewCount    `json:"pods"`
	Namespaces int64            `json:"namespaces"`
	Services   int64            `json:"services"`
	Resource   OverviewResource `json:"resource"`
	Events     []OverviewEvent  `json:"events"`
}

// Overview snapshots the connected cluster for the dashboard: object counts
// with readiness, aggregate node capacity versus pod requests/limits, and the
// most recent events. The five kinds are fetched in parallel and each is
// cluster-scoped, so the numbers are independent of any namespace selection.
func (s *Service) Overview(ctx context.Context, request OverviewRequest) (Overview, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return Overview{}, invalid("contextId is required")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return Overview{}, err
	}

	var nodes, pods OverviewCount
	var namespaces, services int64
	var cpuAllocatable, memoryAllocatable, cpuRequested, memoryRequested, cpuLimited, memoryLimited resource.Quantity
	var events []OverviewEvent

	// Each goroutine owns the variables it writes, so the shared result needs
	// no lock; the buffered channel carries the first failing kind.
	errs := make(chan error, 5)
	var wg sync.WaitGroup
	run := func(collect func() error) {
		defer wg.Done()
		if err := collect(); err != nil {
			errs <- err
		}
	}
	wg.Add(5)

	go run(func() error {
		return s.listOverviewResource(ctx, client, schema.GroupVersionResource{Version: "v1", Resource: "nodes"}, overviewMaxPages, func(object *unstructured.Unstructured) error {
			nodes.Total++
			if project(object).Status == "Ready" {
				nodes.Ready++
			}
			allocatable, found, _ := unstructured.NestedStringMap(object.Object, "status", "allocatable")
			if found {
				addQuantity(&cpuAllocatable, allocatable["cpu"])
				addQuantity(&memoryAllocatable, allocatable["memory"])
			}
			return nil
		})
	})

	go run(func() error {
		return s.listOverviewResource(ctx, client, schema.GroupVersionResource{Version: "v1", Resource: "pods"}, overviewMaxPages, func(object *unstructured.Unstructured) error {
			pods.Total++
			if project(object).Status == "Running" {
				pods.Ready++
			}
			addContainerUsage(object.Object, &cpuRequested, &memoryRequested, &cpuLimited, &memoryLimited)
			return nil
		})
	})

	go run(func() error {
		return s.listOverviewResource(ctx, client, schema.GroupVersionResource{Version: "v1", Resource: "namespaces"}, overviewMaxPages, func(object *unstructured.Unstructured) error {
			namespaces++
			return nil
		})
	})

	go run(func() error {
		return s.listOverviewResource(ctx, client, schema.GroupVersionResource{Version: "v1", Resource: "services"}, overviewMaxPages, func(object *unstructured.Unstructured) error {
			services++
			return nil
		})
	})

	go run(func() error {
		if err := s.listOverviewResource(ctx, client, schema.GroupVersionResource{Version: "v1", Resource: "events"}, 1, func(object *unstructured.Unstructured) error {
			row := project(object)
			events = append(events, OverviewEvent{
				Namespace:     row.Namespace,
				Name:          row.Name,
				Reason:        row.Reason,
				Message:       row.Message,
				Type:          row.Type,
				Count:         row.Count,
				LastTimestamp: row.LastTimestamp,
			})
			return nil
		}); err != nil {
			return err
		}
		sort.SliceStable(events, func(i, j int) bool { return eventAfter(events[i], events[j]) })
		if events == nil {
			events = []OverviewEvent{}
		}
		if len(events) > overviewEventLimit {
			events = events[:overviewEventLimit]
		}
		return nil
	})

	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return Overview{}, err
		}
	}

	return Overview{
		Nodes:      nodes,
		Pods:       pods,
		Namespaces: namespaces,
		Services:   services,
		Resource: OverviewResource{
			CPU: OverviewUsage{
				Requested:   cpuRequested.MilliValue(),
				Limited:     cpuLimited.MilliValue(),
				Allocatable: cpuAllocatable.MilliValue(),
			},
			Memory: OverviewUsage{
				Requested:   memoryRequested.Value(),
				Limited:     memoryLimited.Value(),
				Allocatable: memoryAllocatable.Value(),
			},
		},
		Events: events,
	}, nil
}

// listOverviewResource pages a cluster-scoped resource up to maxPages pages.
// The kinds are core v1 resources, so their GVRs are hardcoded rather than
// resolved through discovery.
func (s *Service) listOverviewResource(ctx context.Context, client dynamic.Interface, gvr schema.GroupVersionResource, maxPages int, collect func(*unstructured.Unstructured) error) error {
	resource := client.Resource(gvr)
	continueToken := ""
	for page := 0; page < maxPages; page++ {
		list, err := resource.List(ctx, metav1.ListOptions{Limit: overviewPageSize, Continue: continueToken})
		if err != nil {
			return err
		}
		for index := range list.Items {
			if err := collect(&list.Items[index]); err != nil {
				return err
			}
		}
		continueToken = list.GetContinue()
		if continueToken == "" {
			return nil
		}
	}
	return nil
}

// addContainerUsage accumulates requests and limits across regular and init
// containers, matching how the scheduler accounts for pod resource usage.
func addContainerUsage(object map[string]any, cpuRequested, memoryRequested, cpuLimited, memoryLimited *resource.Quantity) {
	for _, fields := range [][]string{{"spec", "containers"}, {"spec", "initContainers"}} {
		containers, found, _ := unstructured.NestedSlice(object, fields...)
		if !found {
			continue
		}
		for _, raw := range containers {
			container, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			addResourceFields(container, "requests", cpuRequested, memoryRequested)
			addResourceFields(container, "limits", cpuLimited, memoryLimited)
		}
	}
}

func addResourceFields(container map[string]any, key string, cpuTarget, memoryTarget *resource.Quantity) {
	values, found, _ := unstructured.NestedStringMap(container, "resources", key)
	if !found {
		return
	}
	addQuantity(cpuTarget, values["cpu"])
	addQuantity(memoryTarget, values["memory"])
}

func addQuantity(target *resource.Quantity, value string) {
	if value == "" {
		return
	}
	parsed, err := resource.ParseQuantity(value)
	if err != nil {
		return
	}
	target.Add(parsed)
}

// eventAfter orders overview events newest-first; events without a timestamp
// sort last so they never displace one that has one.
func eventAfter(a, b OverviewEvent) bool {
	if a.LastTimestamp == nil {
		return false
	}
	if b.LastTimestamp == nil {
		return true
	}
	return a.LastTimestamp.After(*b.LastTimestamp)
}
