package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/zjy365/aster/core/internal/helm"
	"github.com/zjy365/aster/core/internal/resources"
	"github.com/zjy365/aster/core/internal/session"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

type fakeContexts struct {
	values []session.ContextInfo
}

func (f fakeContexts) Contexts() ([]session.ContextInfo, error) {
	return f.values, nil
}

func (fakeContexts) SourceReports() session.SourcesReport {
	return session.SourcesReport{}
}

func (fakeContexts) RenameEntry(_, _, _, _ string) error {
	return nil
}

type rpcClientProvider struct {
	client dynamic.Interface
}

func (p rpcClientProvider) Client(string) (dynamic.Interface, error) {
	return p.client, nil
}

type capturingPFProvider struct {
	rpcClientProvider
	captured context.Context
	stop     func()
}

func (p *capturingPFProvider) PortForward(ctx context.Context, _, _, _ string, _, _ int64) (func(), int, error) {
	p.captured = ctx
	return p.stop, 43123, nil
}

func TestStartPortForwardDetachesFromRequestContext(t *testing.T) {
	provider := &capturingPFProvider{
		rpcClientProvider: rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())},
		stop:              func() {},
	}
	service := resources.NewService(provider)
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/pods/portforward",
		strings.NewReader(`{"contextId":"dev","namespace":"apps","name":"web","podPort":80}`))
	request.Header.Set("Authorization", "Bearer token")
	requestCtx, cancel := context.WithCancel(context.Background())
	request = request.WithContext(requestCtx)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", recorder.Code, recorder.Body.String())
	}
	cancel()
	select {
	case <-provider.captured.Done():
		t.Fatal("forward context was cancelled when the start request ended")
	default:
	}
}

func TestServerRequiresTokenAndServesHealthAndContexts(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", fakeContexts{values: []session.ContextInfo{{ID: "dev", Name: "dev", Current: true}}}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	unauthorized := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/health", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.Code)
	}

	health := performRequest(t, server, http.MethodGet, "/health")
	if health.Code != http.StatusOK {
		t.Fatalf("health status = %d, body=%s", health.Code, health.Body.String())
	}

	contexts := performRequest(t, server, http.MethodGet, "/v1/contexts")
	var response struct {
		Contexts []session.ContextInfo `json:"contexts"`
	}
	if err := json.NewDecoder(contexts.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if len(response.Contexts) != 1 || response.Contexts[0].Name != "dev" {
		t.Fatalf("response = %#v", response)
	}
}

func TestServerListsNamespaces(t *testing.T) {
	namespace := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": "default"},
	}}
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme(), namespace)})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}
	response := performRequest(t, server, http.MethodGet, "/v1/namespaces?contextId=dev&limit=20")
	if response.Code != http.StatusOK || !contains(response.Body.String(), `"name":"default"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestServerRejectsInvalidResourceRequest(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/v1/resources/list", bytes.NewBufferString(`{
		"contextId":"dev",
		"gvr":{"version":"v1","resource":"widgets"}
	}`))
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestServerServesOverviewAndValidatesContext(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{
		{Version: "v1", Resource: "nodes"}:      "NodeList",
		{Version: "v1", Resource: "pods"}:       "PodList",
		{Version: "v1", Resource: "namespaces"}: "NamespaceList",
		{Version: "v1", Resource: "services"}:   "ServiceList",
		{Version: "v1", Resource: "events"}:     "EventList",
	})})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	missing := performRequest(t, server, http.MethodGet, "/v1/overview")
	if missing.Code != http.StatusBadRequest || !contains(missing.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", missing.Code, missing.Body.String())
	}

	response := performRequest(t, server, http.MethodGet, "/v1/overview?contextId=dev")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var value struct {
		Nodes      struct{ Total, Ready int64 } `json:"nodes"`
		Namespaces int64                        `json:"namespaces"`
		Events     []map[string]any             `json:"events"`
	}
	if err := json.NewDecoder(response.Body).Decode(&value); err != nil {
		t.Fatal(err)
	}
	if value.Nodes.Total != 0 || value.Namespaces != 0 {
		t.Fatalf("overview = %#v", value)
	}
	if value.Events == nil {
		t.Fatal("events must decode as an empty array")
	}
}

func TestServerStreamsWatchAsNDJSONAndStopsOnCancel(t *testing.T) {
	watcher := watch.NewRaceFreeFake()
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("pods", func(clienttesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	service := resources.NewService(rpcClientProvider{client: client})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}
	requestContext, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodPost, "/v1/resources/watch", strings.NewReader(`{
		"contextId":"dev",
		"gvr":{"version":"v1","resource":"pods"},
		"namespace":"apps",
		"resourceVersion":"42"
	}`)).WithContext(requestContext)
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.Handler().ServeHTTP(response, request)
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	pod := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Pod",
		"metadata": map[string]any{"name": "web", "namespace": "apps", "resourceVersion": "43"},
	}}
	watcher.Add(pod)
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not stop after cancellation")
	}
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("status=%d content-type=%q body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"type":"ADDED"`) || !strings.Contains(response.Body.String(), `"name":"web"`) {
		t.Fatalf("body=%s", response.Body.String())
	}
	if !watcher.IsStopped() {
		t.Fatal("watcher was not stopped")
	}
}

func TestServerValidatesHelmRequests(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	// An empty namespace is now valid (all namespaces); only a missing
	// context id is rejected at the RPC boundary.
	missingContext := performRequest(t, server, http.MethodGet, "/v1/helm/releases")
	if missingContext.Code != http.StatusBadRequest || !contains(missingContext.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", missingContext.Code, missingContext.Body.String())
	}

	missingName := httptest.NewRequest(http.MethodPost, "/v1/helm/releases/get", bytes.NewBufferString(`{
		"contextId":"dev",
		"namespace":"apps"
	}`))
	missingName.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, missingName)
	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	badRevision := httptest.NewRequest(http.MethodPost, "/v1/helm/releases/rollback", bytes.NewBufferString(`{
		"contextId":"dev",
		"namespace":"apps",
		"name":"web",
		"revision":-3
	}`))
	badRevision.Header.Set("Authorization", "Bearer token")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, badRevision)
	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	missingChart := httptest.NewRequest(http.MethodPost, "/v1/helm/releases/upgrade", bytes.NewBufferString(`{
		"contextId":"dev",
		"namespace":"apps",
		"name":"web",
		"repoUrl":"https://charts.example.test"
	}`))
	missingChart.Header.Set("Authorization", "Bearer token")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, missingChart)
	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func performRequest(t *testing.T, server *Server, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func contains(value, fragment string) bool {
	for i := 0; i+len(fragment) <= len(value); i++ {
		if value[i:i+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
