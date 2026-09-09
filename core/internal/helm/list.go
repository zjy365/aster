// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	helmtime "helm.sh/helm/v3/pkg/time"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	corev1 "k8s.io/client-go/kubernetes/typed/core/v1"
	"k8s.io/client-go/metadata"
	"k8s.io/client-go/rest"

	"github.com/zjy365/aster/core/internal/version"
)

const helmMetadataPageSize = 500
const helmReleasePageSize = 50
const helmSnapshotTTL = 5 * time.Minute
const maxHelmSnapshots = 4
const helmReadTimeout = 20 * time.Second
const maxReleaseBytes = 32 << 20

// ListEvent contains only progress and projected summaries, never storage data.
type ListEvent struct {
	Kind          string           `json:"kind"`
	Releases      []ReleaseSummary `json:"releases,omitempty"`
	Message       string           `json:"message,omitempty"`
	ContinueToken string           `json:"continueToken,omitempty"`
}

type releaseRef struct {
	namespace, name, secret, status, resourceVersion string
	revision                                         int
}

// listSnapshot retains only the selected view's revision references, not clients
// or Secret payloads. Cursors pin this inventory across page requests. Refresh,
// view disposal, a five-minute TTL and the capacity cap retire it.
type listSnapshot struct {
	id, contextID, namespace string
	created                  time.Time
	refs                     []releaseRef
	scanned                  int
}

// StreamList delivers ONE atomic page. Progress frames keep the transport
// cancellable during slow upstream reads; they never contain partial rows.
func (s *Service) StreamList(ctx context.Context, request ListRequest, emit func(ListEvent) error) (err error) {
	started := time.Now()
	completed, scanned := 0, 0
	defer func() {
		category := "ok"
		if err != nil {
			category = "failed"
		}
		if errors.Is(err, context.Canceled) {
			category = "cancelled"
		}
		slog.Info("helm list page", "outcome", category, "elapsed_ms", time.Since(started).Milliseconds(), "scanned", scanned, "completed", completed)
	}()
	if strings.TrimSpace(request.ContextID) == "" {
		return invalid("contextId is required")
	}
	if len(request.ContinueToken) > 128 {
		return invalid("Helm continuation token is too long")
	}
	if s.clients == nil {
		return fmt.Errorf("Helm client is unavailable")
	}
	raw, err := s.clients.ClientConfig(request.ContextID)
	if err != nil {
		return fmt.Errorf("load Helm context: %w", err)
	}
	config, err := raw.ClientConfig()
	if err != nil {
		return fmt.Errorf("configure Helm client: %w", err)
	}
	config = rest.CopyConfig(config)
	config.Timeout = helmReadTimeout
	// At most four reads run concurrently, with an explicit per-view request
	// budget instead of either unbounded fan-out or one slow GET at a time.
	if config.QPS == 0 {
		config.QPS = 20
	}
	if config.Burst == 0 {
		config.Burst = 4
	}
	config.UserAgent = version.UserAgent()
	client, err := corev1.NewForConfig(config)
	if err != nil {
		return err
	}
	var snapshot *listSnapshot
	offset := 0
	if request.ContinueToken != "" {
		snapshot, offset, err = s.resumeList(request)
		if err != nil {
			return err
		}
	} else {
		metaClient, clientErr := metadata.NewForConfig(config)
		if clientErr != nil {
			return clientErr
		}
		snapshot, err = scanReleases(ctx, metaClient, request, emit)
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(snapshot.refs) > helmReleasePageSize {
			if err := s.saveList(snapshot); err != nil {
				return err
			}
			// If the first page never reaches the caller, do not retain its inventory.
			defer func() {
				if err != nil {
					s.dropList(snapshot.id)
				}
			}()
		}
	}
	scanned = snapshot.scanned
	end := min(offset+helmReleasePageSize, len(snapshot.refs))
	pageRefs := snapshot.refs[offset:end]
	page := make([]ReleaseSummary, len(pageRefs))
	readCtx, cancel := context.WithCancel(ctx)
	var workers sync.WaitGroup
	defer func() { cancel(); workers.Wait() }()
	type result struct {
		index   int
		summary ReleaseSummary
		err     error
	}
	results := make(chan result, 4)
	// Bound concurrency and decompression memory. No payload from the next page
	// is fetched until the user explicitly requests that page.
	for worker := 0; worker < min(4, len(pageRefs)); worker++ {
		workers.Add(1)
		go func(start int) {
			defer workers.Done()
			for index := start; index < len(pageRefs); index += 4 {
				if readCtx.Err() != nil {
					return
				}
				summary, err := readReleaseSummary(readCtx, client, pageRefs[index])
				select {
				case results <- result{index, summary, err}:
				case <-readCtx.Done():
					return
				}
				if err != nil {
					return
				}
			}
		}(worker)
	}
	for completed < len(pageRefs) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case result := <-results:
			if result.err != nil {
				return result.err
			}
			page[result.index] = result.summary
			completed++
			if err := emit(ListEvent{Kind: "progress"}); err != nil {
				return err
			}
		}
	}
	next := ""
	if end < len(snapshot.refs) {
		next = fmt.Sprintf("%s:%d", snapshot.id, end)
	}
	return emit(ListEvent{Kind: "done", Releases: page, ContinueToken: next})
}

func readReleaseSummary(ctx context.Context, client corev1.CoreV1Interface, ref releaseRef) (ReleaseSummary, error) {
	secret, err := client.Secrets(ref.namespace).Get(ctx, ref.secret, metav1.GetOptions{})
	if err != nil {
		return ReleaseSummary{}, listReadError(ctx, err)
	}
	if ref.resourceVersion != "" && secret.ResourceVersion != ref.resourceVersion {
		return ReleaseSummary{}, fmt.Errorf("Helm releases changed during loading; refresh to retry")
	}
	summary, err := decodeSummary(secret.Data["release"])
	if err != nil {
		return ReleaseSummary{}, fmt.Errorf("Cannot read Helm release %s/%s: %w", ref.namespace, ref.name, err)
	}
	if summary.Name != ref.name || summary.Namespace != ref.namespace || summary.Version != ref.revision || summary.Status != ref.status {
		return ReleaseSummary{}, fmt.Errorf("Helm release metadata does not match its contents; refresh after repairing the release")
	}
	return summary, nil
}

func scanReleases(ctx context.Context, client metadata.Interface, request ListRequest, emit func(ListEvent) error) (*listSnapshot, error) {
	refs := make(map[string]releaseRef)
	options := metav1.ListOptions{LabelSelector: "owner=helm", Limit: helmMetadataPageSize}
	scanned := 0
	for {
		page, err := client.Resource(schema.GroupVersionResource{Version: "v1", Resource: "secrets"}).Namespace(request.Namespace).List(ctx, options)
		if err != nil {
			return nil, listReadError(ctx, err)
		}
		for _, item := range page.Items {
			if !strings.HasPrefix(item.Name, "sh.helm.release.v1.") {
				continue
			}
			revision, err := strconv.Atoi(item.Labels["version"])
			name := item.Labels["name"]
			if err != nil || revision < 1 || name == "" {
				return nil, fmt.Errorf("Helm storage has invalid release labels; repair the release metadata and refresh")
			}
			key := item.Namespace + "/" + name
			if previous, ok := refs[key]; !ok || revision > previous.revision {
				refs[key] = releaseRef{namespace: item.Namespace, name: name, secret: item.Name, revision: revision, status: item.Labels["status"], resourceVersion: item.ResourceVersion}
			}
		}
		if len(refs) > 100000 {
			return nil, fmt.Errorf("Helm inventory exceeds 100,000 releases; choose a narrower namespace scope")
		}
		scanned += len(page.Items)
		if err := emit(ListEvent{Kind: "progress"}); err != nil {
			return nil, err
		}
		if page.Continue == "" {
			break
		}
		if page.Continue == options.Continue {
			return nil, fmt.Errorf("Helm pagination did not advance; refresh to retry")
		}
		options.Continue = page.Continue
	}
	latest := make([]releaseRef, 0, len(refs))
	for _, ref := range refs {
		// Selecting latest first prevents old deployed versions from reappearing
		// when the latest revision is pending, uninstalled or superseded.
		if ref.status == "deployed" || ref.status == "failed" {
			latest = append(latest, ref)
		}
	}
	sort.Slice(latest, func(i, j int) bool {
		if latest[i].name != latest[j].name {
			return latest[i].name < latest[j].name
		}
		return latest[i].namespace < latest[j].namespace
	})
	return &listSnapshot{contextID: request.ContextID, namespace: request.Namespace, created: time.Now(), refs: latest, scanned: scanned}, nil
}

func (s *Service) saveList(snapshot *listSnapshot) error {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	snapshot.id = hex.EncodeToString(random[:])
	s.listMu.Lock()
	defer s.listMu.Unlock()
	if s.listSnapshots == nil {
		s.listSnapshots = make(map[string]*listSnapshot)
	}
	if len(s.listSnapshots) >= maxHelmSnapshots {
		var oldest *listSnapshot
		for _, entry := range s.listSnapshots {
			if oldest == nil || entry.created.Before(oldest.created) {
				oldest = entry
			}
		}
		delete(s.listSnapshots, oldest.id)
	}
	s.listSnapshots[snapshot.id] = snapshot
	id := snapshot.id
	time.AfterFunc(helmSnapshotTTL, func() { s.dropList(id) })
	return nil
}

func (s *Service) resumeList(request ListRequest) (*listSnapshot, int, error) {
	id, cursor, _ := strings.Cut(request.ContinueToken, ":")
	offset, parseError := strconv.Atoi(cursor)
	s.listMu.Lock()
	defer s.listMu.Unlock()
	snapshot := s.listSnapshots[id]
	if snapshot == nil || parseError != nil || snapshot.contextID != request.ContextID || snapshot.namespace != request.Namespace || time.Since(snapshot.created) >= helmSnapshotTTL || offset < helmReleasePageSize || offset%helmReleasePageSize != 0 || offset >= len(snapshot.refs) {
		return nil, 0, fmt.Errorf("Helm page is unavailable or expired; refresh to start a new listing")
	}
	return snapshot, offset, nil
}

func (s *Service) dropList(id string) {
	s.listMu.Lock()
	defer s.listMu.Unlock()
	delete(s.listSnapshots, id)
}

// CloseList releases an explicit view's inventory when it closes or refreshes.
func (s *Service) CloseList(request ListRequest) {
	id, _, _ := strings.Cut(request.ContinueToken, ":")
	s.listMu.Lock()
	defer s.listMu.Unlock()
	if snapshot := s.listSnapshots[id]; snapshot != nil && snapshot.contextID == request.ContextID && snapshot.namespace == request.Namespace {
		delete(s.listSnapshots, id)
	}
}

func listReadError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if apierrors.IsForbidden(err) {
		return fmt.Errorf("Helm access forbidden: permission to list and get release Secrets is required in the selected namespace scope")
	}
	if apierrors.IsUnauthorized(err) {
		return fmt.Errorf("Helm authentication failed; refresh your Kubernetes credentials")
	}
	if apierrors.IsResourceExpired(err) || apierrors.IsGone(err) {
		return fmt.Errorf("Helm listing expired; refresh to start a new snapshot")
	}
	if errors.Is(err, context.DeadlineExceeded) || apierrors.IsTimeout(err) {
		return fmt.Errorf("Helm request timed out after 20 seconds; try a narrower namespace scope or check the cluster connection")
	}
	if apierrors.IsNotFound(err) {
		return fmt.Errorf("A Helm release changed during loading; refresh to retry")
	}
	return fmt.Errorf("Helm could not read release Secrets from Kubernetes; check the cluster connection")
}

// Decode the documented Helm storage encoding into a narrow projection. Values,
// manifests and chart files are skipped by JSON decoding and never retained.
func decodeSummary(encoded []byte) (ReleaseSummary, error) {
	if len(encoded) > maxReleaseBytes {
		return ReleaseSummary{}, fmt.Errorf("stored release exceeds the 32 MiB read limit")
	}
	data, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		return ReleaseSummary{}, fmt.Errorf("invalid release encoding")
	}
	var reader io.Reader = bytes.NewReader(data)
	if len(data) >= 2 && data[0] == 0x1f && data[1] == 0x8b {
		compressed, err := gzip.NewReader(reader)
		if err != nil {
			return ReleaseSummary{}, fmt.Errorf("invalid compressed release")
		}
		defer compressed.Close()
		reader = compressed
	}
	data, err = io.ReadAll(io.LimitReader(reader, maxReleaseBytes+1))
	if err != nil {
		return ReleaseSummary{}, fmt.Errorf("invalid compressed release")
	}
	if len(data) > maxReleaseBytes {
		return ReleaseSummary{}, fmt.Errorf("expanded release exceeds the 32 MiB read limit")
	}
	var projection struct {
		Name      string
		Namespace string
		Version   int
		Info      struct {
			Status       string
			Description  string
			LastDeployed helmtime.Time `json:"last_deployed"`
		}
		Chart struct {
			Metadata struct {
				Name       string
				Version    string
				AppVersion string
			}
		}
	}
	if err := json.Unmarshal(data, &projection); err != nil {
		return ReleaseSummary{}, fmt.Errorf("invalid release JSON")
	}
	return ReleaseSummary{Name: projection.Name, Namespace: projection.Namespace, Version: projection.Version, Status: projection.Info.Status, Description: projection.Info.Description, UpdatedAt: projection.Info.LastDeployed.Time, Chart: projection.Chart.Metadata.Name, ChartVersion: projection.Chart.Metadata.Version, AppVersion: projection.Chart.Metadata.AppVersion}, nil
}
