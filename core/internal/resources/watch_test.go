package resources

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic/fake"
	clienttesting "k8s.io/client-go/testing"
)

func TestWatchPassesScopeVersionSelectorsAndProjectsEvents(t *testing.T) {
	watcher := watch.NewRaceFreeFake()
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("deployments", func(action clienttesting.Action) (bool, watch.Interface, error) {
		watchAction := action.(clienttesting.WatchAction)
		restrictions := watchAction.GetWatchRestrictions()
		if action.GetNamespace() != "apps" || restrictions.ResourceVersion != "42" ||
			restrictions.Labels.String() != "app=demo" || restrictions.Fields.String() != "metadata.name=demo" {
			t.Fatalf("action=%#v restrictions=%#v", action, restrictions)
		}
		return true, watcher, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events, err := NewService(fakeProvider{client: client}).Watch(ctx, WatchRequest{
		ContextID: "dev", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Kind: "Deployment",
		Namespace: "apps", ResourceVersion: "42", LabelSelector: "app=demo", FieldSelector: "metadata.name=demo",
	})
	if err != nil {
		t.Fatal(err)
	}

	deployment := testObject("apps/v1", "Deployment", "demo", "apps")
	deployment.SetResourceVersion("43")
	deployment.Object["spec"] = map[string]any{"replicas": int64(1)}
	deployment.Object["status"] = map[string]any{"readyReplicas": int64(1)}
	bookmark := testObject("apps/v1", "Deployment", "", "")
	bookmark.SetResourceVersion("44")
	go func() {
		watcher.Add(deployment)
		watcher.Action(watch.Bookmark, bookmark)
	}()
	added := receiveWatchEvent(t, events)
	if added.Type != "ADDED" || added.Resource == nil || added.Resource.Name != "demo" || added.ResourceVersion != "43" {
		t.Fatalf("added = %#v", added)
	}
	bookmarkEvent := receiveWatchEvent(t, events)
	if bookmarkEvent.Type != "BOOKMARK" || bookmarkEvent.Resource != nil || bookmarkEvent.ResourceVersion != "44" {
		t.Fatalf("bookmark = %#v", bookmarkEvent)
	}
	cancel()
	waitFor(t, watcher.IsStopped)
}

func TestWatchConvertsGoneToReset(t *testing.T) {
	watcher := watch.NewRaceFreeFake()
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("pods", func(clienttesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	events, err := NewService(fakeProvider{client: client}).Watch(context.Background(), WatchRequest{
		ContextID: "dev", GVR: GVR{Version: "v1", Resource: "pods"}, Namespace: "apps", ResourceVersion: "old",
	})
	if err != nil {
		t.Fatal(err)
	}
	go watcher.Error(&metav1.Status{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Status"},
		Status:   metav1.StatusFailure, Reason: metav1.StatusReasonExpired, Code: 410, Message: "too old resource version",
	})
	event := receiveWatchEvent(t, events)
	if event.Type != "RESET" || !event.RelistRequired || event.Reason != "resource_version_expired" {
		t.Fatalf("event = %#v", event)
	}
	if _, open := <-events; open {
		t.Fatal("stream remained open after reset")
	}
}

func TestWatchStartGoneReturnsResetStream(t *testing.T) {
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("nodes", func(clienttesting.Action) (bool, watch.Interface, error) {
		return true, nil, apierrors.NewResourceExpired("expired before watch started")
	})
	events, err := NewService(fakeProvider{client: client}).Watch(context.Background(), WatchRequest{
		ContextID: "dev", GVR: GVR{Version: "v1", Resource: "nodes"}, ResourceVersion: "old",
	})
	if err != nil {
		t.Fatal(err)
	}
	event := receiveWatchEvent(t, events)
	if event.Type != "RESET" || !event.RelistRequired || event.ResourceVersion != "old" {
		t.Fatalf("event = %#v", event)
	}
}

func TestWatchReturnsStructuredNonGoneError(t *testing.T) {
	watcher := watch.NewRaceFreeFake()
	client := fake.NewSimpleDynamicClient(runtime.NewScheme())
	client.PrependWatchReactor("services", func(clienttesting.Action) (bool, watch.Interface, error) {
		return true, watcher, nil
	})
	events, err := NewService(fakeProvider{client: client}).Watch(context.Background(), WatchRequest{
		ContextID: "dev", GVR: GVR{Version: "v1", Resource: "services"}, Namespace: "apps",
	})
	if err != nil {
		t.Fatal(err)
	}
	go watcher.Error(&metav1.Status{
		TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Status"},
		Status:   metav1.StatusFailure, Reason: metav1.StatusReasonForbidden, Code: 403, Message: "forbidden",
	})
	event := receiveWatchEvent(t, events)
	if event.Type != "ERROR" || event.Error == nil || event.Error.Code != 403 || event.Error.Reason != "Forbidden" {
		t.Fatalf("event = %#v", event)
	}
}

func TestWatchRejectsKindMismatch(t *testing.T) {
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	_, err := service.Watch(context.Background(), WatchRequest{
		ContextID: "dev", GVR: GVR{Version: "v1", Resource: "pods"}, Kind: "Deployment",
	})
	var validationError *ValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("error = %v", err)
	}
}

func TestWatchSecretEventOnlyContainsKeys(t *testing.T) {
	secret := testObject("v1", "Secret", "credentials", "apps")
	secret.Object["data"] = map[string]any{"password": "c2VjcmV0"}
	event, terminal := convertWatchEvent(watch.Event{Type: watch.Modified, Object: secret})
	if terminal || event.Resource == nil || !reflect.DeepEqual(event.Resource.DataKeys, []string{"password"}) {
		t.Fatalf("event = %#v terminal=%v", event, terminal)
	}
}

func receiveWatchEvent(t *testing.T, events <-chan WatchEvent) WatchEvent {
	t.Helper()
	select {
	case event, open := <-events:
		if !open {
			t.Fatal("watch stream closed before event")
		}
		return event
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for watch event")
		return WatchEvent{}
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met")
}
