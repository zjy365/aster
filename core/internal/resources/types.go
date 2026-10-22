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

// PodDebugRequest injects an ephemeral debug container into a running Pod
// through the pods/ephemeralcontainers subresource (kubectl debug semantics:
// the workload spec itself is never modified).
type PodDebugRequest struct {
	ContextID string             `json:"contextId"`
	Namespace string             `json:"namespace"`
	PodName   string             `json:"podName"`
	Container PodDebugContainer  `json:"container"`
}

// PodDebugContainer is the requested debug container. Only the image is
// required; every other field falls back to the kubectl-debug defaults
// (generated unique name, image entrypoint, no target).
type PodDebugContainer struct {
	Name                string   `json:"name,omitempty"`
	Image               string   `json:"image"`
	Command             []string `json:"command,omitempty"`
	Args                []string `json:"args,omitempty"`
	TargetContainerName string   `json:"targetContainerName,omitempty"`
	Env                 []EnvVar `json:"env,omitempty"`
}

// EnvVar is one NAME=value environment entry for a debug container.
type EnvVar struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type PodDebugResponse struct {
	// Container is the ephemeral container entry the API server stored.
	Container PodDebugContainerEntry `json:"container"`
}

// PodDebugContainerEntry echoes the stored ephemeral container: generated
// fields (the unique name) resolved, optional fields omitted when unset.
type PodDebugContainerEntry struct {
	Name                string   `json:"name"`
	Image               string   `json:"image"`
	Command             []string `json:"command,omitempty"`
	Args                []string `json:"args,omitempty"`
	TargetContainerName string   `json:"targetContainerName,omitempty"`
	Env                 []EnvVar `json:"env,omitempty"`
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

// NodeMetricsRequest is the cluster-scoped counterpart of MetricsRequest:
// nodes have no namespace, so the context is the only scope.
type NodeMetricsRequest struct {
	ContextID string `json:"contextId"`
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

// NodeMetric mirrors one metrics.k8s.io NodeMetrics item, serialized with the
// same conventions as pod metrics: usage stays a raw quantity string
// ("620m", "48Mi") so the renderer reuses its pod formatters, and the
// aggregation window and sample timestamp pass through untouched.
type NodeMetric struct {
	Name      string `json:"name"`
	CPU       string `json:"cpu"`
	Memory    string `json:"memory"`
	Window    string `json:"window,omitempty"`
	Timestamp string `json:"timestamp,omitempty"`
}

type NodeMetricsResponse struct {
	Nodes []NodeMetric `json:"nodes"`
}

type PortForwardRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	PodPort   int64  `json:"podPort"`
	// Kind routes the forward: Pod forwards directly, Service resolves
	// through EndpointSlices, and the workload kinds resolve through their
	// pod selector. Mirrors "kubectl port-forward svc/x deploy/x pod/x".
	Kind string `json:"kind,omitempty"`
	// LocalPort binds the forward to a specific local port; 0 picks a random
	// free port. This mirrors "kubectl port-forward 8080:80".
	LocalPort int `json:"localPort,omitempty"`
}

type PortForwardResponse struct {
	ID        string `json:"id"`
	LocalPort int    `json:"localPort"`
	// Pod carries the backing pod for service/workload forwards so the UI
	// can show what actually terminates the connection.
	Pod string `json:"pod,omitempty"`
}

type PortForwardStopRequest struct {
	ID string `json:"id"`
}

// NodeCordonRequest flips spec.unschedulable: true cordons (stops accepting
// new pods), false uncordons.
type NodeCordonRequest struct {
	ContextID     string `json:"contextId"`
	NodeName      string `json:"nodeName"`
	Unschedulable bool   `json:"unschedulable"`
}

type NodeCordonResponse struct {
	NodeName      string `json:"nodeName"`
	Unschedulable bool   `json:"unschedulable"`
	// Changed is false when the node already carried the requested state.
	Changed bool `json:"changed"`
}

// NodeDrainOptions mirrors the kubectl drain flags that change which pods a
// drain touches and how they are removed.
type NodeDrainOptions struct {
	// IgnoreDaemonsets skips DaemonSet-managed pods instead of aborting.
	IgnoreDaemonsets bool `json:"ignoreDaemonsets,omitempty"`
	// Force evicts pods that no controller (Deployment, ReplicaSet, StatefulSet,
	// Job, DaemonSet) manages.
	Force bool `json:"force,omitempty"`
	// DeleteEmptyDirData proceeds past pods with emptyDir volumes instead of
	// skipping them; their local data is lost with the pod.
	DeleteEmptyDirData bool `json:"deleteEmptyDirData,omitempty"`
	// DisableEviction uses pod DELETE requests instead of the eviction API,
	// bypassing PodDisruptionBudgets server-side.
	DisableEviction bool `json:"disableEviction,omitempty"`
}

type NodeDrainRequest struct {
	ContextID string           `json:"contextId"`
	NodeName  string           `json:"nodeName"`
	Options   NodeDrainOptions `json:"options,omitempty"`
}

// NodeDrainEvent is one ndjson line of a drain stream: the leading cordon,
// one event per pod step, and the trailing summary.
type NodeDrainEvent struct {
	// Type discriminates: "cordon" | "pod" | "summary".
	Type string `json:"type"`
	Node string `json:"node,omitempty"`
	// Cordon events: the drain's automatic cordon (kubectl parity).
	Unschedulable bool `json:"unschedulable,omitempty"`
	// Changed reports whether the cordon patched the node.
	Changed bool `json:"changed,omitempty"`
	// Pod events.
	Namespace string `json:"namespace,omitempty"`
	Pod       string `json:"pod,omitempty"`
	// Status is the pod step: evicting | evicted | deleting | deleted |
	// failed | skipped.
	Status string `json:"status,omitempty"`
	// Reason explains a skip (mirror pod, DaemonSet-managed, emptyDir).
	Reason string `json:"reason,omitempty"`
	// Message carries the error detail for failed pods.
	Message string `json:"message,omitempty"`
	// Summary counts.
	Total   int `json:"total,omitempty"`
	Evicted int `json:"evicted,omitempty"`
	Skipped int `json:"skipped,omitempty"`
	Failed  int `json:"failed,omitempty"`
	// Complete is true when the drain ran through every pod; false when a
	// blocking pre-check or error stopped it early.
	Complete bool `json:"complete,omitempty"`
	// Error carries the summary-level failure reason on incomplete drains.
	Error string `json:"error,omitempty"`
}

// PortForwardResourceRef names the object a forward was requested for, before
// any Service/workload-to-pod resolution.
type PortForwardResourceRef struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// PortForwardSession is the read-only view of one active forward in the
// service registry, served by GET /v1/portforwards. Sessions live only as
// long as the sidecar process; nothing persists across restarts.
type PortForwardSession struct {
	ID          string                 `json:"id"`
	ContextID   string                 `json:"contextId"`
	Namespace   string                 `json:"namespace"`
	ResourceRef PortForwardResourceRef `json:"resourceRef"`
	LocalPort   int                    `json:"localPort"`
	// TargetPort is the resolved pod port the forward terminates on (named
	// ports are already translated).
	TargetPort int64     `json:"targetPort"`
	StartedAt  time.Time `json:"startedAt"`
	// Pod carries the backing pod for service/workload forwards.
	Pod string `json:"pod,omitempty"`
}

type PortForwardListResponse struct {
	Forwards []PortForwardSession `json:"forwards"`
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
	InvolvedObject  string            `json:"involvedObject,omitempty"`
	Count           *int64            `json:"count,omitempty"`
	LastTimestamp   *time.Time        `json:"lastTimestamp,omitempty"`
	// Node allocatable capacity as raw quantity strings ("4", "16Gi"); the
	// usage columns read them to show pressure relative to capacity.
	AllocatableCPU    string `json:"allocatableCpu,omitempty"`
	AllocatableMemory string `json:"allocatableMemory,omitempty"`
}
