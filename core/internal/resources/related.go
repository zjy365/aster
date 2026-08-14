// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Related performs bounded, lazy relationship queries for one object. Every
// query is a plain list/get against the API server — no informers, no caches.
// Relations: owner / owned (ownerReferences by UID), uses (pod template
// references), selects / selected-by (Service selector matching).

var ownedKinds = []GVR{
	{Group: "apps", Version: "v1", Resource: "replicasets"},
	{Version: "v1", Resource: "pods"},
}

func (s *Service) Related(ctx context.Context, request GetRequest) (RelatedResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return RelatedResponse{}, invalid("contextId is required")
	}
	if strings.TrimSpace(request.Name) == "" {
		return RelatedResponse{}, invalid("name is required")
	}
	gvr, definition, err := s.resolveGVR(ctx, request.ContextID, request.GVR)
	if err != nil {
		return RelatedResponse{}, err
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return RelatedResponse{}, err
	}
	target := client.Resource(gvr)
	var object *unstructured.Unstructured
	if definition.Namespaced {
		if request.Namespace == "" {
			return RelatedResponse{}, invalid("namespace is required")
		}
		object, err = target.Namespace(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
	} else {
		object, err = target.Get(ctx, request.Name, metav1.GetOptions{})
	}
	if err != nil {
		return RelatedResponse{}, err
	}

	related := make([]RelatedResource, 0)
	seen := make(map[string]bool)
	add := func(group, version, resource, kind, namespace, name, relation string) {
		key := relation + "|" + group + "/" + version + "/" + resource + "|" + namespace + "/" + name
		if seen[key] || name == "" {
			return
		}
		seen[key] = true
		related = append(related, RelatedResource{
			Group: group, Version: version, Resource: resource, Kind: kind,
			Namespace: namespace, Name: name, Relation: relation,
		})
	}

	uid := string(object.GetUID())
	namespace := object.GetNamespace()

	// Owners from ownerReferences.
	for _, reference := range object.GetOwnerReferences() {
		_, ownerDefinition, resolveErr := s.resolveKind(ctx, request.ContextID, reference.APIVersion, reference.Kind)
		if resolveErr != nil {
			continue
		}
		add(ownerDefinition.Group, ownerDefinition.Version, ownerDefinition.Resource, reference.Kind, namespace, reference.Name, "owner")
	}

	// Owned children: bounded candidate lists filtered by owner UID.
	for _, candidate := range ownedKinds {
		candidateGVR, candidateDefinition, resolveErr := s.resolveGVR(ctx, request.ContextID, candidate)
		if resolveErr != nil {
			continue
		}
		var list *unstructured.UnstructuredList
		var listErr error
		candidateResource := client.Resource(candidateGVR)
		if candidateDefinition.Namespaced {
			if namespace == "" {
				continue
			}
			list, listErr = candidateResource.Namespace(namespace).List(ctx, metav1.ListOptions{Limit: maxPageSize})
		} else {
			list, listErr = candidateResource.List(ctx, metav1.ListOptions{Limit: maxPageSize})
		}
		if listErr != nil {
			continue
		}
		for index := range list.Items {
			item := &list.Items[index]
			for _, reference := range item.GetOwnerReferences() {
				if string(reference.UID) == uid {
					add(candidateDefinition.Group, candidateDefinition.Version, candidateDefinition.Resource, candidateDefinition.Kind, item.GetNamespace(), item.GetName(), "owned")
				}
			}
		}
	}

	// Pod template references for workloads and pods.
	template, hasTemplate := podTemplate(object)
	if hasTemplate {
		for _, reference := range podTemplateReferences(template) {
			if _, _, resolveErr := s.resolveGVR(ctx, request.ContextID, GVR{Version: "v1", Resource: reference.resource}); resolveErr != nil {
				continue
			}
			add("", "v1", reference.resource, reference.kind, namespace, reference.name, "uses")
		}
		// Services selecting this workload's pods.
		if namespace != "" {
			servicesGVR, _, resolveErr := s.resolveGVR(ctx, request.ContextID, GVR{Version: "v1", Resource: "services"})
			if resolveErr == nil {
				labels, _, _ := unstructured.NestedStringMap(template.Object, "metadata", "labels")
				if len(labels) > 0 {
					services, listErr := client.Resource(servicesGVR).Namespace(namespace).List(ctx, metav1.ListOptions{Limit: maxPageSize})
					if listErr == nil {
						for index := range services.Items {
							service := &services.Items[index]
							selector, _, _ := unstructured.NestedStringMap(service.Object, "spec", "selector")
							if selectorMatches(selector, labels) {
								add("", "v1", "services", "Service", namespace, service.GetName(), "selected-by")
							}
						}
					}
				}
			}
		}
	}

	return RelatedResponse{Related: related}, nil
}

type templateReference struct {
	resource string
	kind     string
	name     string
}

func podTemplate(object *unstructured.Unstructured) (*unstructured.Unstructured, bool) {
	if object.GetKind() == "Pod" {
		return object, true
	}
	template, found, _ := unstructured.NestedMap(object.Object, "spec", "template")
	if found {
		return &unstructured.Unstructured{Object: template}, true
	}
	// CronJob keeps the template one level deeper.
	template, found, _ = unstructured.NestedMap(object.Object, "spec", "jobTemplate", "spec", "template")
	if found {
		return &unstructured.Unstructured{Object: template}, true
	}
	return nil, false
}

func podTemplateReferences(template *unstructured.Unstructured) []templateReference {
	references := make([]templateReference, 0)
	seen := make(map[string]bool)
	add := func(resource, kind, name string) {
		key := resource + "/" + name
		if name == "" || seen[key] {
			return
		}
		seen[key] = true
		references = append(references, templateReference{resource: resource, kind: kind, name: name})
	}
	if account, _, _ := unstructured.NestedString(template.Object, "spec", "serviceAccountName"); account != "" {
		add("serviceaccounts", "ServiceAccount", account)
	}
	volumes, _, _ := unstructured.NestedSlice(template.Object, "spec", "volumes")
	for _, raw := range volumes {
		volume, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name, _, _ := unstructured.NestedString(volume, "configMap", "name"); name != "" {
			add("configmaps", "ConfigMap", name)
		}
		if name, _, _ := unstructured.NestedString(volume, "secret", "secretName"); name != "" {
			add("secrets", "Secret", name)
		}
		if name, _, _ := unstructured.NestedString(volume, "persistentVolumeClaim", "claimName"); name != "" {
			add("persistentvolumeclaims", "PersistentVolumeClaim", name)
		}
		if items, _, _ := unstructured.NestedSlice(volume, "projected", "sources"); items != nil {
			for _, source := range items {
				if sourceMap, ok := source.(map[string]any); ok {
					if name, _, _ := unstructured.NestedString(sourceMap, "configMap", "name"); name != "" {
						add("configmaps", "ConfigMap", name)
					}
					if name, _, _ := unstructured.NestedString(sourceMap, "secret", "name"); name != "" {
						add("secrets", "Secret", name)
					}
				}
			}
		}
	}
	containers, _, _ := unstructured.NestedSlice(template.Object, "spec", "containers")
	for _, raw := range containers {
		container, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		envFrom, _, _ := unstructured.NestedSlice(container, "envFrom")
		for _, entry := range envFrom {
			if entryMap, ok := entry.(map[string]any); ok {
				if name, _, _ := unstructured.NestedString(entryMap, "configMapRef", "name"); name != "" {
					add("configmaps", "ConfigMap", name)
				}
				if name, _, _ := unstructured.NestedString(entryMap, "secretRef", "name"); name != "" {
					add("secrets", "Secret", name)
				}
			}
		}
	}
	imagePullSecrets, _, _ := unstructured.NestedSlice(template.Object, "spec", "imagePullSecrets")
	for _, raw := range imagePullSecrets {
		if entry, ok := raw.(map[string]any); ok {
			if name, _, _ := unstructured.NestedString(entry, "name"); name != "" {
				add("secrets", "Secret", name)
			}
		}
	}
	return references
}

func selectorMatches(selector, labels map[string]string) bool {
	if len(selector) == 0 {
		return false
	}
	for key, value := range selector {
		if labels[key] != value {
			return false
		}
	}
	return true
}

// resolveKind maps an apiVersion/kind pair (as found in ownerReferences) to a
// catalog or discovered resource.
func (s *Service) resolveKind(ctx context.Context, contextID, apiVersion, kind string) (schema.GroupVersionResource, resourceDefinition, error) {
	group, version := parseAPIVersion(apiVersion)
	for _, definition := range resourceCatalog {
		if definition.Group == group && definition.Version == version && definition.Kind == kind {
			return schema.GroupVersionResource{Group: definition.Group, Version: definition.Version, Resource: definition.Resource}, definition, nil
		}
	}
	discovered, err := s.Discover(ctx, contextID)
	if err != nil {
		return schema.GroupVersionResource{}, resourceDefinition{}, err
	}
	for _, item := range discovered {
		if item.Group == group && item.Version == version && item.Kind == kind {
			return schema.GroupVersionResource{Group: item.Group, Version: item.Version, Resource: item.Resource}, resourceDefinition(item), nil
		}
	}
	return schema.GroupVersionResource{}, resourceDefinition{}, invalid("unknown owner kind " + kind)
}

func parseAPIVersion(value string) (string, string) {
	parts := strings.SplitN(value, "/", 2)
	if len(parts) == 1 {
		return "", parts[0]
	}
	return parts[0], parts[1]
}
