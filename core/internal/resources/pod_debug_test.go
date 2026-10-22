package resources

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

type fakeEphemeralProvider struct {
	fakeProvider
	capturedName     string
	capturedImage    string
	capturedCommand  []string
	capturedArgs     []string
	capturedTarget   string
	capturedEnv      []corev1.EnvVar
	capturedContext  string
	capturedPod      string
	entry            *corev1.EphemeralContainer
	providerDisabled bool
}

func (f *fakeEphemeralProvider) AddEphemeralContainer(_ context.Context, contextID, _, podName, name, image string, command, args []string, target string, env []corev1.EnvVar) (*corev1.EphemeralContainer, error) {
	f.capturedContext = contextID
	f.capturedPod = podName
	f.capturedName = name
	f.capturedImage = image
	f.capturedCommand = command
	f.capturedArgs = args
	f.capturedTarget = target
	f.capturedEnv = env
	if f.entry == nil {
		f.entry = &corev1.EphemeralContainer{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: name, Image: image}}
	}
	return f.entry, nil
}

func TestDebugPodValidatesAndForwards(t *testing.T) {
	provider := &fakeEphemeralProvider{fakeProvider: fakeProvider{}}
	entry := &corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:    "debugger-x7k2q",
			Image:   "busybox:1.36",
			Command: []string{"/bin/sh"},
			Args:    []string{"-c", "ps aux"},
			Env:     []corev1.EnvVar{{Name: "TRACE", Value: "1"}},
		},
		TargetContainerName: "app",
	}
	provider.entry = entry

	result, err := NewService(provider).DebugPod(context.Background(), PodDebugRequest{
		ContextID: "context",
		Namespace: "apps",
		PodName:   "web",
		Container: PodDebugContainer{
			Image:               "busybox:1.36",
			Command:             []string{"/bin/sh"},
			Args:                []string{"-c", "ps aux"},
			TargetContainerName: "app",
			Env:                 []EnvVar{{Name: "TRACE", Value: "1"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.capturedContext != "context" || provider.capturedPod != "web" || provider.capturedImage != "busybox:1.36" {
		t.Fatalf("captured = %q %q %q", provider.capturedContext, provider.capturedPod, provider.capturedImage)
	}
	if provider.capturedTarget != "app" || len(provider.capturedEnv) != 1 || provider.capturedEnv[0].Name != "TRACE" {
		t.Fatalf("captured target/env = %q %#v", provider.capturedTarget, provider.capturedEnv)
	}
	if result.Container.Name != "debugger-x7k2q" || result.Container.TargetContainerName != "app" {
		t.Fatalf("result = %#v", result.Container)
	}
	if len(result.Container.Command) != 1 || len(result.Container.Args) != 2 || len(result.Container.Env) != 1 {
		t.Fatalf("result argv/env = %#v", result.Container)
	}
}

func TestDebugPodRejectsInvalidContainers(t *testing.T) {
	provider := &fakeEphemeralProvider{fakeProvider: fakeProvider{}}
	service := NewService(provider)
	cases := map[string]PodDebugRequest{
		"missing image": {ContextID: "c", Namespace: "apps", PodName: "web"},
		"blank image":   {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{Image: "   "}},
		"missing pod":   {ContextID: "c", Namespace: "apps", Container: PodDebugContainer{Image: "busybox:1.36"}},
		"missing namespace": {ContextID: "c", PodName: "web", Container: PodDebugContainer{Image: "busybox:1.36"}},
		"missing context":   {Namespace: "apps", PodName: "web", Container: PodDebugContainer{Image: "busybox:1.36"}},
		"long name": {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{
			Image: "busybox:1.36", Name: strings.Repeat("x", 254)}},
		"too many command entries": {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{
			Image: "busybox:1.36", Command: make([]string, 33)}},
		"blank command entry": {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{
			Image: "busybox:1.36", Command: []string{"  "}}},
		"too many env entries": {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{
			Image: "busybox:1.36", Env: make([]EnvVar, 65)}},
		"blank env name": {ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{
			Image: "busybox:1.36", Env: []EnvVar{{Name: " ", Value: "1"}}}},
	}
	for name, request := range cases {
		if _, err := service.DebugPod(context.Background(), request); err == nil {
			t.Fatalf("%s was accepted", name)
		} else if _, ok := err.(*ValidationError); !ok {
			t.Fatalf("%s produced %T, want ValidationError", name, err)
		}
	}
	if provider.capturedImage != "" {
		t.Fatal("an invalid request reached the provider")
	}
}

func TestDebugPodRequiresProvider(t *testing.T) {
	service := NewService(fakeProvider{})
	_, err := service.DebugPod(context.Background(), PodDebugRequest{
		ContextID: "c", Namespace: "apps", PodName: "web", Container: PodDebugContainer{Image: "busybox:1.36"},
	})
	if err == nil || !strings.Contains(err.Error(), "provider") {
		t.Fatalf("err = %v", err)
	}
}
