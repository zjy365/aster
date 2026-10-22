package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/zjy365/aster/core/internal/helm"
	"github.com/zjy365/aster/core/internal/resources"
	"github.com/zjy365/aster/core/internal/session"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

type fakeContexts struct {
	values []session.ContextInfo
}

func (f fakeContexts) Contexts() ([]session.ContextInfo, error) {
	return f.values, nil
}

func (f fakeContexts) Health(_ context.Context, ids []string) []session.ContextHealth {
	results := make([]session.ContextHealth, len(ids))
	for index, id := range ids {
		results[index] = session.ContextHealth{ID: id, Status: "ok", Version: "v1.30.0"}
	}
	return results
}

func (fakeContexts) SourceReports() session.SourcesReport {
	return session.SourcesReport{}
}

func (fakeContexts) RenameEntry(_, _, _, _ string) error {
	return nil
}

func (fakeContexts) ExportContext(contextID string) ([]byte, error) {
	return nil, fmt.Errorf("%w: %q", session.ErrContextNotFound, contextID)
}

// exportContexts fakes the export endpoint's backend with a fixed document.
type exportContexts struct {
	fakeContexts
	document string
}

func (e exportContexts) ExportContext(contextID string) ([]byte, error) {
	if contextID != "dev" {
		return nil, fmt.Errorf("%w: %q", session.ErrContextNotFound, contextID)
	}
	return []byte(e.document), nil
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
	t.Cleanup(service.StopAllPortForwards)
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

	for _, target := range []string{
		"/v1/helm/chart-versions?chart=web",
		"/v1/helm/chart-versions?repoUrl=" + url.QueryEscape("https://charts.example.test"),
		"/v1/helm/chart-versions?repoUrl=not-a-url&chart=web",
	} {
		invalid := performRequest(t, server, http.MethodGet, target)
		if invalid.Code != http.StatusBadRequest || !contains(invalid.Body.String(), `"code":"invalid_request"`) {
			t.Fatalf("target %s: status=%d body=%s", target, invalid.Code, invalid.Body.String())
		}
	}
}

func TestServerContextsHealth(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	ok := httptest.NewRequest(http.MethodPost, "/v1/contexts/health", bytes.NewBufferString(`{"contextIds":["dev","prod"]}`))
	ok.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, ok)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Health []session.ContextHealth `json:"health"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Health) != 2 || body.Health[0].ID != "dev" || body.Health[0].Status != "ok" || body.Health[1].ID != "prod" {
		t.Fatalf("unexpected health payload: %+v", body.Health)
	}

	for _, payload := range []string{`{}`, `{"contextIds":[]}`, `{"contextIds":[""]}`} {
		invalid := httptest.NewRequest(http.MethodPost, "/v1/contexts/health", bytes.NewBufferString(payload))
		invalid.Header.Set("Authorization", "Bearer token")
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, invalid)
		if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
			t.Fatalf("payload %s: status=%d body=%s", payload, response.Code, response.Body.String())
		}
	}
}

func TestServerExportsSingleContextKubeconfig(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	server, err := NewServer("token", exportContexts{document: "apiVersion: v1\nkind: Config\ncurrent-context: dev\n"}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/contexts/export", bytes.NewBufferString(`{"contextId":"dev"}`))
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Kubeconfig string `json:"kubeconfig"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body.Kubeconfig, "current-context: dev") {
		t.Fatalf("kubeconfig = %q", body.Kubeconfig)
	}

	// Unknown context: 404, not a 500 — the shell surfaces it as a stale id.
	missing := httptest.NewRequest(http.MethodPost, "/v1/contexts/export", bytes.NewBufferString(`{"contextId":"gone"}`))
	missing.Header.Set("Authorization", "Bearer token")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, missing)
	if response.Code != http.StatusNotFound || !contains(response.Body.String(), `"code":"not_found"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	for _, payload := range []string{`{}`, `{"contextId":""}`} {
		invalid := httptest.NewRequest(http.MethodPost, "/v1/contexts/export", bytes.NewBufferString(payload))
		invalid.Header.Set("Authorization", "Bearer token")
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, invalid)
		if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_request"`) {
			t.Fatalf("payload %s: status=%d body=%s", payload, response.Code, response.Body.String())
		}
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

type rpcNodeProvider struct {
	rpcClientProvider
	core kubernetes.Interface
}

func (p rpcNodeProvider) NodeClient(string) (kubernetes.Interface, error) {
	return p.core, nil
}

func newDrainServer(t *testing.T) (*Server, *kubernetesfake.Clientset) {
	t.Helper()
	clientset := kubernetesfake.NewSimpleClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-1"}})
	clientset.PrependReactor("create", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		create := action.(clienttesting.CreateAction)
		if create.GetSubresource() != "eviction" {
			return false, nil, nil
		}
		eviction := create.GetObject().(*policyv1.Eviction)
		if err := clientset.Tracker().Delete(schema.GroupVersionResource{Version: "v1", Resource: "pods"}, eviction.Namespace, eviction.Name); err != nil {
			return true, nil, err
		}
		return true, eviction, nil
	})
	service := resources.NewService(rpcNodeProvider{
		rpcClientProvider: rpcClientProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())},
		core:              clientset,
	})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}
	return server, clientset
}

func TestServerCordonNode(t *testing.T) {
	server, _ := newDrainServer(t)
	request := httptest.NewRequest(http.MethodPost, "/v1/nodes/cordon",
		strings.NewReader(`{"contextId":"dev","nodeName":"worker-1","unschedulable":true}`))
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !contains(response.Body.String(), `"unschedulable":true`) || !contains(response.Body.String(), `"changed":true`) {
		t.Fatalf("body=%s", response.Body.String())
	}

	for _, payload := range []string{`{"nodeName":"worker-1"}`, `{"contextId":"dev"}`, `{"contextId":"dev","nodeName":"` + strings.Repeat("n", 254) + `"}`} {
		invalid := httptest.NewRequest(http.MethodPost, "/v1/nodes/cordon", strings.NewReader(payload))
		invalid.Header.Set("Authorization", "Bearer token")
		rejected := httptest.NewRecorder()
		server.Handler().ServeHTTP(rejected, invalid)
		if rejected.Code != http.StatusBadRequest || !contains(rejected.Body.String(), `"code":"invalid_request"`) {
			t.Fatalf("payload %s: status=%d body=%s", payload, rejected.Code, rejected.Body.String())
		}
	}
}

func TestServerStreamsDrainAsNDJSON(t *testing.T) {
	server, clientset := newDrainServer(t)
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web-1",
			Namespace:       "apps",
			OwnerReferences: []metav1.OwnerReference{{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "web-abc", Controller: ptrTo(true)}},
		},
		Spec:   corev1.PodSpec{NodeName: "worker-1"},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	if _, err := clientset.CoreV1().Pods("apps").Create(context.Background(), &pod, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/nodes/drain",
		strings.NewReader(`{"contextId":"dev","nodeName":"worker-1","options":{"ignoreDaemonsets":true}}`))
	request.Header.Set("Authorization", "Bearer token")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("status=%d content-type=%q body=%s", response.Code, response.Header().Get("Content-Type"), response.Body.String())
	}

	var events []resources.NodeDrainEvent
	for _, line := range strings.Split(strings.TrimSpace(response.Body.String()), "\n") {
		if line == "" {
			continue
		}
		var event resources.NodeDrainEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatalf("line %q: %v", line, err)
		}
		events = append(events, event)
	}
	if len(events) != 4 {
		t.Fatalf("events = %#v", events)
	}
	if events[0].Type != "cordon" || !events[0].Unschedulable || !events[0].Changed || events[0].Node != "worker-1" {
		t.Fatalf("cordon event = %#v", events[0])
	}
	if events[1].Type != "pod" || events[1].Pod != "web-1" || events[1].Namespace != "apps" || events[1].Status != "evicting" {
		t.Fatalf("evicting event = %#v", events[1])
	}
	if events[2].Type != "pod" || events[2].Status != "evicted" {
		t.Fatalf("evicted event = %#v", events[2])
	}
	summary := events[3]
	if summary.Type != "summary" || !summary.Complete || summary.Evicted != 1 || summary.Total != 1 {
		t.Fatalf("summary = %#v", summary)
	}
}

func ptrTo(value bool) *bool { return &value }
