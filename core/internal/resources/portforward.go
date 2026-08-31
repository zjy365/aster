// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// Port forwards: local random ports on loopback, owned by this service and
// reclaimed on stop or context teardown. No state persists across restarts.

type PortForwardProvider interface {
	PortForward(ctx context.Context, contextID, namespace, name string, podPort, localPort int64) (stop func(), boundPort int, err error)
}

// ForwardTargetResolver maps a Service or workload to the single backing pod
// that a forward terminates on, translating named ports to numbers.
type ForwardTargetResolver interface {
	ResolveForwardTarget(ctx context.Context, contextID, namespace, name, kind string, podPort int64) (podName string, resolvedPort int64, err error)
}

type portForwardEntry struct {
	stop func()
}

func (s *Service) StartPortForward(ctx context.Context, request PortForwardRequest) (PortForwardResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" || strings.TrimSpace(request.Namespace) == "" || strings.TrimSpace(request.Name) == "" {
		return PortForwardResponse{}, invalid("contextId, namespace and name are required")
	}
	if request.PodPort < 1 || request.PodPort > 65_535 {
		return PortForwardResponse{}, invalid("podPort must be between 1 and 65535")
	}
	kind := request.Kind
	if kind == "" {
		kind = "Pod"
	}
	if !forwardKinds[kind] {
		return PortForwardResponse{}, invalid(fmt.Sprintf("%q cannot be port-forwarded", kind))
	}
	podName, podPort := request.Name, request.PodPort
	resolved := ""
	if kind != "Pod" {
		resolver, ok := s.clients.(ForwardTargetResolver)
		if !ok {
			return PortForwardResponse{}, invalid("forward target resolver is unavailable")
		}
		var err error
		podName, podPort, err = resolver.ResolveForwardTarget(ctx, request.ContextID, request.Namespace, request.Name, kind, request.PodPort)
		if err != nil {
			return PortForwardResponse{}, err
		}
		resolved = podName
	}
	provider, ok := s.clients.(PortForwardProvider)
	if !ok {
		return PortForwardResponse{}, invalid("port-forward provider is unavailable")
	}
	stop, boundPort, err := provider.PortForward(ctx, request.ContextID, request.Namespace, podName, podPort, int64(request.LocalPort))
	if err != nil {
		return PortForwardResponse{}, err
	}
	id := newPortForwardID()
	s.portForwardMu.Lock()
	s.portForwards[id] = portForwardEntry{stop: stop}
	s.portForwardMu.Unlock()
	return PortForwardResponse{ID: id, LocalPort: boundPort, Pod: resolved}, nil
}

var forwardKinds = map[string]bool{
	"Pod":         true,
	"Service":     true,
	"Deployment":  true,
	"StatefulSet": true,
	"DaemonSet":   true,
	"ReplicaSet":  true,
}

func (s *Service) StopPortForward(_ context.Context, id string) error {
	s.portForwardMu.Lock()
	entry, exists := s.portForwards[id]
	if exists {
		delete(s.portForwards, id)
	}
	s.portForwardMu.Unlock()
	if !exists {
		return invalid("unknown port-forward id")
	}
	entry.stop()
	return nil
}

// StopAllPortForwards reclaims every forward owned by this service, e.g. when
// the window or context is torn down.
func (s *Service) StopAllPortForwards() {
	s.portForwardMu.Lock()
	entries := s.portForwards
	s.portForwards = make(map[string]portForwardEntry)
	s.portForwardMu.Unlock()
	for _, entry := range entries {
		entry.stop()
	}
}

func newPortForwardID() string {
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("pf-%d", strings.Count(fmt.Sprint(value), " "))
	}
	return "pf-" + hex.EncodeToString(value)
}
