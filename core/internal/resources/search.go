// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
)

// Search queries the enabled resource kinds by name substring. It fans out
// bounded list calls (page size 100 per kind) directly to the API server —
// deliberately no informer and no cache. Only namespaced kinds are searched,
// and only within the given namespace: a cluster-scoped kind (nodes,
// namespaces, PVs, storage classes, RBAC) has no bound short of the whole
// cluster, so searching it would list tens of thousands of objects per query
// in a 100k-namespace cluster for results the palette does not need.

const searchPerKindLimit = 100
const searchMaxResults = 50

func (s *Service) Search(ctx context.Context, request SearchRequest) (SearchResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return SearchResponse{}, invalid("contextId is required")
	}
	query := strings.ToLower(strings.TrimSpace(request.Query))
	if query == "" {
		return SearchResponse{}, invalid("query is required")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return SearchResponse{}, err
	}

	results := make([]RelatedResource, 0, searchMaxResults)
	var mu sync.Mutex
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 4)

	for _, definition := range resourceCatalog {
		if definition.Resource == "events" || definition.Resource == "replicasets" {
			continue
		}
		if !definition.Namespaced || request.Namespace == "" {
			continue
		}
		definition := definition
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			gvr, resolved, resolveErr := s.resolveGVR(ctx, request.ContextID, GVR{Group: definition.Group, Version: definition.Version, Resource: definition.Resource})
			if resolveErr != nil {
				return
			}
			var target dynamic.ResourceInterface = client.Resource(gvr)
			if resolved.Namespaced {
				target = client.Resource(gvr).Namespace(request.Namespace)
			}
			list, listErr := target.List(ctx, metav1.ListOptions{Limit: searchPerKindLimit})
			if listErr != nil {
				return
			}
			for index := range list.Items {
				item := &list.Items[index]
				if !strings.Contains(strings.ToLower(item.GetName()), query) {
					continue
				}
				mu.Lock()
				if len(results) < searchMaxResults {
					results = append(results, RelatedResource{
						Group: resolved.Group, Version: resolved.Version, Resource: resolved.Resource,
						Kind: resolved.Kind, Namespace: item.GetNamespace(), Name: item.GetName(), Relation: "match",
					})
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return SearchResponse{Results: results}, nil
}
