// SPDX-License-Identifier: Apache-2.0
package helm

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

type listConfig struct{ url string }

func (c listConfig) ClientConfig(string) (clientcmd.ClientConfig, error) {
	return clientcmd.NewDefaultClientConfig(clientcmdapi.Config{
		Clusters:       map[string]*clientcmdapi.Cluster{"test": {Server: c.url}},
		Contexts:       map[string]*clientcmdapi.Context{"test": {Cluster: "test"}},
		CurrentContext: "test",
	}, &clientcmd.ConfigOverrides{}), nil
}

func revisionMeta(namespace, name string, revision int, status string) metav1.PartialObjectMetadata {
	return metav1.PartialObjectMetadata{ObjectMeta: metav1.ObjectMeta{
		Name: fmt.Sprintf("sh.helm.release.v1.%s.v%d", name, revision), Namespace: namespace,
		Labels: map[string]string{"owner": "helm", "name": name, "version": fmt.Sprint(revision), "status": status},
	}}
}

func TestListPagesMetadataBeforeReadingOnlyLatestReleases(t *testing.T) {
	pages := 0
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/secrets" {
			pages++
			if r.URL.Query().Get("limit") == "" || r.URL.Query().Get("labelSelector") != "owner=helm" || !strings.Contains(r.Header.Get("Accept"), "PartialObjectMetadata") {
				t.Errorf("must use paginated metadata, got %s; accept=%s", r.URL, r.Header.Get("Accept"))
			}
			items := []metav1.PartialObjectMetadata{revisionMeta("apps", "web", 1, "deployed"), revisionMeta("apps", "hidden", 1, "deployed")}
			next := "page-2"
			if pages == 2 {
				if r.URL.Query().Get("continue") != "page-2" {
					t.Error("lost continuation")
				}
				items = []metav1.PartialObjectMetadata{revisionMeta("apps", "web", 2, "deployed"), revisionMeta("apps", "hidden", 2, "pending-upgrade"), revisionMeta("other", "web", 1, "failed")}
				next = ""
			}
			_ = json.NewEncoder(w).Encode(metav1.PartialObjectMetadataList{TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"}, ListMeta: metav1.ListMeta{Continue: next}, Items: items})
			return
		}
		reads.Add(1)
		if pages != 2 {
			t.Error("read payload before latest revisions were resolved")
		}
		var item *release.Release
		switch r.URL.Path {
		case "/api/v1/namespaces/apps/secrets/sh.helm.release.v1.web.v2":
			item = chartRelease("web", "apps", 2, release.StatusDeployed)
		case "/api/v1/namespaces/other/secrets/sh.helm.release.v1.web.v1":
			item = chartRelease("web", "other", 1, release.StatusFailed)
		default:
			t.Errorf("unexpected history/pending read: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		data, _ := json.Marshal(item)
		_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "Secret", "data": map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(data))}})
	}))
	defer server.Close()
	var events []ListEvent
	err := NewService(listConfig{server.URL}).StreamList(context.Background(), ListRequest{ContextID: "test"}, func(event ListEvent) error { events = append(events, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 || reads.Load() != 2 {
		t.Fatalf("pages=%d reads=%d", pages, reads.Load())
	}
	var items []ReleaseSummary
	for _, event := range events {
		items = append(items, event.Releases...)
	}
	if len(items) != 2 || items[0].Namespace == items[1].Namespace {
		t.Fatalf("lost namespace identity: %+v", items)
	}
	if events[len(events)-1].Kind != "done" {
		t.Fatal("missing completion")
	}
	encoded, _ := json.Marshal(events)
	if strings.Contains(string(encoded), "s3cret") || strings.Contains(string(encoded), "manifest") {
		t.Fatal("release content escaped summary")
	}
}

func TestListCancellationStopsMetadataRequest(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() { <-started; cancel() }()
	err := NewService(listConfig{server.URL}).StreamList(ctx, ListRequest{ContextID: "test"}, func(ListEvent) error { return nil })
	if err == nil {
		t.Fatal("cancelled query succeeded")
	}
	<-stopped
}

func TestListLargeHistoryIsMetadataOnlyAndNamespaceScoped(t *testing.T) {
	pages := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/namespaces/apps/secrets" {
			t.Errorf("unexpected payload read: %s", r.URL.Path)
		}
		pages++
		items := make([]metav1.PartialObjectMetadata, helmMetadataPageSize)
		for i := range items {
			items[i] = revisionMeta("apps", "history", (pages-1)*helmMetadataPageSize+i+1, "deployed")
		}
		next := fmt.Sprint(pages)
		if pages == 20 {
			// The newest revision hides the older deployed revisions across all pages.
			items[len(items)-1].Labels["status"] = "uninstalled"
			next = ""
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(metav1.PartialObjectMetadataList{TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"}, ListMeta: metav1.ListMeta{Continue: next}, Items: items})
	}))
	defer server.Close()
	response, err := NewService(listConfig{server.URL}).List(context.Background(), ListRequest{ContextID: "test", Namespace: "apps"})
	if err != nil {
		t.Fatal(err)
	}
	if pages != 20 || len(response.Releases) != 0 {
		t.Fatalf("pages=%d releases=%d", pages, len(response.Releases))
	}
}

func TestListReportsForbiddenAndExpiredSnapshots(t *testing.T) {
	for _, test := range []struct {
		code            int
		reason, message string
	}{{403, "Forbidden", "forbidden"}, {410, "Expired", "expired"}} {
		t.Run(test.reason, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.code)
				_ = json.NewEncoder(w).Encode(metav1.Status{TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Status"}, Status: "Failure", Code: int32(test.code), Reason: metav1.StatusReason(test.reason), Message: "sensitive upstream detail"})
			}))
			defer server.Close()
			err := NewService(listConfig{server.URL}).StreamList(context.Background(), ListRequest{ContextID: "test"}, func(ListEvent) error { return nil })
			if err == nil || !strings.Contains(err.Error(), test.message) || strings.Contains(err.Error(), "sensitive") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestDecodeSummaryCompressedProjectionAndLimits(t *testing.T) {
	item := chartRelease("web", "apps", 3, release.StatusDeployed)
	item.Info.LastDeployed = helmtime.Time{Time: time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)}
	data, _ := json.Marshal(item)
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, _ = writer.Write(data)
	_ = writer.Close()
	summary, err := decodeSummary([]byte(base64.StdEncoding.EncodeToString(compressed.Bytes())))
	if err != nil {
		t.Fatal(err)
	}
	if summary.ChartVersion != "1.2.3" || !summary.UpdatedAt.Equal(item.Info.LastDeployed.Time) {
		t.Fatalf("summary=%+v", summary)
	}
	compressed.Reset()
	writer = gzip.NewWriter(&compressed)
	_, _ = writer.Write(bytes.Repeat([]byte("x"), maxReleaseBytes+1))
	_ = writer.Close()
	_, err = decodeSummary([]byte(base64.StdEncoding.EncodeToString(compressed.Bytes())))
	if err == nil || !strings.Contains(err.Error(), "32 MiB") {
		t.Fatalf("unbounded decompression: %v", err)
	}
}

func TestListPagesAreAtomicLazyScopedAndRetryable(t *testing.T) {
	var metadataReads, payloadReads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/secrets" {
			metadataReads.Add(1)
			items := make([]metav1.PartialObjectMetadata, 105)
			for i := range items {
				items[i] = revisionMeta("apps", fmt.Sprintf("r%03d", i), 1, "deployed")
			}
			_ = json.NewEncoder(w).Encode(metav1.PartialObjectMetadataList{TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"}, Items: items})
			return
		}
		payloadReads.Add(1)
		name := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/v1/namespaces/apps/secrets/sh.helm.release.v1."), ".v1")
		data, _ := json.Marshal(chartRelease(name, "apps", 1, release.StatusDeployed))
		_ = json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "Secret", "data": map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(data))}})
	}))
	defer server.Close()
	service := NewService(listConfig{server.URL})
	request := ListRequest{ContextID: "test"}
	getPage := func(request ListRequest) ListEvent {
		t.Helper()
		var page ListEvent
		err := service.StreamList(context.Background(), request, func(event ListEvent) error {
			if event.Kind != "done" && len(event.Releases) != 0 {
				t.Error("partial rows escaped before the page was complete")
			}
			if event.Kind == "done" {
				page = event
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	first := getPage(request)
	if len(first.Releases) != 50 || first.ContinueToken == "" || payloadReads.Load() != 50 {
		t.Fatalf("first page count=%d reads=%d", len(first.Releases), payloadReads.Load())
	}
	request.ContinueToken = first.ContinueToken
	wrongScope := request
	wrongScope.Namespace = "other"
	if err := service.StreamList(context.Background(), wrongScope, func(ListEvent) error { return nil }); err == nil {
		t.Fatal("cursor escaped namespace scope")
	}
	second := getPage(request)
	if len(second.Releases) != 50 || second.Releases[0].Name != "r050" || payloadReads.Load() != 100 || metadataReads.Load() != 1 {
		t.Fatal("next page reloaded inventory or fetched future pages")
	}
	retry := getPage(request)
	if retry.Releases[0].Name != second.Releases[0].Name || retry.ContinueToken != second.ContinueToken {
		t.Fatal("retry advanced the cursor")
	}
	request.ContinueToken = second.ContinueToken
	last := getPage(request)
	if len(last.Releases) != 5 || last.ContinueToken != "" {
		t.Fatal("invalid final page")
	}
	service.CloseList(request)
	if err := service.StreamList(context.Background(), request, func(ListEvent) error { return nil }); err == nil {
		t.Fatal("closed view retained its snapshot")
	}
}

func TestCancellingPageCancelsAllReadsAndDropsNewInventory(t *testing.T) {
	started := make(chan struct{}, 4)
	var cancelled atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/secrets" {
			items := make([]metav1.PartialObjectMetadata, 51)
			for i := range items {
				items[i] = revisionMeta("apps", fmt.Sprintf("r%03d", i), 1, "deployed")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(metav1.PartialObjectMetadataList{TypeMeta: metav1.TypeMeta{APIVersion: "meta.k8s.io/v1", Kind: "PartialObjectMetadataList"}, Items: items})
			return
		}
		started <- struct{}{}
		<-r.Context().Done()
		cancelled.Add(1)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() {
		for i := 0; i < 4; i++ {
			select {
			case <-started:
			case <-ctx.Done():
				return
			}
		}
		cancel()
	}()
	service := NewService(listConfig{server.URL})
	err := service.StreamList(ctx, ListRequest{ContextID: "test"}, func(event ListEvent) error {
		if event.Kind == "done" || len(event.Releases) > 0 {
			t.Error("cancelled page committed rows")
		}
		return nil
	})
	if err == nil {
		t.Fatal("cancelled page succeeded")
	}
	server.Close() // Wait for all request handlers to observe cancellation.
	if cancelled.Load() != 4 {
		t.Fatalf("cancelled requests = %d", cancelled.Load())
	}
	if len(service.listSnapshots) != 0 {
		t.Fatal("cancelled first page retained its inventory")
	}
}

func TestHelmSnapshotExpiryAndCapacity(t *testing.T) {
	service := NewService(nil)
	first := &listSnapshot{contextID: "test", created: time.Now(), refs: make([]releaseRef, 51)}
	if err := service.saveList(first); err != nil {
		t.Fatal(err)
	}
	request := ListRequest{ContextID: "test", ContinueToken: first.id + ":50"}
	first.created = time.Now().Add(-helmSnapshotTTL)
	if _, _, err := service.resumeList(request); err == nil {
		t.Fatal("expired cursor was accepted")
	}
	for i := 0; i < maxHelmSnapshots; i++ {
		if err := service.saveList(&listSnapshot{contextID: "test", created: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}
	if len(service.listSnapshots) != maxHelmSnapshots || service.listSnapshots[first.id] != nil {
		t.Fatal("snapshot inventory exceeded capacity")
	}
}
