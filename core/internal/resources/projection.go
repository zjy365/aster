package resources

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func project(object *unstructured.Unstructured) ResourceRow {
	row := ResourceRow{
		UID:             string(object.GetUID()),
		APIVersion:      object.GetAPIVersion(),
		Kind:            object.GetKind(),
		Name:            object.GetName(),
		Namespace:       object.GetNamespace(),
		ResourceVersion: object.GetResourceVersion(),
		Deleting:        object.GetDeletionTimestamp() != nil,
		Labels:          object.GetLabels(),
	}
	if timestamp := object.GetCreationTimestamp(); !timestamp.IsZero() {
		createdAt := timestamp.Time
		row.CreatedAt = &createdAt
	}

	switch object.GetKind() {
	case "Deployment", "StatefulSet":
		row.Desired = nestedInt64(object.Object, "spec", "replicas")
		row.Ready = nestedInt64(object.Object, "status", "readyReplicas")
		row.Available = nestedInt64(object.Object, "status", "availableReplicas")
		row.Updated = nestedInt64(object.Object, "status", "updatedReplicas")
		row.Images = containerImages(object.Object, "spec", "template", "spec", "containers")
		row.Status = readinessStatus(row.Ready, row.Desired)
	case "DaemonSet":
		row.Desired = nestedInt64(object.Object, "status", "desiredNumberScheduled")
		row.Ready = nestedInt64(object.Object, "status", "numberReady")
		row.Available = nestedInt64(object.Object, "status", "numberAvailable")
		row.Updated = nestedInt64(object.Object, "status", "updatedNumberScheduled")
		row.Images = containerImages(object.Object, "spec", "template", "spec", "containers")
		row.Status = readinessStatus(row.Ready, row.Desired)
	case "Pod":
		row.Status, _, _ = unstructured.NestedString(object.Object, "status", "phase")
		row.Images = containerImages(object.Object, "spec", "containers")
		desired := int64(len(row.Images))
		ready := readyContainers(object.Object)
		row.Desired = &desired
		row.Ready = &ready
	case "ConfigMap":
		row.DataKeys = nestedMapKeys(object.Object, "data")
	case "Secret":
		row.DataKeys = mergeSorted(nestedMapKeys(object.Object, "data"), nestedMapKeys(object.Object, "stringData"))
		row.Type, _, _ = unstructured.NestedString(object.Object, "type")
	case "Service":
		row.Type, _, _ = unstructured.NestedString(object.Object, "spec", "type")
		row.Addresses = serviceAddresses(object.Object)
		row.Ports = servicePorts(object.Object)
	case "Ingress":
		row.Addresses = ingressHosts(object.Object)
		row.Type, _, _ = unstructured.NestedString(object.Object, "spec", "ingressClassName")
	case "Node":
		row.Status = nodeStatus(object.Object)
		row.Addresses = nodeAddresses(object.Object)
		row.Version, _, _ = unstructured.NestedString(object.Object, "status", "nodeInfo", "kubeletVersion")
	case "Role", "ClusterRole":
		row.Rules = policyRules(object.Object)
	case "RoleBinding", "ClusterRoleBinding":
		row.RoleRef = roleReference(object.Object)
		row.Subjects = bindingSubjects(object.Object)
	case "Namespace":
		row.Status, _, _ = unstructured.NestedString(object.Object, "status", "phase")
	case "Event":
		row.Reason, _, _ = unstructured.NestedString(object.Object, "reason")
		row.Message, _, _ = unstructured.NestedString(object.Object, "message")
		row.Type, _, _ = unstructured.NestedString(object.Object, "type")
		row.Count = nestedInt64(object.Object, "count")
		if value, found, _ := unstructured.NestedString(object.Object, "lastTimestamp"); found {
			if parsed, err := time.Parse(time.RFC3339, value); err == nil {
				row.LastTimestamp = &parsed
			}
		}
	}
	row.Related = ownerReferences(object.Object)

	return row
}

func ownerReferences(object map[string]any) []string {
	values, found, _ := unstructured.NestedSlice(object, "metadata", "ownerReferences")
	if !found {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		kind, _ := value["kind"].(string)
		name, _ := value["name"].(string)
		if kind != "" && name != "" {
			result = append(result, kind+"/"+name)
		}
	}
	sort.Strings(result)
	return result
}

func readinessStatus(ready, desired *int64) string {
	if ready != nil && desired != nil && *ready == *desired {
		return "Ready"
	}
	return "Progressing"
}

func nestedInt64(object map[string]any, fields ...string) *int64 {
	value, found, err := unstructured.NestedInt64(object, fields...)
	if err != nil || !found {
		return nil
	}
	return &value
}

func containerImages(object map[string]any, fields ...string) []string {
	containers, found, err := unstructured.NestedSlice(object, fields...)
	if err != nil || !found {
		return nil
	}
	images := make([]string, 0, len(containers))
	for _, raw := range containers {
		container, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		image, _ := container["image"].(string)
		if image != "" {
			images = append(images, image)
		}
	}
	return images
}

func readyContainers(object map[string]any) int64 {
	statuses, found, err := unstructured.NestedSlice(object, "status", "containerStatuses")
	if err != nil || !found {
		return 0
	}
	var ready int64
	for _, raw := range statuses {
		status, ok := raw.(map[string]any)
		if ok && status["ready"] == true {
			ready++
		}
	}
	return ready
}

func nestedMapKeys(object map[string]any, fields ...string) []string {
	values, found, err := unstructured.NestedStringMap(object, fields...)
	if err != nil || !found {
		return nil
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func mergeSorted(values ...[]string) []string {
	set := make(map[string]struct{})
	for _, group := range values {
		for _, value := range group {
			set[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func serviceAddresses(object map[string]any) []string {
	addresses := make([]string, 0, 2)
	if value, found, _ := unstructured.NestedString(object, "spec", "clusterIP"); found && value != "" && value != "None" {
		addresses = append(addresses, value)
	}
	if values, found, _ := unstructured.NestedStringSlice(object, "spec", "externalIPs"); found {
		addresses = append(addresses, values...)
	}
	return mergeSorted(addresses)
}

func servicePorts(object map[string]any) []string {
	ports, found, _ := unstructured.NestedSlice(object, "spec", "ports")
	if !found {
		return nil
	}
	result := make([]string, 0, len(ports))
	for _, raw := range ports {
		port, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		value, _ := port["port"].(int64)
		protocol, _ := port["protocol"].(string)
		name, _ := port["name"].(string)
		label := fmt.Sprintf("%d/%s", value, protocol)
		if name != "" {
			label = name + ":" + label
		}
		result = append(result, label)
	}
	return result
}

func ingressHosts(object map[string]any) []string {
	rules, found, _ := unstructured.NestedSlice(object, "spec", "rules")
	if !found {
		return nil
	}
	hosts := make([]string, 0, len(rules))
	for _, raw := range rules {
		rule, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if host, _ := rule["host"].(string); host != "" {
			hosts = append(hosts, host)
		}
	}
	return mergeSorted(hosts)
}

func nodeStatus(object map[string]any) string {
	conditions, found, _ := unstructured.NestedSlice(object, "status", "conditions")
	if !found {
		return "Unknown"
	}
	for _, raw := range conditions {
		condition, ok := raw.(map[string]any)
		if !ok || condition["type"] != "Ready" {
			continue
		}
		if condition["status"] == "True" {
			return "Ready"
		}
		return "NotReady"
	}
	return "Unknown"
}

func nodeAddresses(object map[string]any) []string {
	values, found, _ := unstructured.NestedSlice(object, "status", "addresses")
	if !found {
		return nil
	}
	addresses := make([]string, 0, len(values))
	for _, raw := range values {
		address, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		kind, _ := address["type"].(string)
		value, _ := address["address"].(string)
		if value != "" {
			addresses = append(addresses, kind+":"+value)
		}
	}
	return addresses
}

func policyRules(object map[string]any) []string {
	rules, found, _ := unstructured.NestedSlice(object, "rules")
	if !found {
		return nil
	}
	result := make([]string, 0, len(rules))
	for _, raw := range rules {
		rule, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		verbs := stringSlice(rule["verbs"])
		resources := stringSlice(rule["resources"])
		result = append(result, strings.Join(verbs, ",")+":"+strings.Join(resources, ","))
	}
	return result
}

func roleReference(object map[string]any) string {
	kind, _, _ := unstructured.NestedString(object, "roleRef", "kind")
	name, _, _ := unstructured.NestedString(object, "roleRef", "name")
	if kind == "" && name == "" {
		return ""
	}
	return kind + "/" + name
}

func bindingSubjects(object map[string]any) []string {
	subjects, found, _ := unstructured.NestedSlice(object, "subjects")
	if !found {
		return nil
	}
	result := make([]string, 0, len(subjects))
	for _, raw := range subjects {
		subject, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		kind, _ := subject["kind"].(string)
		name, _ := subject["name"].(string)
		namespace, _ := subject["namespace"].(string)
		value := kind + "/"
		if namespace != "" {
			value += namespace + "/"
		}
		result = append(result, value+name)
	}
	return result
}

func stringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	sort.Strings(result)
	return result
}
