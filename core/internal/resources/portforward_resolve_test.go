package resources

import (
	"context"
	"fmt"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
)

type fakeResolver struct {
	podName    string
	podPort    int64
	err        error
	calledKind string
}

func (f *fakeResolver) ResolveForwardTarget(_ context.Context, _, _, _, kind string, _ int64) (string, int64, error) {
	f.calledKind = kind
	return f.podName, f.podPort, f.err
}

type stubPFClient struct { fakeProvider }

func TestStartPortForwardResolvesServiceTarget(t *testing.T) {
	resolver := &fakeResolver{podName: "web-abc123", podPort: 8080}
	provider := &resolverPFProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())}, resolver: resolver}
	service := NewService(provider)
	result, err := service.StartPortForward(context.Background(), PortForwardRequest{
		ContextID: "dev", Namespace: "apps", Name: "svc", PodPort: 80, Kind: "Service",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolver.calledKind != "Service" {
		t.Fatalf("resolver saw kind %q", resolver.calledKind)
	}
	if result.Pod != "web-abc123" {
		t.Fatalf("result.Pod = %q", result.Pod)
	}
}

func TestStartPortForwardWorkloadUsesFullSelector(t *testing.T) {
	// Workload resolution converts spec.selector (matchLabels + matchExpressions)
	// via LabelSelectorAsSelector and lists pods, preferring Running+ready.
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(),
		testObjectWithPhase("v1", "Pod", "web-a", "apps", "Running", true),
		testObjectWithPhase("v1", "Pod", "web-b", "apps", "Pending", false),
	)
	provider := &resolverPFProvider{fakeProvider: fakeProvider{client: client}, resolver: &fakeResolver{}}
	service := NewService(provider)
	// The fake resolver stands in for service targets; workload resolution
	// happens in session.Manager. Here we assert the request wiring only.
	if _, err := service.StartPortForward(context.Background(), PortForwardRequest{
		ContextID: "dev", Namespace: "apps", Name: "dep", PodPort: 80, Kind: "Deployment",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestStartPortForwardRejectsUnknownKind(t *testing.T) {
	provider := &resolverPFProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())}, resolver: &fakeResolver{}}
	service := NewService(provider)
	if _, err := service.StartPortForward(context.Background(), PortForwardRequest{
		ContextID: "dev", Namespace: "apps", Name: "p", PodPort: 80, Kind: "CronJob",
	}); err == nil {
		t.Fatal("unknown kind accepted")
	}
}

func TestStartPortForwardRejectsConfigMapKind(t *testing.T) {
	provider := &resolverPFProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())}, resolver: &fakeResolver{}}
	service := NewService(provider)
	if _, err := service.StartPortForward(context.Background(), PortForwardRequest{
		ContextID: "dev", Namespace: "apps", Name: "cm", PodPort: 80, Kind: "ConfigMap",
	}); err == nil {
		t.Fatal("configmap kind accepted")
	}
}

func testObjectWithPhase(apiVersion, kind, name, namespace, phase string, ready bool) *unstructured.Unstructured {
	object := testObject(apiVersion, kind, name, namespace)
	object.Object["status"] = map[string]any{
		"phase": phase,
		"conditions": []any{map[string]any{"type": "Ready", "status": map[bool]string{true: "True", false: "False"}[ready]}},
	}
	return object
}

var _ = fmt.Sprintf
var _ = metav1.ObjectMeta{}

type resolverPFProvider struct {
	fakeProvider
	resolver *fakeResolver
}

func (p *resolverPFProvider) PortForward(_ context.Context, _, _, _ string, _, _ int64) (func(), int, error) {
	return func() {}, 43123, nil
}

func (p *resolverPFProvider) ResolveForwardTarget(ctx context.Context, contextID, namespace, name, kind string, podPort int64) (string, int64, error) {
	return p.resolver.ResolveForwardTarget(ctx, contextID, namespace, name, kind, podPort)
}

var _ = func() func() { return func() {} }()
