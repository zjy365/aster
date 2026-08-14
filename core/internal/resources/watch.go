package resources

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
)

func (s *Service) Watch(ctx context.Context, request WatchRequest) (<-chan WatchEvent, error) {
	if strings.TrimSpace(request.ContextID) == "" {
		return nil, invalid("contextId is required")
	}
	gvr, definition, err := s.resolveGVR(ctx, request.ContextID, request.GVR)
	if err != nil {
		return nil, err
	}
	if request.Kind != "" && !strings.EqualFold(strings.TrimSpace(request.Kind), definition.Kind) {
		return nil, invalid(fmt.Sprintf("kind %q does not match %s", request.Kind, definition.Kind))
	}
	client, err := s.clients.Client(request.ContextID)
	if err != nil {
		return nil, err
	}
	resource := client.Resource(gvr)
	var interfaceClient dynamic.ResourceInterface = resource
	if definition.Namespaced {
		interfaceClient = resource.Namespace(request.Namespace)
	}
	timeoutSeconds := int64(55)
	watcher, err := interfaceClient.Watch(ctx, metav1.ListOptions{
		ResourceVersion:     request.ResourceVersion,
		LabelSelector:       request.LabelSelector,
		FieldSelector:       request.FieldSelector,
		AllowWatchBookmarks: true,
		TimeoutSeconds:      &timeoutSeconds,
	})
	if err != nil {
		if isExpired(err) {
			return resetStream(request.ResourceVersion, err.Error()), nil
		}
		return nil, fmt.Errorf("watch %s: %w", definition.Resource, err)
	}

	events := make(chan WatchEvent)
	go forwardWatch(ctx, watcher, events)
	return events, nil
}

func forwardWatch(ctx context.Context, watcher watch.Interface, output chan<- WatchEvent) {
	defer close(output)
	defer watcher.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case event, open := <-watcher.ResultChan():
			if !open {
				return
			}
			converted, terminal := convertWatchEvent(event)
			select {
			case output <- converted:
			case <-ctx.Done():
				return
			}
			if terminal {
				return
			}
		}
	}
}

func convertWatchEvent(event watch.Event) (WatchEvent, bool) {
	if event.Type == watch.Error {
		err := apierrors.FromObject(event.Object)
		if isExpired(err) {
			return WatchEvent{
				Type:            "RESET",
				Reason:          "resource_version_expired",
				RelistRequired:  true,
				ResourceVersion: objectResourceVersion(event.Object),
			}, true
		}
		streamError := StreamError{Message: err.Error()}
		if status, ok := event.Object.(*metav1.Status); ok {
			streamError.Code = status.Code
			streamError.Reason = string(status.Reason)
			if status.Message != "" {
				streamError.Message = status.Message
			}
		}
		return WatchEvent{Type: "ERROR", Error: &streamError}, true
	}

	resourceVersion := objectResourceVersion(event.Object)
	if event.Type == watch.Bookmark {
		return WatchEvent{Type: "BOOKMARK", ResourceVersion: resourceVersion}, false
	}
	object, err := toUnstructured(event.Object)
	if err != nil {
		return WatchEvent{
			Type:  "ERROR",
			Error: &StreamError{Reason: "invalid_watch_object", Message: err.Error()},
		}, true
	}
	row := project(object)
	return WatchEvent{Type: string(event.Type), Resource: &row, ResourceVersion: resourceVersion}, false
}

func resetStream(resourceVersion, reason string) <-chan WatchEvent {
	events := make(chan WatchEvent, 1)
	events <- WatchEvent{
		Type:            "RESET",
		ResourceVersion: resourceVersion,
		Reason:          reason,
		RelistRequired:  true,
	}
	close(events)
	return events
}

func isExpired(err error) bool {
	return apierrors.IsResourceExpired(err) || apierrors.IsGone(err)
}

func objectResourceVersion(object runtime.Object) string {
	accessor, err := meta.Accessor(object)
	if err != nil {
		return ""
	}
	return accessor.GetResourceVersion()
}

func toUnstructured(object runtime.Object) (*unstructured.Unstructured, error) {
	if value, ok := object.(*unstructured.Unstructured); ok {
		return value, nil
	}
	content, err := runtime.DefaultUnstructuredConverter.ToUnstructured(object)
	if err != nil {
		return nil, fmt.Errorf("convert watch object: %w", err)
	}
	return &unstructured.Unstructured{Object: content}, nil
}
