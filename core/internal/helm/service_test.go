// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"context"
	"errors"
	"strings"
	"testing"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	chartutil "helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/kube/fake"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
)

// testService wires the service against an in-memory Helm storage and a fake
// kube client, so release reads exercise the real helm action code without a
// cluster.
func testService(t *testing.T, store *storage.Storage) *Service {
	t.Helper()
	service := &Service{newConfiguration: func(context.Context, string, string) (*action.Configuration, error) {
		return &action.Configuration{
			KubeClient:   &fake.PrintingKubeClient{},
			Releases:     store,
			Capabilities: chartutil.DefaultCapabilities,
			Log:          func(string, ...interface{}) {},
		}, nil
	}}
	return service
}

// upgradeService stubs chart resolution with a minimal local chart so
// upgrades run without a chart repository.
func upgradeService(t *testing.T, store *storage.Storage) *Service {
	t.Helper()
	service := testService(t, store)
	service.locateChart = func(action.ChartPathOptions, string) (*chart.Chart, error) {
		return &chart.Chart{
			Metadata: &chart.Metadata{Name: "web", Version: "1.3.0"},
			Templates: []*chart.File{{
				Name: "templates/cm.yaml",
				Data: []byte("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-cm\ndata:\n  replicas: \"{{ .Values.replicas }}\"\n"),
			}},
		}, nil
	}
	return service
}

func testStorage(t *testing.T) *storage.Storage {
	t.Helper()
	store := storage.Init(driver.NewMemory())
	store.MaxHistory = 100
	return store
}

func chartRelease(name, namespace string, version int, status release.Status) *release.Release {
	return &release.Release{
		Name:      name,
		Namespace: namespace,
		Version:   version,
		Info:      &release.Info{Status: status, Description: "test release"},
		Chart:     &chart.Chart{Metadata: &chart.Metadata{Name: "web", Version: "1.2.3", AppVersion: "7.0"}},
		Config:    map[string]any{"replicas": 2, "auth": map[string]any{"token": "s3cret"}},
		Manifest:  "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-cm\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: web-secret\ndata:\n  password: c3VwZXJzZWNyZXQ=\n",
	}
}

func seed(t *testing.T, store *storage.Storage, items ...*release.Release) {
	t.Helper()
	for _, item := range items {
		if err := store.Create(item); err != nil {
			t.Fatalf("seed release: %v", err)
		}
	}
}

func TestListFiltersByNamespaceAndState(t *testing.T) {
	store := testStorage(t)
	seed(t, store,
		chartRelease("web", "apps", 1, release.StatusDeployed),
		chartRelease("api", "apps", 2, release.StatusSuperseded),
		chartRelease("legacy", "default", 1, release.StatusDeployed),
		chartRelease("broken", "apps", 1, release.StatusFailed),
	)
	service := testService(t, store)

	response, err := service.List(context.Background(), ListRequest{ContextID: "dev", Namespace: "apps"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(response.Releases) != 2 {
		t.Fatalf("apps releases = %d, want 2", len(response.Releases))
	}
	names := map[string]string{}
	for _, item := range response.Releases {
		names[item.Name] = item.Status
	}
	if names["web"] != "deployed" || names["broken"] != "failed" {
		t.Fatalf("releases = %#v", response.Releases)
	}
	for _, item := range response.Releases {
		if item.Chart != "web" || item.ChartVersion != "1.2.3" || item.AppVersion != "7.0" {
			t.Fatalf("summary = %#v", item)
		}
	}
}

func TestGetReturnsValuesManifestAndHistory(t *testing.T) {
	store := testStorage(t)
	seed(t, store,
		chartRelease("web", "apps", 1, release.StatusSuperseded),
		chartRelease("web", "apps", 2, release.StatusDeployed),
	)
	service := testService(t, store)

	response, err := service.Get(context.Background(), GetRequest{ContextID: "dev", Namespace: "apps", Name: "web"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	detail := response.Release
	if detail.Version != 2 || detail.Status != "deployed" {
		t.Fatalf("detail = %#v", detail)
	}
	if !strings.Contains(detail.Values, "replicas: 2") {
		t.Fatalf("values = %q", detail.Values)
	}
	// Values are user-authored chart input and travel unredacted; only
	// rendered manifests have Secret data masked.
	if strings.Contains(detail.Manifest, "c3VwZXJzZWNyZXQ=") || strings.Contains(detail.Manifest, "supersecret") {
		t.Fatalf("manifest leaked secret data: %q", detail.Manifest)
	}
	if !strings.Contains(detail.Manifest, "kind: ConfigMap") {
		t.Fatalf("manifest lost non-secret documents: %q", detail.Manifest)
	}
	if len(detail.History) != 2 {
		t.Fatalf("history = %#v", detail.History)
	}
}

func TestGetRejectsUnknownRelease(t *testing.T) {
	service := testService(t, testStorage(t))
	_, err := service.Get(context.Background(), GetRequest{ContextID: "dev", Namespace: "apps", Name: "missing"})
	if err == nil {
		t.Fatal("Get succeeded for a missing release")
	}
	var notFoundErr *NotFoundError
	if !errors.As(err, &notFoundErr) {
		t.Fatalf("error = %v, want NotFoundError", err)
	}
}

func TestServiceRejectsMissingInputs(t *testing.T) {
	service := testService(t, testStorage(t))
	cases := []struct {
		name    string
		request any
	}{
		{"list context", ListRequest{Namespace: "apps"}},
		{"list namespace", ListRequest{ContextID: "dev"}},
		{"get name", GetRequest{ContextID: "dev", Namespace: "apps"}},
		{"uninstall name", UninstallRequest{ContextID: "dev", Namespace: "apps"}},
		{"rollback name", RollbackRequest{ContextID: "dev", Namespace: "apps"}},
		{"rollback revision", RollbackRequest{ContextID: "dev", Namespace: "apps", Name: "web", Revision: -1}},
		{"upgrade name", UpgradeRequest{ContextID: "dev", Namespace: "apps", RepoURL: "https://example.test", Chart: "web"}},
		{"upgrade repoUrl", UpgradeRequest{ContextID: "dev", Namespace: "apps", Name: "web", Chart: "web"}},
		{"upgrade chart", UpgradeRequest{ContextID: "dev", Namespace: "apps", Name: "web", RepoURL: "https://example.test"}},
		{"upgrade values", UpgradeRequest{ContextID: "dev", Namespace: "apps", Name: "web", RepoURL: "https://example.test", Chart: "web", Values: "{{"}},
	}
	for _, test := range cases {
		var err error
		switch request := test.request.(type) {
		case ListRequest:
			_, err = service.List(context.Background(), request)
		case GetRequest:
			_, err = service.Get(context.Background(), request)
		case UninstallRequest:
			_, err = service.Uninstall(context.Background(), request)
		case RollbackRequest:
			_, err = service.Rollback(context.Background(), request)
		case UpgradeRequest:
			_, err = service.Upgrade(context.Background(), request)
		}
		var validationErr *ValidationError
		if err == nil || !errors.As(err, &validationErr) {
			t.Fatalf("%s: error = %v, want ValidationError", test.name, err)
		}
	}
}

func TestUninstallAndRollbackOnMissingRelease(t *testing.T) {
	service := testService(t, testStorage(t))
	_, err := service.Uninstall(context.Background(), UninstallRequest{ContextID: "dev", Namespace: "apps", Name: "missing"})
	if err == nil {
		t.Fatal("Uninstall succeeded for a missing release")
	}
	var notFoundErr *NotFoundError
	if !errors.As(err, &notFoundErr) {
		t.Fatalf("uninstall error = %v, want NotFoundError", err)
	}
	_, err = service.Rollback(context.Background(), RollbackRequest{ContextID: "dev", Namespace: "apps", Name: "missing"})
	if err == nil {
		t.Fatal("Rollback succeeded for a missing release")
	}
	if !errors.As(err, &notFoundErr) {
		t.Fatalf("rollback error = %v, want NotFoundError", err)
	}
}

func TestUpgradeCreatesNewRevisionWithValues(t *testing.T) {
	store := testStorage(t)
	seed(t, store, chartRelease("web", "apps", 1, release.StatusDeployed))
	service := upgradeService(t, store)

	response, err := service.Upgrade(context.Background(), UpgradeRequest{
		ContextID: "dev",
		Namespace: "apps",
		Name:      "web",
		RepoURL:   "https://charts.example.test",
		Chart:     "web",
		Version:   "1.3.0",
		Values:    "replicas: 3\n",
	})
	if err != nil {
		t.Fatalf("Upgrade: %v", err)
	}
	if response.Revision != 2 {
		t.Fatalf("revision = %d, want 2", response.Revision)
	}
	latest, err := store.Last("web")
	if err != nil {
		t.Fatalf("store.Last: %v", err)
	}
	if latest.Chart.Metadata.Version != "1.3.0" {
		t.Fatalf("chart version = %q, want 1.3.0", latest.Chart.Metadata.Version)
	}
	// YAML numbers arrive as float64 through the sigs.k8s.io/yaml JSON round trip.
	if latest.Config["replicas"] != float64(3) {
		t.Fatalf("config = %#v, want replicas 3", latest.Config)
	}
	if !strings.Contains(latest.Manifest, "replicas: \"3\"") {
		t.Fatalf("manifest did not render new values: %q", latest.Manifest)
	}
}

func TestUpgradeRejectsMissingRelease(t *testing.T) {
	service := upgradeService(t, testStorage(t))
	_, err := service.Upgrade(context.Background(), UpgradeRequest{
		ContextID: "dev",
		Namespace: "apps",
		Name:      "missing",
		RepoURL:   "https://charts.example.test",
		Chart:     "web",
	})
	var notFoundErr *NotFoundError
	if err == nil || !errors.As(err, &notFoundErr) {
		t.Fatalf("error = %v, want NotFoundError", err)
	}
}

func TestRedactManifestPassesThroughNonSecrets(t *testing.T) {
	input := "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\ndata:\n  key: value\n"
	output := redactManifest(input)
	if output != input {
		t.Fatalf("non-secret manifest changed: %q", output)
	}
}
