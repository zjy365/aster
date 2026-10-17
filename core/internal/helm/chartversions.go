// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
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
	index, err := fetchRepoIndex(settings, entry)
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

// fetchRepoIndex downloads and parses the repository's index.yaml through the
// helm getters, so HTTP semantics (credentials, TLS material, proxies) match
// the helm CLI exactly. The result is stateless: nothing is cached.
func fetchRepoIndex(settings *cli.EnvSettings, entry repo.Entry) (*repo.IndexFile, error) {
	parsed, err := url.Parse(entry.URL)
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	client, err := getter.All(settings).ByScheme(parsed.Scheme)
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	indexURL, err := repo.ResolveReferenceURL(entry.URL, "index.yaml")
	if err != nil {
		return nil, invalid("repoUrl must be a full http(s) repository URL")
	}
	data, err := client.Get(indexURL,
		getter.WithURL(entry.URL),
		getter.WithUserAgent(version.UserAgent()),
		getter.WithTimeout(repoIndexTimeout),
		getter.WithInsecureSkipVerifyTLS(entry.InsecureSkipTLSverify),
		getter.WithTLSClientConfig(entry.CertFile, entry.KeyFile, entry.CAFile),
		getter.WithBasicAuth(entry.Username, entry.Password),
		getter.WithPassCredentialsAll(entry.PassCredentialsAll),
	)
	if err != nil {
		return nil, fmt.Errorf("could not fetch the repository index for %q: %w; verify the repository URL is reachable and, for private repositories, added to your local helm config with credentials (helm repo add)", entry.URL, err)
	}
	raw, err := io.ReadAll(io.LimitReader(data, maxRepoIndexBytes+1))
	if err != nil {
		return nil, fmt.Errorf("could not read the repository index for %q: %w", entry.URL, err)
	}
	if len(raw) > maxRepoIndexBytes {
		return nil, fmt.Errorf("repository index for %q exceeds the 64 MiB read limit", entry.URL)
	}
	index := &repo.IndexFile{}
	if err := yaml.Unmarshal(raw, index); err != nil {
		return nil, fmt.Errorf("repository %q did not return a valid Helm index.yaml: %w", entry.URL, err)
	}
	if index.APIVersion == "" {
		return nil, fmt.Errorf("repository %q did not return a valid Helm index.yaml (missing apiVersion)", entry.URL)
	}
	// Newest first per chart (canonical Helm index ordering).
	index.SortEntries()
	return index, nil
}
