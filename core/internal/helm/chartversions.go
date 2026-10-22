// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/repo"
	"sigs.k8s.io/yaml"

	"github.com/zjy365/aster/core/internal/version"
)

const (
	// maxChartVersions bounds the response; anything past the newest 100
	// versions of a chart is not reachable by hand in a picker anyway.
	maxChartVersions = 100
	// maxRepoIndexBytes caps the parsed index.yaml before YAML decoding, so a
	// hostile or broken repository cannot balloon core memory.
	maxRepoIndexBytes = 64 << 20
	// repoIndexTimeout bounds one index fetch; repositories are remote.
	repoIndexTimeout = 20 * time.Second
)

// ChartVersions lists the versions an upgrade can pin for one chart in the
// repository at request.RepoURL, newest first. Credentials come from the
// user's local helm repository config (repositories.yaml) — the same source
// of truth the upgrade path consults when it pulls the chart — so a
// repository added with `helm repo add` (including private ones) resolves
// with its stored credentials. A URL that is not configured locally still
// resolves anonymously, matching `helm upgrade --repo <url>`.
func (s *Service) ChartVersions(ctx context.Context, request ChartVersionsRequest) (ChartVersionsResponse, error) {
	repoURL := strings.TrimSpace(request.RepoURL)
	chart := strings.TrimSpace(request.Chart)
	if repoURL == "" {
		return ChartVersionsResponse{}, invalid("repoUrl is required")
	}
	if chart == "" {
		return ChartVersionsResponse{}, invalid("chart is required")
	}
	if err := ctx.Err(); err != nil {
		return ChartVersionsResponse{}, err
	}
	parsed, err := url.Parse(repoURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ChartVersionsResponse{}, invalid("repoUrl must be a full http(s) repository URL")
	}
	settings := cli.New()
	entry := repoEntryForURL(settings.RepositoryConfig, repoURL)
	index, err := fetchRepoIndex(ctx, entry)
	if err != nil {
		return ChartVersionsResponse{}, err
	}
	entries := index.Entries[chart]
	if len(entries) == 0 {
		return ChartVersionsResponse{}, notFound(fmt.Sprintf("chart %q was not found in repository %s", chart, repoURL))
	}
	versions := make([]ChartVersionInfo, 0, min(len(entries), maxChartVersions))
	for _, item := range entries {
		if len(versions) >= maxChartVersions {
			break
		}
		info := ChartVersionInfo{Version: item.Version, Created: item.Created}
		if item.Metadata != nil {
			info.AppVersion = item.AppVersion
			info.Description = item.Description
		}
		versions = append(versions, info)
	}
	return ChartVersionsResponse{Versions: versions}, nil
}

// repoEntryForURL resolves credentials for a repository URL from the user's
// local helm repository config, mirroring how the upgrade path's chart
// download consults repositories.yaml. A URL that is not configured (or a
// missing config file) resolves anonymously — public repositories keep
// working without `helm repo add`, exactly like the upgrade path.
func repoEntryForURL(configPath, repoURL string) repo.Entry {
	entry := repo.Entry{URL: repoURL}
	file, err := repo.LoadFile(configPath)
	if err != nil {
		return entry
	}
	normalized := strings.TrimRight(repoURL, "/")
	for _, candidate := range file.Repositories {
		if candidate == nil || strings.TrimRight(candidate.URL, "/") != normalized {
			continue
		}
		entry.Username = candidate.Username
		entry.Password = candidate.Password
		entry.CertFile = candidate.CertFile
		entry.KeyFile = candidate.KeyFile
		entry.CAFile = candidate.CAFile
		entry.InsecureSkipTLSverify = candidate.InsecureSkipTLSverify
		entry.PassCredentialsAll = candidate.PassCredentialsAll
		break
	}
	return entry
}

// fetchRepoIndex reads a repository index with a streaming size cap before
// decoding it. The request shares the RPC cancellation and repository TLS/auth
// settings; Helm's getter buffers whole responses before returning them.
func fetchRepoIndex(ctx context.Context, entry repo.Entry) (*repo.IndexFile, error) {
	raw, err := downloadRepoIndex(ctx, entry, maxRepoIndexBytes)
	if err != nil {
		return nil, err
	}
	index := &repo.IndexFile{}
	if err := yaml.Unmarshal(raw, index); err != nil {
		return nil, fmt.Errorf("repository %q did not return a valid Helm index.yaml: %w", entry.URL, err)
	}
	if index.APIVersion == "" {
		return nil, fmt.Errorf("repository %q did not return a valid Helm index.yaml (missing apiVersion)", entry.URL)
	}
	// Validate all entries before sorting: Helm's embedded Metadata can be nil
	// for sparse YAML, and both SortEntries and the picker dereference it.
	for name, entries := range index.Entries {
		for _, item := range entries {
			if item == nil || item.Metadata == nil || item.Version == "" {
				return nil, fmt.Errorf("repository %q contains an invalid entry for chart %q", entry.URL, name)
			}
		}
	}
	index.SortEntries()
	return index, nil
}

func downloadRepoIndex(ctx context.Context, entry repo.Entry, maxBytes int64) ([]byte, error) {
	indexURL, err := repo.ResolveReferenceURL(entry.URL, "index.yaml")
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	tlsConfig := &tls.Config{InsecureSkipVerify: entry.InsecureSkipTLSverify}
	if entry.CertFile != "" && entry.KeyFile != "" {
		certificate, err := tls.LoadX509KeyPair(entry.CertFile, entry.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("load repository client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{certificate}
	}
	if entry.CAFile != "" {
		ca, err := os.ReadFile(entry.CAFile)
		if err != nil {
			return nil, fmt.Errorf("read repository CA: %w", err)
		}
		tlsConfig.RootCAs = x509.NewCertPool()
		if !tlsConfig.RootCAs.AppendCertsFromPEM(ca) {
			return nil, fmt.Errorf("repository CA contains no certificates")
		}
	}
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment, DisableCompression: true, TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: repoIndexTimeout}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	request.Header.Set("User-Agent", version.UserAgent())
	source, err := url.Parse(entry.URL)
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	if entry.PassCredentialsAll || (source.Scheme == request.URL.Scheme && source.Host == request.URL.Host) {
		if entry.Username != "" && entry.Password != "" {
			request.SetBasicAuth(entry.Username, entry.Password)
		}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("could not fetch the repository index for %q: %w; verify the repository URL and local helm credentials (helm repo add)", entry.URL, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("could not fetch the repository index for %q: %s", entry.URL, response.Status)
	}
	if response.ContentLength > maxBytes {
		return nil, fmt.Errorf("repository index for %q exceeds the read limit (%d bytes)", entry.URL, maxBytes)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read the repository index for %q: %w", entry.URL, err)
	}
	if int64(len(raw)) > maxBytes {
		return nil, fmt.Errorf("repository index for %q exceeds the read limit (%d bytes)", entry.URL, maxBytes)
	}
	return raw, nil
}
