// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"context"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helm.sh/helm/v3/pkg/repo"
)

// testIndexYAML is a canned repository index: the "web" chart lists its
// versions deliberately out of semver order (1.10.0 must outrank 1.9.0) and
// includes a newer prerelease, plus a second chart to prove chart isolation.
const testIndexYAML = `apiVersion: v1
generated: "2026-10-01T00:00:00Z"
entries:
  edge:
    - apiVersion: v2
      appVersion: "3"
      created: "2026-09-01T00:00:00Z"
      description: Edge chart
      name: edge
      urls:
        - https://charts.example.test/edge-3.0.0.tgz
      version: 3.0.0
  web:
    - apiVersion: v2
      appVersion: 7.0.1
      created: "2026-03-03T00:00:00Z"
      description: Web server chart
      name: web
      urls:
        - https://charts.example.test/web-1.2.3.tgz
      version: 1.2.3
    - apiVersion: v2
      appVersion: 8.0.0
      created: "2026-04-04T00:00:00Z"
      description: Web server chart
      name: web
      urls:
        - https://charts.example.test/web-1.10.0.tgz
      version: 1.10.0
    - apiVersion: v2
      appVersion: 7.5.0
      created: "2026-02-02T00:00:00Z"
      description: Web server chart
      name: web
      urls:
        - https://charts.example.test/web-1.9.0.tgz
      version: 1.9.0
    - apiVersion: v2
      appVersion: 9.0.0-rc.1
      created: "2026-05-05T00:00:00Z"
      description: Web server chart prerelease
      name: web
      urls:
        - https://charts.example.test/web-2.0.0-rc.1.tgz
      version: 2.0.0-rc.1
`

// indexServer serves the canned index.yaml at /index.yaml.
func indexServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/yaml")
		fmt.Fprint(writer, testIndexYAML)
	}))
	t.Cleanup(server.Close)
	return server
}

// isolatedRepoConfig points the helm settings at a per-test repositories.yaml
// (or none at all when empty), so tests never touch the developer's config.
func isolatedRepoConfig(t *testing.T, content string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "repositories.yaml")
	if content != "" {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatalf("write repositories.yaml: %v", err)
		}
	}
	t.Setenv("HELM_REPOSITORY_CONFIG", path)
}

func TestChartVersionsOrdersNewestFirst(t *testing.T) {
	isolatedRepoConfig(t, "")
	server := indexServer(t)
	service := NewService(nil)

	response, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "web"})
	if err != nil {
		t.Fatalf("ChartVersions: %v", err)
	}
	got := make([]string, 0, len(response.Versions))
	for _, item := range response.Versions {
		got = append(got, item.Version)
	}
	want := []string{"2.0.0-rc.1", "1.10.0", "1.9.0", "1.2.3"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("versions = %v, want %v", got, want)
	}
	first := response.Versions[0]
	if first.AppVersion != "9.0.0-rc.1" || first.Description != "Web server chart prerelease" {
		t.Fatalf("first version metadata = %#v", first)
	}
	if first.Created.IsZero() || first.Created.Year() != 2026 {
		t.Fatalf("first version created = %v, want 2026", first.Created)
	}
}

func TestChartVersionsRejectsUnknownChart(t *testing.T) {
	isolatedRepoConfig(t, "")
	server := indexServer(t)
	service := NewService(nil)

	_, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "missing"})
	if err == nil {
		t.Fatal("ChartVersions succeeded for an unknown chart")
	}
	var notFoundErr *NotFoundError
	if !errors.As(err, &notFoundErr) {
		t.Fatalf("error = %v, want NotFoundError", err)
	}
}

func TestChartVersionsReportsUnreachableRepository(t *testing.T) {
	isolatedRepoConfig(t, "")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.Close()
	service := NewService(nil)

	_, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "web"})
	if err == nil {
		t.Fatal("ChartVersions succeeded for a down repository")
	}
	if !strings.Contains(err.Error(), "could not fetch the repository index") {
		t.Fatalf("error = %v, want a fetch failure", err)
	}
}

func TestChartVersionsRejectsInvalidInputs(t *testing.T) {
	isolatedRepoConfig(t, "")
	service := NewService(nil)
	cases := []struct {
		name    string
		request ChartVersionsRequest
	}{
		{"missing repoUrl", ChartVersionsRequest{Chart: "web"}},
		{"missing chart", ChartVersionsRequest{RepoURL: "https://charts.example.test"}},
		{"scheme-less repoUrl", ChartVersionsRequest{RepoURL: "charts.example.test", Chart: "web"}},
		{"oci repoUrl", ChartVersionsRequest{RepoURL: "oci://registry.example.test/charts", Chart: "web"}},
	}
	for _, test := range cases {
		_, err := service.ChartVersions(context.Background(), test.request)
		var validationErr *ValidationError
		if err == nil || !errors.As(err, &validationErr) {
			t.Fatalf("%s: error = %v, want ValidationError", test.name, err)
		}
	}
}

func TestChartVersionsRejectsInvalidIndex(t *testing.T) {
	isolatedRepoConfig(t, "")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, "entries: {web: [{version: 1.0.0}]}\n")
	}))
	t.Cleanup(server.Close)
	service := NewService(nil)

	_, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "web"})
	if err == nil {
		t.Fatal("ChartVersions succeeded for an index without apiVersion")
	}
	if !strings.Contains(err.Error(), "valid Helm index.yaml") {
		t.Fatalf("error = %v, want an invalid-index failure", err)
	}
}

// Credentials resolve from the user's repositories.yaml — the same file the
// upgrade path consults — and an unconfigured URL fetches anonymously.
func TestChartVersionsUsesCredentialsFromRepoConfig(t *testing.T) {
	authorized := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		authorized = ok && username == "deploy" && password == "s3cret"
		if !authorized {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		fmt.Fprint(writer, testIndexYAML)
	}))
	t.Cleanup(server.Close)

	// Without a matching repositories.yaml entry the anonymous fetch is
	// rejected by the server and surfaces as a clear fetch failure.
	isolatedRepoConfig(t, "apiVersion: v1\ngenerated: \"2026-10-01T00:00:00Z\"\nrepositories:\n  - name: other\n    url: https://other.example.test\n")
	service := NewService(nil)
	_, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "web"})
	if err == nil || !strings.Contains(err.Error(), "could not fetch the repository index") {
		t.Fatalf("anonymous error = %v, want a fetch failure", err)
	}

	// A matching entry (trailing slash tolerant) supplies the credentials.
	isolatedRepoConfig(t, fmt.Sprintf("apiVersion: v1\ngenerated: \"2026-10-01T00:00:00Z\"\nrepositories:\n  - name: charts\n    url: %s/\n    username: deploy\n    password: s3cret\n", server.URL))
	response, err := service.ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "web"})
	if err != nil {
		t.Fatalf("ChartVersions with credentials: %v", err)
	}
	if !authorized {
		t.Fatal("index request was not authorized with the configured credentials")
	}
	if len(response.Versions) != 4 {
		t.Fatalf("versions = %d, want 4", len(response.Versions))
	}
}

func TestChartVersionsBoundsResultToNewest100(t *testing.T) {
	isolatedRepoConfig(t, "")
	var index strings.Builder
	index.WriteString("apiVersion: v1\nentries:\n  many:\n")
	for minor := 0; minor < 120; minor++ {
		fmt.Fprintf(&index, "    - apiVersion: v2\n      name: many\n      version: 1.%d.0\n      created: \"2026-01-01T00:00:00Z\"\n", minor)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(writer, index.String())
	}))
	t.Cleanup(server.Close)

	response, err := NewService(nil).ChartVersions(context.Background(), ChartVersionsRequest{RepoURL: server.URL, Chart: "many"})
	if err != nil {
		t.Fatalf("ChartVersions: %v", err)
	}
	if len(response.Versions) != maxChartVersions {
		t.Fatalf("versions = %d, want %d", len(response.Versions), maxChartVersions)
	}
	if response.Versions[0].Version != "1.119.0" || response.Versions[maxChartVersions-1].Version != "1.20.0" {
		t.Fatalf("bounding kept the wrong slice: first=%s last=%s", response.Versions[0].Version, response.Versions[maxChartVersions-1].Version)
	}
}

func TestRepositoryIndexRejectsMalformedChartEntries(t *testing.T) {
	for _, entries := range []string{"[null]", "[{}, {}]", "[{name: web}]"} {
		t.Run(entries, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, "apiVersion: v1\nentries:\n  web: %s\n", entries)
			}))
			defer server.Close()
			_, err := fetchRepoIndex(context.Background(), repo.Entry{URL: server.URL})
			if err == nil || !strings.Contains(err.Error(), "invalid entry") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestRepositoryIndexDownloadLimitsStreamingBody(t *testing.T) {
	// Flushing removes Content-Length, so the streaming cap must do the work.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.(http.Flusher).Flush()
		fmt.Fprint(w, strings.Repeat("x", 1024))
	}))
	defer server.Close()
	_, err := downloadRepoIndex(context.Background(), repo.Entry{URL: server.URL}, 32)
	if err == nil || !strings.Contains(err.Error(), "read limit") {
		t.Fatalf("error = %v", err)
	}
}

func TestRepositoryIndexDownloadCancellation(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := downloadRepoIndex(ctx, repo.Entry{URL: server.URL}, 32); result <- err }()
	<-started
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled download stayed open")
	}
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request was not cancelled")
	}
}

func TestRepositoryIndexDownloadUsesConfiguredCA(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, testIndexYAML) }))
	defer server.Close()
	caFile := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := fetchRepoIndex(context.Background(), repo.Entry{URL: server.URL, CAFile: caFile}); err != nil {
		t.Fatal(err)
	}
}
