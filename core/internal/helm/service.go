// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	diskcache "k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"
)

// ClientConfigProvider lazily yields the client config for a context. The
// session manager implements it; no kubeconfig contents cross this boundary.
type ClientConfigProvider interface {
	ClientConfig(contextID string) (clientcmd.ClientConfig, error)
}

// maxDetailBytes caps values and rendered manifests leaving the core; larger
// payloads are truncated and flagged, mirroring the pod logs cap.
const maxDetailBytes = 4 << 20

type Service struct {
	clients ClientConfigProvider
	// newConfiguration replaces the real client wiring in tests so the
	// service can run against an in-memory Helm storage without a cluster.
	newConfiguration func(ctx context.Context, contextID, namespace string) (*action.Configuration, error)
	// locateChart replaces chart resolution in tests so upgrades run without
	// a chart repository.
	locateChart func(options action.ChartPathOptions, name string) (*chart.Chart, error)
}

func NewService(clients ClientConfigProvider) *Service {
	return &Service{clients: clients}
}

// restClientGetter adapts a clientcmd client config to Helm's client loader.
// Client construction stays lazy: nothing connects until an action runs.
type restClientGetter struct {
	config clientcmd.ClientConfig
}

func (r *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	return r.config.ClientConfig()
}

func (r *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	config, err := r.config.ClientConfig()
	if err != nil {
		return nil, err
	}
	config.UserAgent = "aster/0.1"
	client, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return nil, err
	}
	return diskcache.NewMemCacheClient(client), nil
}

func (r *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	client, err := r.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	return restmapper.NewDeferredDiscoveryRESTMapper(client), nil
}

func (r *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	return r.config
}

func (s *Service) configuration(ctx context.Context, contextID, namespace string) (*action.Configuration, error) {
	if s.newConfiguration != nil {
		return s.newConfiguration(ctx, contextID, namespace)
	}
	if strings.TrimSpace(contextID) == "" {
		return nil, invalid("contextId is required")
	}
	raw, err := s.clients.ClientConfig(contextID)
	if err != nil {
		return nil, fmt.Errorf("load context %q: %w", contextID, err)
	}
	config := &action.Configuration{}
	if err := config.Init(&restClientGetter{config: raw}, namespace, "", func(_ string, _ ...interface{}) {}); err != nil {
		return nil, fmt.Errorf("initialize helm client: %w", err)
	}
	return config, nil
}

func (s *Service) List(ctx context.Context, request ListRequest) (ListResponse, error) {
	if request.ContextID == "" {
		return ListResponse{}, invalid("contextId is required")
	}
	config, err := s.configuration(ctx, request.ContextID, request.Namespace)
	if err != nil {
		return ListResponse{}, err
	}
	client := action.NewList(config)
	client.StateMask = action.ListDeployed | action.ListFailed
	client.ByDate = true
	client.SortReverse = true
	// An empty namespace means every namespace (helm list -A semantics): the
	// secret driver lists across namespaces when the lazy client's namespace
	// is empty, so empty namespace flows through configuration() unmodified.
	releases, err := client.Run()
	if err != nil {
		return ListResponse{}, fmt.Errorf("list releases: %w", err)
	}
	response := ListResponse{Releases: make([]ReleaseSummary, 0, len(releases))}
	for _, item := range releases {
		response.Releases = append(response.Releases, summarize(item))
	}
	return response, nil
}

func (s *Service) Get(ctx context.Context, request GetRequest) (GetResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return GetResponse{}, invalid("contextId, namespace and name are required")
	}
	config, err := s.configuration(ctx, request.ContextID, request.Namespace)
	if err != nil {
		return GetResponse{}, err
	}
	client := action.NewGet(config)
	item, err := client.Run(request.Name)
	if err != nil {
		if isNotFound(err) {
			return GetResponse{}, notFound(fmt.Sprintf("release %q was not found", request.Name))
		}
		return GetResponse{}, fmt.Errorf("get release %q: %w", request.Name, err)
	}
	history, err := s.history(ctx, config, request.Name)
	if err != nil {
		return GetResponse{}, err
	}
	manifest, manifestTruncated := capText(item.Manifest)
	if !manifestTruncated {
		manifest = redactManifest(manifest)
	}
	values, valuesTruncated := capText(valuesYAML(item.Config))
	chartValues := ""
	chartValuesTruncated := false
	if item.Chart != nil {
		chartValues, chartValuesTruncated = capText(valuesYAML(item.Chart.Values))
	}
	notes, _ := capText(item.Info.Notes)
	detail := ReleaseDetail{
		ReleaseSummary: summarize(item),
		Notes:          notes,
		Values:         values,
		Manifest:       manifest,
		ChartValues:    chartValues,
		Truncated:      manifestTruncated || valuesTruncated || chartValuesTruncated,
		History:        history,
	}
	return GetResponse{Release: detail}, nil
}

func (s *Service) history(ctx context.Context, config *action.Configuration, name string) ([]ReleaseSummary, error) {
	client := action.NewHistory(config)
	items, err := client.Run(name)
	if err != nil {
		if isNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read release history %q: %w", name, err)
	}
	summaries := make([]ReleaseSummary, 0, len(items))
	for _, item := range items {
		summaries = append(summaries, summarize(item))
	}
	return summaries, nil
}

func (s *Service) Uninstall(ctx context.Context, request UninstallRequest) (UninstallResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return UninstallResponse{}, invalid("contextId, namespace and name are required")
	}
	config, err := s.configuration(ctx, request.ContextID, request.Namespace)
	if err != nil {
		return UninstallResponse{}, err
	}
	client := action.NewUninstall(config)
	client.Timeout = 5 * time.Minute
	response, err := client.Run(request.Name)
	if err != nil {
		if isNotFound(err) {
			return UninstallResponse{}, notFound(fmt.Sprintf("release %q was not found", request.Name))
		}
		return UninstallResponse{}, fmt.Errorf("uninstall release %q: %w", request.Name, err)
	}
	info := strings.TrimSpace(response.Info)
	if info == "" {
		info = fmt.Sprintf("Release %q uninstalled", request.Name)
	}
	return UninstallResponse{Info: info}, nil
}

// loadChart resolves the upgrade chart through the user's local Helm
// settings (repository config and credentials, matching the helm CLI), or
// through the injected fake in tests.
func (s *Service) loadChart(options action.ChartPathOptions, name string) (*chart.Chart, error) {
	if s.locateChart != nil {
		return s.locateChart(options, name)
	}
	path, err := options.LocateChart(name, cli.New())
	if err != nil {
		return nil, fmt.Errorf("locate chart %q: %w", name, err)
	}
	loaded, err := loader.Load(path)
	if err != nil {
		return nil, fmt.Errorf("load chart %q: %w", name, err)
	}
	return loaded, nil
}

func (s *Service) Upgrade(ctx context.Context, request UpgradeRequest) (UpgradeResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return UpgradeResponse{}, invalid("contextId, namespace and name are required")
	}
	values := map[string]any{}
	if strings.TrimSpace(request.Values) != "" {
		if err := yaml.Unmarshal([]byte(request.Values), &values); err != nil {
			return UpgradeResponse{}, invalid(fmt.Sprintf("values is not valid YAML: %v", err))
		}
	}
	config, err := s.configuration(ctx, request.ContextID, request.Namespace)
	if err != nil {
		return UpgradeResponse{}, err
	}
	client := action.NewUpgrade(config)
	client.Timeout = 5 * time.Minute

	var loaded *chart.Chart
	if strings.TrimSpace(request.RepoURL) == "" {
		// Values-only upgrade: releases store their chart's full contents, so an
		// empty repoUrl reuses that stored chart instead of re-pulling one. The
		// chart and version inputs are meaningless here and ignored.
		existing, err := action.NewGet(config).Run(request.Name)
		if err != nil {
			if isNotFound(err) {
				return UpgradeResponse{}, notFound(fmt.Sprintf("release %q was not found", request.Name))
			}
			return UpgradeResponse{}, fmt.Errorf("load stored chart for release %q: %w", request.Name, err)
		}
		if existing.Chart == nil {
			return UpgradeResponse{}, invalid(fmt.Sprintf("release %q has no stored chart; repoUrl and chart are required", request.Name))
		}
		loaded = existing.Chart
	} else {
		if strings.TrimSpace(request.Chart) == "" {
			return UpgradeResponse{}, invalid("chart is required when repoUrl is set")
		}
		client.RepoURL = request.RepoURL
		client.Version = request.Version
		resolved, err := s.loadChart(client.ChartPathOptions, request.Chart)
		if err != nil {
			// Charts resolve through the user's local helm settings
			// (repositories.yaml and credentials), so a lookup failure usually
			// means the repository was never configured locally.
			return UpgradeResponse{}, fmt.Errorf("pull chart %q from %q: %w; verify the repository is added to your local helm config (helm repo add)", request.Chart, request.RepoURL, err)
		}
		loaded = resolved
	}
	upgraded, err := client.RunWithContext(ctx, request.Name, loaded, values)
	if err != nil {
		if isNotFound(err) {
			return UpgradeResponse{}, notFound(fmt.Sprintf("release %q was not found", request.Name))
		}
		return UpgradeResponse{}, fmt.Errorf("upgrade release %q: %w", request.Name, err)
	}
	return UpgradeResponse{Revision: upgraded.Version}, nil
}

func (s *Service) Rollback(ctx context.Context, request RollbackRequest) (RollbackResponse, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return RollbackResponse{}, invalid("contextId, namespace and name are required")
	}
	if request.Revision < 0 || request.Revision > 1_000_000 {
		return RollbackResponse{}, invalid("revision must be zero or a positive revision number")
	}
	config, err := s.configuration(ctx, request.ContextID, request.Namespace)
	if err != nil {
		return RollbackResponse{}, err
	}
	client := action.NewRollback(config)
	client.Timeout = 5 * time.Minute
	client.Version = request.Revision
	if err := client.Run(request.Name); err != nil {
		if isNotFound(err) {
			return RollbackResponse{}, notFound(fmt.Sprintf("release %q was not found", request.Name))
		}
		return RollbackResponse{}, fmt.Errorf("rollback release %q: %w", request.Name, err)
	}
	return RollbackResponse{Ok: true}, nil
}

func summarize(item *release.Release) ReleaseSummary {
	summary := ReleaseSummary{
		Name:      item.Name,
		Namespace: item.Namespace,
		Version:   item.Version,
	}
	if item.Info != nil {
		summary.Status = string(item.Info.Status)
		summary.UpdatedAt = item.Info.LastDeployed.Time
		summary.Description = item.Info.Description
	}
	if item.Chart != nil && item.Chart.Metadata != nil {
		summary.Chart = item.Chart.Metadata.Name
		summary.ChartVersion = item.Chart.Metadata.Version
		summary.AppVersion = item.Chart.Metadata.AppVersion
	}
	return summary
}

// valuesYAML serializes the merged config values map as YAML for display.
func valuesYAML(values map[string]any) string {
	if len(values) == 0 {
		return ""
	}
	jsonValue, err := json.Marshal(values)
	if err != nil {
		return ""
	}
	yamlValue, err := yaml.JSONToYAML(jsonValue)
	if err != nil {
		return ""
	}
	return string(yamlValue)
}

func capText(value string) (string, bool) {
	if len(value) <= maxDetailBytes {
		return value, false
	}
	return value[:maxDetailBytes], true
}

func isNotFound(err error) bool {
	// Upgrade reports a missing release as ErrNoDeployedReleases instead of
	// ErrReleaseNotFound; both mean the renderer should show not-found.
	return errors.Is(err, driver.ErrReleaseNotFound) || errors.Is(err, driver.ErrNoDeployedReleases)
}
