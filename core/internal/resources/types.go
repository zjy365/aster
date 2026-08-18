package resources

import "time"

type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

func invalid(message string) error {
	return &ValidationError{Message: message}
}

type GVR struct {
	Group    string `json:"group,omitempty"`
	Version  string `json:"version"`
	Resource string `json:"resource"`
}

type ListRequest struct {
	ContextID     string `json:"contextId"`
	GVR           GVR    `json:"gvr"`
	Namespace     string `json:"namespace,omitempty"`
	Limit         int64  `json:"limit,omitempty"`
	ContinueToken string `json:"continueToken,omitempty"`
	LabelSelector string `json:"labelSelector,omitempty"`
	FieldSelector string `json:"fieldSelector,omitempty"`
}

type ListResponse struct {
	Items           []ResourceRow `json:"items"`
	ContinueToken   string        `json:"continueToken,omitempty"`
	ResourceVersion string        `json:"resourceVersion,omitempty"`
}

type GetRequest struct {
	ContextID string `json:"contextId"`
	GVR       GVR    `json:"gvr"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
}

type GetResponse struct {
	Resource ResourceRow `json:"resource"`
	YAML     string      `json:"yaml"`
}

type MutationRequest struct {
	ContextID       string `json:"contextId"`
	GVR             GVR    `json:"gvr"`
	Namespace       string `json:"namespace,omitempty"`
	Name            string `json:"name"`
	Operation       string `json:"operation"`
	YAML            string `json:"yaml,omitempty"`
	Image           string `json:"image,omitempty"`
	Container       string `json:"container,omitempty"`
	Replicas        *int64 `json:"replicas,omitempty"`
	DryRun          bool   `json:"dryRun,omitempty"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
}

type MutationResponse struct {
	Operation       string `json:"operation"`
	DryRun          bool   `json:"dryRun"`
	Changed         bool   `json:"changed"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
	YAML            string `json:"yaml,omitempty"`
	Name            string `json:"name,omitempty"`
}

type LogsRequest struct {
	ContextID  string `json:"contextId"`
	Namespace  string `json:"namespace"`
	Name       string `json:"name"`
	Container  string `json:"container,omitempty"`
	TailLines  int64  `json:"tailLines,omitempty"`
	Previous   bool   `json:"previous,omitempty"`
	Timestamps bool   `json:"timestamps,omitempty"`
}

type LogsResponse struct {
	Text       string   `json:"text"`
	Truncated  bool     `json:"truncated"`
	Containers []string `json:"containers,omitempty"`
}

type WorkloadLogsRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Container string `json:"container,omitempty"`
	TailLines int64  `json:"tailLines,omitempty"`
}

type WorkloadLogLine struct {
	Pod  string `json:"pod"`
	Text string `json:"text"`
}

type WorkloadLogsResponse struct {
	Lines      []WorkloadLogLine `json:"lines"`
	Pods       []string          `json:"pods,omitempty"`
	Containers []string          `json:"containers,omitempty"`
	Truncated  bool              `json:"truncated"`
	Note       string            `json:"note,omitempty"`
}

type ExecRequest struct {
	ContextID string   `json:"contextId"`
	Namespace string   `json:"namespace"`
	Name      string   `json:"name"`
	Container string   `json:"container,omitempty"`
	Command   []string `json:"command"`
}

type ExecResponse struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
}

type DiscoveredResource struct {
	Group      string `json:"group"`
	Version    string `json:"version"`
	Resource   string `json:"resource"`
	Kind       string `json:"kind"`
	Namespaced bool   `json:"namespaced"`
}

type RelatedResource struct {
	Group     string `json:"group"`
	Version   string `json:"version"`
	Resource  string `json:"resource"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	Relation  string `json:"relation"`
}

type RelatedResponse struct {
	Related []RelatedResource `json:"related"`
}

type SearchRequest struct {
	ContextID string `json:"contextId"`
	Query     string `json:"query"`
	Namespace string `json:"namespace,omitempty"`
}

type SearchResponse struct {
	Results []RelatedResource `json:"results"`
}

type MetricsRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace,omitempty"`
}

type ContainerMetric struct {
	Name   string `json:"name"`
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

type PodMetric struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace,omitempty"`
	Containers []ContainerMetric `json:"containers"`
}

type MetricsResponse struct {
	Pods []PodMetric `json:"pods"`
}

type PortForwardRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	PodPort   int64  `json:"podPort"`
}

type PortForwardResponse struct {
	ID        string `json:"id"`
	LocalPort int    `json:"localPort"`
}

type PortForwardStopRequest struct {
	ID string `json:"id"`
}

type DiscoveryResponse struct {
	Resources []DiscoveredResource `json:"resources"`
}

type WatchRequest struct {
	ContextID       string `json:"contextId"`
	GVR             GVR    `json:"gvr"`
	Kind            string `json:"kind,omitempty"`
	Namespace       string `json:"namespace,omitempty"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
	LabelSelector   string `json:"labelSelector,omitempty"`
	FieldSelector   string `json:"fieldSelector,omitempty"`
}

type WatchEvent struct {
	Type            string       `json:"type"`
	Resource        *ResourceRow `json:"resource,omitempty"`
	ResourceVersion string       `json:"resourceVersion,omitempty"`
	Error           *StreamError `json:"error,omitempty"`
	Reason          string       `json:"reason,omitempty"`
	RelistRequired  bool         `json:"relistRequired,omitempty"`
}

type StreamError struct {
	Code    int32  `json:"code,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message"`
}

type ResourceRow struct {
	UID             string            `json:"uid"`
	APIVersion      string            `json:"apiVersion"`
	Kind            string            `json:"kind"`
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace,omitempty"`
	ResourceVersion string            `json:"resourceVersion,omitempty"`
	CreatedAt       *time.Time        `json:"createdAt,omitempty"`
	Deleting        bool              `json:"deleting,omitempty"`
	Labels          map[string]string `json:"labels,omitempty"`
	Status          string            `json:"status,omitempty"`
	Reason          string            `json:"reason,omitempty"`
	Message         string            `json:"message,omitempty"`
	Desired         *int64            `json:"desired,omitempty"`
	Ready           *int64            `json:"ready,omitempty"`
	Available       *int64            `json:"available,omitempty"`
	Updated         *int64            `json:"updated,omitempty"`
	Images          []string          `json:"images,omitempty"`
	DataKeys        []string          `json:"dataKeys,omitempty"`
	Type            string            `json:"type,omitempty"`
	Addresses       []string          `json:"addresses,omitempty"`
	Ports           []string          `json:"ports,omitempty"`
	Rules           []string          `json:"rules,omitempty"`
	RoleRef         string            `json:"roleRef,omitempty"`
	Subjects        []string          `json:"subjects,omitempty"`
	Version         string            `json:"version,omitempty"`
	Related         []string          `json:"related,omitempty"`
	Count           *int64            `json:"count,omitempty"`
	LastTimestamp   *time.Time        `json:"lastTimestamp,omitempty"`
}
