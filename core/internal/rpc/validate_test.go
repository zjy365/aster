package rpc

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zjy365/aster/core/internal/helm"
	"github.com/zjy365/aster/core/internal/resources"
)

func performJSONRequest(t *testing.T, server *Server, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func TestValidateListRequest(t *testing.T) {
	valid := resources.ListRequest{
		ContextID: "ctx",
		GVR:       resources.GVR{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespace: "default",
		Limit:     500,
	}
	if err := validateListRequest(valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	cases := map[string]resources.ListRequest{
		"missing contextId": {GVR: valid.GVR},
		"long contextId":    {ContextID: strings.Repeat("x", maxContextID+1), GVR: valid.GVR},
		"missing version":   {ContextID: "ctx", GVR: resources.GVR{Resource: "pods"}},
		"missing resource":  {ContextID: "ctx", GVR: resources.GVR{Version: "v1"}},
		"limit too large":   {ContextID: "ctx", GVR: valid.GVR, Limit: maxListLimit + 1},
		"negative limit":    {ContextID: "ctx", GVR: valid.GVR, Limit: -1},
		"long continue":     {ContextID: "ctx", GVR: valid.GVR, ContinueToken: strings.Repeat("x", maxContinueToken+1)},
		"long selector":     {ContextID: "ctx", GVR: valid.GVR, LabelSelector: strings.Repeat("x", maxSelector+1)},
	}
	for name, request := range cases {
		if err := validateListRequest(request); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestValidateMutationRequest(t *testing.T) {
	base := resources.MutationRequest{
		ContextID: "ctx",
		GVR:       resources.GVR{Version: "v1", Resource: "configmaps"},
		Name:      "cm",
		Operation: "delete",
	}
	if err := validateMutationRequest(base); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	create := resources.MutationRequest{
		ContextID: "ctx",
		GVR:       base.GVR,
		Operation: "create",
		YAML:      "kind: ConfigMap",
	}
	if err := validateMutationRequest(create); err != nil {
		t.Fatalf("create without name rejected: %v", err)
	}

	cases := map[string]resources.MutationRequest{
		"unknown operation": {ContextID: "ctx", GVR: base.GVR, Name: "cm", Operation: "patch"},
		"missing name":      {ContextID: "ctx", GVR: base.GVR, Operation: "delete"},
		"oversized yaml":    {ContextID: "ctx", GVR: base.GVR, Operation: "create", YAML: strings.Repeat("x", maxYAML+1)},
		"long image":        {ContextID: "ctx", GVR: base.GVR, Name: "cm", Operation: "image", Image: strings.Repeat("x", maxImage+1)},
	}
	for name, request := range cases {
		if err := validateMutationRequest(request); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}

	negative := int64(-1)
	if err := validateMutationRequest(resources.MutationRequest{ContextID: "ctx", GVR: base.GVR, Name: "cm", Operation: "scale", Replicas: &negative}); err == nil {
		t.Error("negative replicas: expected rejection")
	}
	over := int64(maxReplicas + 1)
	if err := validateMutationRequest(resources.MutationRequest{ContextID: "ctx", GVR: base.GVR, Name: "cm", Operation: "scale", Replicas: &over}); err == nil {
		t.Error("oversized replicas: expected rejection")
	}
}

func TestValidateWatchRequest(t *testing.T) {
	valid := resources.WatchRequest{
		ContextID:       "ctx",
		GVR:             resources.GVR{Version: "v1", Resource: "pods"},
		ResourceVersion: "12345",
	}
	if err := validateWatchRequest(valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	valid.ResourceVersion = strings.Repeat("9", maxWatchResourceVersion+1)
	if err := validateWatchRequest(valid); err == nil {
		t.Error("oversized resourceVersion: expected rejection")
	}
}

func TestValidatePortForwardRequests(t *testing.T) {
	if err := validatePortForwardRequest(resources.PortForwardRequest{ContextID: "ctx", Namespace: "default", Name: "pod", PodPort: 8080}); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	if err := validatePortForwardRequest(resources.PortForwardRequest{ContextID: "ctx", Namespace: "default", Name: "pod", PodPort: 0}); err == nil {
		t.Error("zero podPort: expected rejection")
	}
	if err := validatePortForwardStopRequest(resources.PortForwardStopRequest{ID: strings.Repeat("x", maxPortForwardID+1)}); err == nil {
		t.Error("oversized id: expected rejection")
	}
}

func TestValidatePortForwardLocalPort(t *testing.T) {
	base := resources.PortForwardRequest{ContextID: "ctx", Namespace: "default", Name: "pod", PodPort: 8080}
	if err := validatePortForwardRequest(base); err != nil {
		t.Fatalf("random localPort rejected: %v", err)
	}
	base.LocalPort = 8080
	if err := validatePortForwardRequest(base); err != nil {
		t.Fatalf("explicit localPort rejected: %v", err)
	}
	for _, bad := range []int{-1, 65_536} {
		base.LocalPort = bad
		if err := validatePortForwardRequest(base); err == nil {
			t.Fatalf("localPort %d accepted", bad)
		}
	}
}

func TestInvalidInputReturns400(t *testing.T) {
	service := resources.NewService(rpcClientProvider{client: nil})
	server, err := NewServer("token", fakeContexts{}, service, helm.NewService(nil))
	if err != nil {
		t.Fatal(err)
	}

	body := `{"contextId":"` + strings.Repeat("x", maxContextID+1) + `","gvr":{"version":"v1","resource":"pods"}}`
	response := performJSONRequest(t, server, http.MethodPost, "/v1/resources/list", body)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body=%s", response.Code, response.Body.String())
	}

	longContext := "/v1/namespaces?contextId=" + strings.Repeat("x", maxContextID+1)
	response = performRequest(t, server, http.MethodGet, longContext)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("namespaces status = %d, body=%s", response.Code, response.Body.String())
	}

	response = performRequest(t, server, http.MethodGet, "/v1/discovery")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("discovery status = %d, body=%s", response.Code, response.Body.String())
	}
}
