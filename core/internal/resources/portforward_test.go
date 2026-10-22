// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
)

type fakePFProvider struct {
	fakeProvider
	stopCalls *int
}

func (f fakePFProvider) PortForward(context.Context, string, string, string, int64, int64) (func(), int, error) {
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
	if err := service.StopPortForward(context.Background(), first.ID); err != nil {
		t.Fatal("retrying a reclaimed forward failed")
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

type lifecyclePFProvider struct {
	fakeProvider
	start func(context.Context) (func(), int, error)
}

func (p lifecyclePFProvider) PortForward(ctx context.Context, _, _, _ string, _, _ int64) (func(), int, error) {
	return p.start(ctx)
}

func TestPortForwardSetupCancellation(t *testing.T) {
	for _, lateSuccess := range []bool{false, true} {
		t.Run(fmt.Sprint(lateSuccess), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stopped := false
			provider := lifecyclePFProvider{start: func(forwardCtx context.Context) (func(), int, error) {
				cancel()
				select {
				case <-forwardCtx.Done():
				case <-time.After(time.Second):
					t.Fatal("setup did not cancel")
				}
				if lateSuccess {
					return func() { stopped = true }, 43123, nil
				}
				return nil, 0, forwardCtx.Err()
			}}
			service := NewService(provider)
			_, err := service.StartPortForward(ctx, PortForwardRequest{ContextID: "dev", Namespace: "apps", Name: "web", PodPort: 80})
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("err=%v", err)
			}
			if len(service.portForwards) != 0 || stopped != lateSuccess {
				t.Fatalf("registry=%d stopped=%v", len(service.portForwards), stopped)
			}
		})
	}
}

func TestPortForwardListRegistry(t *testing.T) {
	resolver := &fakeResolver{podName: "grafana-xyz", podPort: 3000}
	service := NewService(&resolverPFProvider{fakeProvider: fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())}, resolver: resolver})

	devFirst, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "dev", Namespace: "apps", Name: "web", PodPort: 8080})
	if err != nil {
		t.Fatal(err)
	}
	devSecond, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "dev", Namespace: "monitoring", Name: "grafana", PodPort: 80, Kind: "Service"})
	if err != nil {
		t.Fatal(err)
	}
	prod, err := service.StartPortForward(context.Background(), PortForwardRequest{ContextID: "prod", Namespace: "apps", Name: "api", PodPort: 443})
	if err != nil {
		t.Fatal(err)
	}

	all := service.ListPortForwards("")
	if len(all) != 3 {
		t.Fatalf("all=%d want 3", len(all))
	}
	byID := make(map[string]PortForwardSession, len(all))
	for _, session := range all {
		byID[session.ID] = session
	}
	shape := byID[devFirst.ID]
	if shape.ID != devFirst.ID || shape.ContextID != "dev" || shape.Namespace != "apps" ||
		shape.ResourceRef.Kind != "Pod" || shape.ResourceRef.Name != "web" ||
		shape.LocalPort != 43123 || shape.TargetPort != 8080 || shape.Pod != "" {
		t.Fatalf("pod session shape=%#v", shape)
	}
	if shape.StartedAt.IsZero() {
		t.Fatal("startedAt was not stamped")
	}
	// Service rows record the requested resource, the resolved backing pod,
	// and the resolved target port.
	serviceShape := byID[devSecond.ID]
	if serviceShape.ResourceRef.Kind != "Service" || serviceShape.ResourceRef.Name != "grafana" ||
		serviceShape.Pod != "grafana-xyz" || serviceShape.TargetPort != 3000 {
		t.Fatalf("service session shape=%#v", serviceShape)
	}
	// Oldest first, so the panel order is stable.
	for index := 1; index < len(all); index++ {
		previous := all[index-1]
		if previous.StartedAt.After(all[index].StartedAt) ||
			(previous.StartedAt.Equal(all[index].StartedAt) && previous.ID > all[index].ID) {
			t.Fatalf("sessions not ordered oldest first: %#v", all)
		}
	}

	if filtered := service.ListPortForwards("prod"); len(filtered) != 1 || filtered[0].ID != prod.ID || filtered[0].ContextID != "prod" {
		t.Fatalf("prod filter=%#v", filtered)
	}
	if filtered := service.ListPortForwards("unknown"); len(filtered) != 0 {
		t.Fatalf("unknown filter=%#v", filtered)
	}

	if err := service.StopPortForward(context.Background(), devFirst.ID); err != nil {
		t.Fatal(err)
	}
	if remaining := service.ListPortForwards(""); len(remaining) != 2 {
		t.Fatalf("remaining=%d want 2", len(remaining))
	}
}

func TestPortForwardStopCancelsOwnedContext(t *testing.T) {
	var owned context.Context
	stopped := 0
	service := NewService(lifecyclePFProvider{start: func(ctx context.Context) (func(), int, error) { owned = ctx; return func() { stopped++ }, 43123, nil }})
	ctx, cancel := context.WithCancel(context.Background())
	result, err := service.StartPortForward(ctx, PortForwardRequest{ContextID: "dev", Namespace: "apps", Name: "web", PodPort: 80})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if owned.Err() != nil {
		t.Fatal("successful forward still owned by request")
	}
	if err := service.StopPortForward(context.Background(), result.ID); err != nil {
		t.Fatal(err)
	}
	if owned.Err() != context.Canceled || stopped != 1 {
		t.Fatalf("ctx=%v stopped=%d", owned.Err(), stopped)
	}
	service.StopAllPortForwards()
	if stopped != 1 {
		t.Fatal("stopped twice")
	}
}
