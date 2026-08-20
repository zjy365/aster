package resources

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/yaml"
)

const (
	defaultPageSize int64 = 100
	// Large enough that a 200k-namespace inventory loads in ~40 pages instead
	// of 400; pagination and continue tokens are still enforced. The overhead
	// per page is a JSON marshal, which stays small for the projected rows.
	maxPageSize int64 = 5000
)

type ClientProvider interface {
	Client(contextID string) (dynamic.Interface, error)
}

type LogsProvider interface {
	PodLogs(ctx context.Context, contextID, namespace, name, container string, tailLines int64, previous, timestamps bool) (io.ReadCloser, error)
}

// PodContainersProvider lists a pod's container names so the log viewer can
// offer a container picker without parsing the pod manifest client-side.
type PodContainersProvider interface {
	PodContainers(ctx context.Context, contextID, namespace, name string) ([]string, error)
}

type ExecProvider interface {
	PodExec(ctx context.Context, contextID, namespace, name, container string, command []string) (string, string, error)
}

type Service struct {
	clients ClientProvider

	mu             sync.Mutex
	discoveryCache map[string]discoveryCacheEntry

	portForwardMu sync.Mutex
	portForwards  map[string]portForwardEntry
}

func NewService(clients ClientProvider) *Service {
	return &Service{
		clients:        clients,
		discoveryCache: make(map[string]discoveryCacheEntry),
		portForwards:   make(map[string]portForwardEntry),
	}
}

func (s *Service) List(ctx context.Context, request ListRequest) (ListResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return ListResponse{}, invalid("contextId is required")
	}
	gvr, definition, err := s.resolveGVR(ctx, request.ContextID, request.GVR)
	if err != nil {
		return ListResponse{}, err
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return ListResponse{}, err
	}
	limit, err := pageSize(request.Limit)
	if err != nil {
		return ListResponse{}, err
	}

	resource := client.Resource(gvr)
	var interfaceClient dynamic.ResourceInterface = resource
	if definition.Namespaced {
		interfaceClient = resource.Namespace(request.Namespace)
	}
	list, err := interfaceClient.List(ctx, metav1.ListOptions{
		Limit:         limit,
		Continue:      request.ContinueToken,
		LabelSelector: request.LabelSelector,
		FieldSelector: request.FieldSelector,
	})
	if err != nil {
		return ListResponse{}, fmt.Errorf("list %s: %w", request.GVR.Resource, err)
	}

	response := ListResponse{
		Items:           make([]ResourceRow, 0, len(list.Items)),
		ContinueToken:   list.GetContinue(),
		ResourceVersion: list.GetResourceVersion(),
	}
	for index := range list.Items {
		response.Items = append(response.Items, project(&list.Items[index]))
	}
	return response, nil
}

func (s *Service) Get(ctx context.Context, request GetRequest) (GetResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return GetResponse{}, invalid("contextId is required")
	}
	if strings.TrimSpace(request.Name) == "" {
		return GetResponse{}, invalid("name is required")
	}
	gvr, definition, err := s.resolveGVR(ctx, request.ContextID, request.GVR)
	if err != nil {
		return GetResponse{}, err
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return GetResponse{}, err
	}

	resource := client.Resource(gvr)
	var interfaceClient dynamic.ResourceInterface = resource
	if definition.Namespaced {
		if request.Namespace == "" {
			return GetResponse{}, invalid(fmt.Sprintf("namespace is required for %s", request.GVR.Resource))
		}
		interfaceClient = resource.Namespace(request.Namespace)
	}
	object, err := interfaceClient.Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return GetResponse{}, fmt.Errorf("get %s %q: %w", request.GVR.Resource, request.Name, err)
	}

	sanitized := object.DeepCopy()
	sanitize(sanitized, definition)
	jsonValue, err := json.Marshal(sanitized.Object)
	if err != nil {
		return GetResponse{}, fmt.Errorf("encode resource: %w", err)
	}
	yamlValue, err := yaml.JSONToYAML(jsonValue)
	if err != nil {
		return GetResponse{}, fmt.Errorf("encode resource yaml: %w", err)
	}
	return GetResponse{Resource: project(object), YAML: string(yamlValue)}, nil
}

func (s *Service) Logs(ctx context.Context, request LogsRequest) (LogsResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return LogsResponse{}, invalid("contextId, namespace and name are required")
	}
	provider, ok := s.clients.(LogsProvider)
	if !ok {
		return LogsResponse{}, invalid("logs provider is unavailable")
	}
	tail := request.TailLines
	if tail <= 0 || tail > 100_000 {
		tail = 2_000
	}
	reader, err := provider.PodLogs(ctx, request.ContextID, request.Namespace, request.Name, request.Container, tail, request.Previous, request.Timestamps)
	if err != nil {
		return LogsResponse{}, fmt.Errorf("read pod logs: %w", err)
	}
	defer reader.Close()
	const maxBytes = 4 << 20
	value := make([]byte, maxBytes+1)
	read, err := io.ReadFull(reader, value)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return LogsResponse{}, fmt.Errorf("read pod logs: %w", err)
	}
	value = value[:read]
	truncated := len(value) > maxBytes
	if truncated {
		value = value[:maxBytes]
	}
	response := LogsResponse{Text: string(value), Truncated: truncated}
	// The container list is a convenience for the picker; never fail the log
	// read because a secondary pod lookup did.
	if containers, ok := s.clients.(PodContainersProvider); ok {
		if names, err := containers.PodContainers(ctx, request.ContextID, request.Namespace, request.Name); err == nil {
			response.Containers = names
		}
	}
	return response, nil
}

func (s *Service) Exec(ctx context.Context, request ExecRequest) (ExecResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" || len(request.Command) == 0 {
		return ExecResponse{}, invalid("contextId, namespace, name and command are required")
	}
	if len(request.Command) > 32 {
		return ExecResponse{}, invalid("command has too many arguments")
	}
	for _, value := range request.Command {
		if strings.TrimSpace(value) == "" || len(value) > 4_096 {
			return ExecResponse{}, invalid("command contains an invalid argument")
		}
	}
	provider, ok := s.clients.(ExecProvider)
	if !ok {
		return ExecResponse{}, invalid("exec provider is unavailable")
	}
	stdout, stderr, err := provider.PodExec(ctx, request.ContextID, request.Namespace, request.Name, request.Container, request.Command)
	const maxOutput = 1 << 20
	if len(stdout) > maxOutput {
		stdout = stdout[:maxOutput]
	}
	if len(stderr) > maxOutput {
		stderr = stderr[:maxOutput]
	}
	if err != nil {
		return ExecResponse{Stdout: stdout, Stderr: stderr}, fmt.Errorf("pod exec: %w", err)
	}
	return ExecResponse{Stdout: stdout, Stderr: stderr}, nil
}

func (s *Service) Mutate(ctx context.Context, request MutationRequest) (MutationResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return MutationResponse{}, invalid("contextId is required")
	}
	gvr, definition, err := s.resolveGVR(ctx, request.ContextID, request.GVR)
	if err != nil {
		return MutationResponse{}, err
	}
	if definition.Resource == "secrets" {
		return MutationResponse{}, invalid("mutations for Secret are disabled")
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return MutationResponse{}, err
	}
	resource := client.Resource(gvr)

	switch request.Operation {
	case "create":
		return s.create(ctx, resource, definition, request)
	case "delete":
		return s.delete(ctx, resource, definition, request)
	}

	if strings.TrimSpace(request.Name) == "" {
		return MutationResponse{}, invalid("name is required")
	}
	if !mutationResourceAllowed(definition.Resource) && request.Operation != "yaml" {
		return MutationResponse{}, invalid(fmt.Sprintf("mutations are not supported for %s", definition.Kind))
	}
	if strings.TrimSpace(request.ResourceVersion) != "" {
		// The resource version is checked again immediately before the update.
		// This prevents an Apply from silently overwriting a newer watch event.
		request.ResourceVersion = strings.TrimSpace(request.ResourceVersion)
	}
	var target dynamic.ResourceInterface = resource
	if definition.Namespaced {
		if request.Namespace == "" {
			return MutationResponse{}, invalid("namespace is required")
		}
		target = resource.Namespace(request.Namespace)
	}
	object, err := target.Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return MutationResponse{}, fmt.Errorf("get %s %q: %w", request.GVR.Resource, request.Name, err)
	}
	changed, err := applyMutation(object, definition, request)
	if err != nil {
		return MutationResponse{}, err
	}
	if !changed {
		return mutationResult(object, definition, request, false), nil
	}
	if request.ResourceVersion != "" && object.GetResourceVersion() != request.ResourceVersion {
		return MutationResponse{}, fmt.Errorf("resource version conflict: expected %s, got %s", request.ResourceVersion, object.GetResourceVersion())
	}
	updateOptions := metav1.UpdateOptions{}
	if request.DryRun {
		updateOptions.DryRun = []string{metav1.DryRunAll}
	}
	updated, err := target.Update(ctx, object, updateOptions)
	if err != nil {
		return MutationResponse{}, fmt.Errorf("update %s %q: %w", request.GVR.Resource, request.Name, err)
	}
	return mutationResult(updated, definition, request, true), nil
}

// create applies a full YAML document as a new object. The name comes from
// the document; the namespace comes from the request, falling back to the
// document, and the two must agree when both are set.
func (s *Service) create(ctx context.Context, resource dynamic.NamespaceableResourceInterface, definition resourceDefinition, request MutationRequest) (MutationResponse, error) {
	if strings.TrimSpace(request.YAML) == "" {
		return MutationResponse{}, invalid("yaml is required")
	}
	object, err := decodeYamlObject(request.YAML)
	if err != nil {
		return MutationResponse{}, err
	}
	if err := matchDefinition(object, definition); err != nil {
		return MutationResponse{}, err
	}
	if strings.TrimSpace(object.GetName()) == "" {
		return MutationResponse{}, invalid("yaml metadata.name is required")
	}
	var target dynamic.ResourceInterface = resource
	if definition.Namespaced {
		documentNamespace := strings.TrimSpace(object.GetNamespace())
		if request.Namespace != "" && documentNamespace != "" && request.Namespace != documentNamespace {
			return MutationResponse{}, invalid(fmt.Sprintf("namespace mismatch: request has %q, yaml has %q", request.Namespace, documentNamespace))
		}
		namespace := request.Namespace
		if namespace == "" {
			namespace = documentNamespace
		}
		if namespace == "" {
			return MutationResponse{}, invalid("namespace is required")
		}
		object.SetNamespace(namespace)
		target = resource.Namespace(namespace)
	} else {
		object.SetNamespace("")
	}
	object.SetResourceVersion("")
	createOptions := metav1.CreateOptions{}
	if request.DryRun {
		createOptions.DryRun = []string{metav1.DryRunAll}
	}
	created, err := target.Create(ctx, object, createOptions)
	if err != nil {
		return MutationResponse{}, fmt.Errorf("create %s %q: %w", definition.Resource, object.GetName(), err)
	}
	result := mutationResult(created, definition, request, true)
	result.Name = created.GetName()
	return result, nil
}

// delete removes the named object. The dry-run response carries the sanitized
// live object so the review dialog shows exactly what would be removed.
func (s *Service) delete(ctx context.Context, resource dynamic.NamespaceableResourceInterface, definition resourceDefinition, request MutationRequest) (MutationResponse, error) {
	if strings.TrimSpace(request.Name) == "" {
		return MutationResponse{}, invalid("name is required")
	}
	var target dynamic.ResourceInterface = resource
	if definition.Namespaced {
		if request.Namespace == "" {
			return MutationResponse{}, invalid("namespace is required")
		}
		target = resource.Namespace(request.Namespace)
	}
	object, err := target.Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return MutationResponse{}, fmt.Errorf("get %s %q: %w", request.GVR.Resource, request.Name, err)
	}
	deleteOptions := metav1.DeleteOptions{}
	if request.DryRun {
		deleteOptions.DryRun = []string{metav1.DryRunAll}
	}
	if err := target.Delete(ctx, request.Name, deleteOptions); err != nil {
		return MutationResponse{}, fmt.Errorf("delete %s %q: %w", request.GVR.Resource, request.Name, err)
	}
	result := mutationResult(object, definition, request, true)
	result.Name = object.GetName()
	return result, nil
}

func decodeYamlObject(value string) (*unstructured.Unstructured, error) {
	jsonValue, err := yaml.YAMLToJSON([]byte(value))
	if err != nil {
		return nil, invalid(fmt.Sprintf("invalid yaml: %v", err))
	}
	var decoded map[string]any
	if err := json.Unmarshal(jsonValue, &decoded); err != nil {
		return nil, invalid(fmt.Sprintf("invalid yaml object: %v", err))
	}
	if len(decoded) == 0 {
		return nil, invalid("yaml document is empty")
	}
	return &unstructured.Unstructured{Object: decoded}, nil
}

func expectedAPIVersion(definition resourceDefinition) string {
	if definition.Group == "" {
		return definition.Version
	}
	return definition.Group + "/" + definition.Version
}

func matchDefinition(object *unstructured.Unstructured, definition resourceDefinition) error {
	if kind := object.GetKind(); kind != definition.Kind {
		return invalid(fmt.Sprintf("yaml kind must be %s", definition.Kind))
	}
	if version := object.GetAPIVersion(); version != expectedAPIVersion(definition) {
		return invalid(fmt.Sprintf("yaml apiVersion must be %s", expectedAPIVersion(definition)))
	}
	return nil
}

func mutationResourceAllowed(resource string) bool {
	switch resource {
	case "deployments", "statefulsets", "daemonsets", "configmaps":
		return true
	default:
		return false
	}
}

func applyMutation(object *unstructured.Unstructured, definition resourceDefinition, request MutationRequest) (bool, error) {
	if err := validateMutationOperation(request.GVR.Resource, request.Operation); err != nil {
		return false, err
	}
	switch request.Operation {
	case "scale":
		if request.Replicas == nil || *request.Replicas < 0 {
			return false, invalid("replicas must be zero or positive")
		}
		current, _, _ := unstructured.NestedInt64(object.Object, "spec", "replicas")
		if current == *request.Replicas {
			return false, nil
		}
		return true, unstructured.SetNestedField(object.Object, *request.Replicas, "spec", "replicas")
	case "image":
		if strings.TrimSpace(request.Image) == "" {
			return false, invalid("image is required")
		}
		containers, found, err := unstructured.NestedSlice(object.Object, "spec", "template", "spec", "containers")
		if err != nil || !found {
			return false, invalid("resource has no pod containers")
		}
		containerName := request.Container
		if containerName == "" && len(containers) == 1 {
			containerName, _ = containers[0].(map[string]any)["name"].(string)
		}
		if containerName == "" {
			return false, invalid("container is required")
		}
		for _, raw := range containers {
			if value, ok := raw.(map[string]any); ok && value["name"] == containerName {
				if value["image"] == request.Image {
					return false, nil
				}
				value["image"] = request.Image
				return true, unstructured.SetNestedSlice(object.Object, containers, "spec", "template", "spec", "containers")
			}
		}
		return false, invalid(fmt.Sprintf("container %q was not found", containerName))
	case "restart":
		annotations, _, err := unstructured.NestedStringMap(object.Object, "spec", "template", "metadata", "annotations")
		if err != nil {
			return false, invalid("resource has invalid pod template annotations")
		}
		if annotations == nil {
			annotations = map[string]string{}
		}
		value := time.Now().UTC().Format(time.RFC3339)
		if annotations["kubectl.kubernetes.io/restartedAt"] == value {
			return false, nil
		}
		annotations["kubectl.kubernetes.io/restartedAt"] = value
		return true, unstructured.SetNestedStringMap(object.Object, annotations, "spec", "template", "metadata", "annotations")
	case "yaml":
		if strings.TrimSpace(request.YAML) == "" {
			return false, invalid("yaml is required")
		}
		replacement, err := decodeYamlObject(request.YAML)
		if err != nil {
			return false, err
		}
		if err := matchDefinition(replacement, definition); err != nil {
			return false, err
		}
		if name := replacement.GetName(); name != "" && name != object.GetName() {
			return false, invalid(fmt.Sprintf("yaml metadata.name must stay %q", object.GetName()))
		}
		replacement.SetName(object.GetName())
		if namespace := object.GetNamespace(); namespace != "" {
			replacement.SetNamespace(namespace)
		}
		replacement.SetResourceVersion(object.GetResourceVersion())
		if reflect.DeepEqual(object.Object, replacement.Object) {
			return false, nil
		}
		object.Object = replacement.Object
		return true, nil
	default:
		return false, invalid(fmt.Sprintf("unsupported mutation operation %q", request.Operation))
	}
}

func validateMutationOperation(resource, operation string) error {
	allowed := false
	switch operation {
	case "scale":
		allowed = resource == "deployments" || resource == "statefulsets"
	case "image", "restart":
		allowed = resource == "deployments" || resource == "statefulsets" || resource == "daemonsets"
	case "yaml", "create", "delete":
		allowed = true
	}
	if !allowed {
		return invalid(fmt.Sprintf("operation %q is not supported for %s", operation, resource))
	}
	return nil
}

func mutationResult(object *unstructured.Unstructured, definition resourceDefinition, request MutationRequest, changed bool) MutationResponse {
	sanitized := object.DeepCopy()
	sanitize(sanitized, definition)
	value, _ := json.Marshal(sanitized.Object)
	yamlValue, _ := yaml.JSONToYAML(value)
	return MutationResponse{Operation: request.Operation, DryRun: request.DryRun, Changed: changed, ResourceVersion: object.GetResourceVersion(), YAML: string(yamlValue)}
}

func sanitize(object *unstructured.Unstructured, definition resourceDefinition) {
	unstructured.RemoveNestedField(object.Object, "metadata", "managedFields")
	if definition.Resource == "secrets" {
		// Keys stay visible, values never leave the core.
		for _, field := range []string{"data", "stringData"} {
			values, found, _ := unstructured.NestedMap(object.Object, field)
			if !found {
				continue
			}
			masked := make(map[string]any, len(values))
			for key := range values {
				masked[key] = "[redacted]"
			}
			_ = unstructured.SetNestedMap(object.Object, masked, field)
		}
	}
	annotations := object.GetAnnotations()
	if annotations != nil {
		delete(annotations, "kubectl.kubernetes.io/last-applied-configuration")
		if len(annotations) == 0 {
			object.SetAnnotations(nil)
		} else {
			object.SetAnnotations(annotations)
		}
	}
}

func pageSize(requested int64) (int64, error) {
	switch {
	case requested < 0:
		return 0, invalid("limit must be positive")
	case requested == 0:
		return defaultPageSize, nil
	case requested > maxPageSize:
		return 0, invalid(fmt.Sprintf("limit must not exceed %d", maxPageSize))
	default:
		return requested, nil
	}
}
