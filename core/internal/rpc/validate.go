package rpc

import (
	"fmt"
	"net/http"

	"github.com/zjy365/aster/core/internal/resources"
)

// Input caps mirrored from the desktop shell's boundary validation
// (apps/desktop/src/main/validation.ts). The core is the durable enforcement
// point: shells are interchangeable and must never be the only line of
// defense, so every limit the shell enforces is re-enforced here.
const (
	maxContextID       = 512
	maxNamespace       = 253
	maxName            = 253
	maxContainer       = 253
	maxContinueToken   = 16_384
	maxSelector        = 2_048
	maxQuery           = 128
	maxImage           = 4_096
	maxYAML            = 1_000_000
	maxResourceVersion = 128
	// Watch resource versions round-trip from the API server itself, so the
	// cap is looser than the mutation one to avoid breaking live clusters.
	maxWatchResourceVersion = 1_024
	maxWatchKind            = 128
	maxPortForwardID        = 64
	maxListLimit            = 500
	maxTailLines            = 100_000
	maxReplicas             = 1_000_000
)

var mutationOperations = map[string]bool{
	"scale":   true,
	"image":   true,
	"restart": true,
	"yaml":    true,
	"create":  true,
	"delete":  true,
}

func validateGVR(value resources.GVR) error {
	if err := checkLength("gvr.group", value.Group, maxNamespace); err != nil {
		return err
	}
	if value.Version == "" {
		return fmt.Errorf("gvr.version is required")
	}
	if err := checkLength("gvr.version", value.Version, 64); err != nil {
		return err
	}
	if value.Resource == "" {
		return fmt.Errorf("gvr.resource is required")
	}
	return checkLength("gvr.resource", value.Resource, 128)
}

func validateContextID(value string) error {
	if value == "" {
		return fmt.Errorf("contextId is required")
	}
	return checkLength("contextId", value, maxContextID)
}

func validateListRequest(value resources.ListRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := validateGVR(value.GVR); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if value.Limit < 0 || value.Limit > maxListLimit {
		return fmt.Errorf("limit must be between 1 and %d", maxListLimit)
	}
	if err := checkLength("continueToken", value.ContinueToken, maxContinueToken); err != nil {
		return err
	}
	if err := checkLength("labelSelector", value.LabelSelector, maxSelector); err != nil {
		return err
	}
	return checkLength("fieldSelector", value.FieldSelector, maxSelector)
}

func validateGetRequest(value resources.GetRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := validateGVR(value.GVR); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if value.Name == "" {
		return fmt.Errorf("name is required")
	}
	return checkLength("name", value.Name, maxName)
}

func validateMutationRequest(value resources.MutationRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := validateGVR(value.GVR); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if !mutationOperations[value.Operation] {
		return fmt.Errorf("unsupported mutation operation")
	}
	// create takes the object name from the YAML document.
	if value.Operation != "create" && value.Name == "" {
		return fmt.Errorf("name is required")
	}
	if err := checkLength("name", value.Name, maxName); err != nil {
		return err
	}
	if value.Replicas != nil && (*value.Replicas < 0 || *value.Replicas > maxReplicas) {
		return fmt.Errorf("replicas must be between 0 and %d", maxReplicas)
	}
	if err := checkLength("image", value.Image, maxImage); err != nil {
		return err
	}
	if err := checkLength("container", value.Container, maxContainer); err != nil {
		return err
	}
	if err := checkLength("yaml", value.YAML, maxYAML); err != nil {
		return err
	}
	return checkLength("resourceVersion", value.ResourceVersion, maxResourceVersion)
}

func validateSearchRequest(value resources.SearchRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if value.Query == "" {
		return fmt.Errorf("query is required")
	}
	if err := checkLength("query", value.Query, maxQuery); err != nil {
		return err
	}
	return checkLength("namespace", value.Namespace, maxNamespace)
}

func validateLogsRequest(value resources.LogsRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if err := checkLength("name", value.Name, maxName); err != nil {
		return err
	}
	if err := checkLength("container", value.Container, maxContainer); err != nil {
		return err
	}
	if value.TailLines < 0 || value.TailLines > maxTailLines {
		return fmt.Errorf("tailLines must be between 1 and %d", maxTailLines)
	}
	return nil
}

func validateExecRequest(value resources.ExecRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if err := checkLength("name", value.Name, maxName); err != nil {
		return err
	}
	// Command shape (argv length, per-entry caps) is enforced by the service.
	return checkLength("container", value.Container, maxContainer)
}

func validateMetricsRequest(value resources.MetricsRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	return checkLength("namespace", value.Namespace, maxNamespace)
}

func validatePortForwardRequest(value resources.PortForwardRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if err := checkLength("name", value.Name, maxName); err != nil {
		return err
	}
	if value.PodPort < 1 || value.PodPort > 65_535 {
		return fmt.Errorf("podPort must be between 1 and 65535")
	}
	return nil
}

func validatePortForwardStopRequest(value resources.PortForwardStopRequest) error {
	if value.ID == "" {
		return fmt.Errorf("id is required")
	}
	return checkLength("id", value.ID, maxPortForwardID)
}

func validateWatchRequest(value resources.WatchRequest) error {
	if err := validateContextID(value.ContextID); err != nil {
		return err
	}
	if err := validateGVR(value.GVR); err != nil {
		return err
	}
	if err := checkLength("namespace", value.Namespace, maxNamespace); err != nil {
		return err
	}
	if err := checkLength("kind", value.Kind, maxWatchKind); err != nil {
		return err
	}
	if err := checkLength("resourceVersion", value.ResourceVersion, maxWatchResourceVersion); err != nil {
		return err
	}
	if err := checkLength("labelSelector", value.LabelSelector, maxSelector); err != nil {
		return err
	}
	return checkLength("fieldSelector", value.FieldSelector, maxSelector)
}

func checkLength(label, value string, max int) error {
	if len(value) > max {
		return fmt.Errorf("%s is too long", label)
	}
	return nil
}

// rejectInvalid writes a 400 for a failed boundary validation and reports
// whether the handler should stop.
func rejectInvalid(writer http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	writeError(writer, http.StatusBadRequest, "invalid_request", err)
	return true
}
