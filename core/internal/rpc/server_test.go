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

	"github.com/zjy365/aster/core/internal/resources"
	"github.com/zjy365/aster/core/internal/session"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
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

type rpcClientProvider struct {
	client dynamic.Interface
}

func (p rpcClientProvider) Client(string) (dynamic.Interface, error) {
	return p.client, nil
}

func TestServerRequiresTokenAndServesHealthAndContexts(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", fakeContexts{values: []session.ContextInfo{{ID: "dev", Name: "dev", Current: true}}}, service)
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
	server, err := NewServer("token", fakeContexts{}, service)
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
	server, err := NewServer("token", fakeContexts{}, service)
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

func TestServerStreamsWatchAsNDJSONAndStopsOnCancel(t *testing.T) {
	watcher := watch.NewRaceFreeFake()
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("pods", func(clienttesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	service := resources.NewService(rpcClientProvider{client: client})
	server, err := NewServer("token", fakeContexts{}, service)
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
