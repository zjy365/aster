// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
)

// DiscoveryProvider lazily supplies a discovery client per context. Discovery
// results are cached for a short TTL per context — this is a one-shot document
// read, not an informer cache.
type DiscoveryProvider interface {
	Discovery(contextID string) (discovery.DiscoveryInterface, error)
}

type discoveryCacheEntry struct {
	resources []DiscoveredResource
	fetchedAt time.Time
}

const discoveryCacheTTL = 60 * time.Second

// Discover returns the custom (non-catalog) resources of a context. Partial
// discovery results are tolerated when some aggregated API is unavailable.
func (s *Service) Discover(ctx context.Context, contextID string) ([]DiscoveredResource, error) {
	if strings.TrimSpace(contextID) == "" {
		return nil, invalid("contextId is required")
	}
	s.mu.Lock()
	if entry, ok := s.discoveryCache[contextID]; ok && time.Since(entry.fetchedAt) < discoveryCacheTTL {
		resources := entry.resources
		s.mu.Unlock()
		return resources, nil
	}
	s.mu.Unlock()

	provider, ok := s.clients.(DiscoveryProvider)
	if !ok {
		return nil, invalid("discovery provider is unavailable")
	}
	client, err := provider.Discovery(contextID)
	if err != nil {
		return nil, err
	}
	_, resourceLists, err := client.ServerGroupsAndResources()
	if err != nil && !apierrors.IsForbidden(err) {
		if _, isPartial := err.(*discovery.ErrGroupDiscoveryFailed); !isPartial {
			return nil, err
		}
	}

	seen := make(map[string]bool)
	resources := make([]DiscoveredResource, 0)
	for _, list := range resourceLists {
		if list == nil {
			continue
		}
		groupVersion, parseErr := schema.ParseGroupVersion(list.GroupVersion)
		if parseErr != nil {
			continue
		}
		for _, item := range list.APIResources {
			if strings.Contains(item.Name, "/") || !hasVerb(item.Verbs, "list") {
				continue
			}
			groupKey := groupVersion.Group
			if groupKey == "" {
				groupKey = "core"
			}
			if _, known := resourceCatalog[groupKey+"/"+groupVersion.Version+"/"+item.Name]; known {
				continue
			}
			// One entry per API group resource: the preferred version comes first.
			groupResource := groupVersion.Group + "/" + item.Name
			if seen[groupResource] {
				continue
			}
			seen[groupResource] = true
			resources = append(resources, DiscoveredResource{
				Group:      groupVersion.Group,
				Version:    groupVersion.Version,
				Resource:   item.Name,
				Kind:       item.Kind,
				Namespaced: item.Namespaced,
			})
		}
	}

	s.mu.Lock()
	s.discoveryCache[contextID] = discoveryCacheEntry{resources: resources, fetchedAt: time.Now()}
	s.mu.Unlock()
	return resources, nil
}

// resolveGVR validates well-known resources against the static catalog and
// falls back to lazy per-context discovery for custom resources.
func (s *Service) resolveGVR(ctx context.Context, contextID string, value GVR) (schema.GroupVersionResource, resourceDefinition, error) {
	gvr, definition, err := validateGVR(value)
	if err == nil {
		return gvr, definition, nil
	}
	if _, ok := err.(*ValidationError); !ok {
		return schema.GroupVersionResource{}, resourceDefinition{}, err
	}
	if strings.TrimSpace(contextID) == "" {
		return schema.GroupVersionResource{}, resourceDefinition{}, err
	}
	discovered, discoverErr := s.Discover(ctx, contextID)
	if discoverErr != nil {
		return schema.GroupVersionResource{}, resourceDefinition{}, err
	}
	group := strings.TrimSpace(value.Group)
	version := strings.TrimSpace(value.Version)
	resource := strings.ToLower(strings.TrimSpace(value.Resource))
	for _, item := range discovered {
		if item.Group == group && item.Version == version && item.Resource == resource {
			return schema.GroupVersionResource{Group: item.Group, Version: item.Version, Resource: item.Resource}, resourceDefinition{
				Group:      item.Group,
				Version:    item.Version,
				Resource:   item.Resource,
				Kind:       item.Kind,
				Namespaced: item.Namespaced,
			}, nil
		}
	}
	return schema.GroupVersionResource{}, resourceDefinition{}, err
}

func hasVerb(verbs metav1.Verbs, verb string) bool {
	for _, candidate := range verbs {
		if candidate == verb || candidate == "*" {
			return true
		}
	}
	return false
}
