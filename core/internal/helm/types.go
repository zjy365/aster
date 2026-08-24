// SPDX-License-Identifier: Apache-2.0
package helm

import "time"

// ValidationError marks a request rejected by the helm domain's boundary
// rules; rpc maps it to a 400 like the resources package's validation error.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

func invalid(message string) error {
	return &ValidationError{Message: message}
}

// NotFoundError marks a release that does not exist in the target namespace.
type NotFoundError struct {
	Message string
}

func (e *NotFoundError) Error() string {
	return e.Message
}

func notFound(message string) error {
	return &NotFoundError{Message: message}
}

type ListRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
}

// ReleaseSummary is the projection the renderer's release table needs. It
// never carries chart values or rendered manifests.
type ReleaseSummary struct {
	Name         string    `json:"name"`
	Namespace    string    `json:"namespace"`
	Version      int       `json:"version"`
	Status       string    `json:"status"`
	Chart        string    `json:"chart"`
	ChartVersion string    `json:"chartVersion"`
	AppVersion   string    `json:"appVersion"`
	UpdatedAt    time.Time `json:"updatedAt,omitempty"`
	Description  string    `json:"description,omitempty"`
}

type ListResponse struct {
	Releases []ReleaseSummary `json:"releases"`
}

type GetRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// ReleaseDetail is the full read view. Values are user-authored chart input,
// so they travel unredacted; rendered manifests have Secret data masked by
// the core before they leave it.
type ReleaseDetail struct {
	ReleaseSummary
	Notes     string           `json:"notes,omitempty"`
	Values    string           `json:"values,omitempty"`
	Manifest  string           `json:"manifest,omitempty"`
	Truncated bool             `json:"truncated,omitempty"`
	History   []ReleaseSummary `json:"history"`
}

type GetResponse struct {
	Release ReleaseDetail `json:"release"`
}

type UninstallRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type UninstallResponse struct {
	Info string `json:"info"`
}

type UpgradeRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// RepoURL points at the chart repository hosting the chart. It is
	// required because releases do not record their origin repository, so
	// there is nothing to default it from.
	RepoURL string `json:"repoUrl"`
	Chart   string `json:"chart"`
	Version string `json:"version,omitempty"`
	// Values is the complete user values YAML for the new revision. An empty
	// value resets to the chart defaults, matching helm upgrade without
	// --reuse-values.
	Values string `json:"values,omitempty"`
}

type UpgradeResponse struct {
	Revision int `json:"revision"`
}

type RollbackRequest struct {
	ContextID string `json:"contextId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// Revision is the chart revision to restore to; zero restores the
	// previous revision.
	Revision int `json:"revision,omitempty"`
}

type RollbackResponse struct {
	Ok bool `json:"ok"`
}
