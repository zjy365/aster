// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
)

type fakePFProvider struct {
	fakeProvider
	stopCalls *int
}

func (f fakePFProvider) PortForward(context.Context, string, string, string, int64) (func(), int, error) {
	return func() { *f.stopCalls++ }, 43123, nil
}

func TestPortForwardRegistryLifecycle(t *testing.T) {
	stopCalls := 0
	service := NewService(fakePFProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())}, stopCalls: &stopCalls})

	first, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "context", Namespace: "apps", Name: "web", PodPort: 8080})
	if err != nil || first.LocalPort != 43123 || first.ID == "" {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	second, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "context", Namespace: "apps", Name: "web", PodPort: 9090})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.StopPortForward(context.Background(), first.ID); err != nil {
		t.Fatal(err)
	}
	if stopCalls != 1 {
		t.Fatalf("stopCalls=%d", stopCalls)
	}
	if err := service.StopPortForward(context.Background(), first.ID); err == nil {
		t.Fatal("stopping a reclaimed forward was accepted")
	}
	if err := service.StopPortForward(context.Background(), "  "); err == nil {
		t.Fatal("blank id was accepted")
	}
	service.StopAllPortForwards()
	if stopCalls != 2 {
		t.Fatalf("stopCalls=%d after StopAll", stopCalls)
	}
	_ = second
	if _, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "context", Namespace: "apps", Name: "web", PodPort: 0}); err == nil || !strings.Contains(err.Error(), "podPort") {
		t.Fatalf("port 0 err=%v", err)
	}
}
