package session

import (
	"context"
	"fmt"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/zjy365/aster/core/internal/version"
)

// ContextHealth is the reachability probe result for one context. Status is
// "ok" when the API server answered /version, "error" otherwise. Message is a
// short, credential-free summary; it can name the server URL, which the
// renderer already knows from ContextInfo.
type ContextHealth struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Version   string `json:"version,omitempty"`
	Message   string `json:"message,omitempty"`
}

const (
	// healthTimeout bounds one probe. Four seconds keeps a dead cluster from
	// stalling the picker while leaving room for VPN-warmed connections.
	healthTimeout = 4 * time.Second
	// healthConcurrency bounds the probe fan-out so a kubeconfig with
	// hundreds of contexts does not open hundreds of sockets at once.
	healthConcurrency = 8
	// healthMessageMax caps the error text returned to the renderer.
	healthMessageMax = 240
)

// serverVersion queries the cluster's /version endpoint. It is a field so
// tests can probe fake clusters without a live API server.
func defaultServerVersion(config *rest.Config) (string, error) {
	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return "", err
	}
	info, err := client.Discovery().ServerVersion()
	if err != nil {
		return "", err
	}
	return info.GitVersion, nil
}

// Health probes each context's API server concurrently and reports per-context
// reachability. It builds throwaway clients with a hard timeout: nothing is
// cached and the manager's client maps are untouched, keeping probes outside
// the lazy-client lifecycle. Results come back in request order.
func (m *Manager) Health(ctx context.Context, ids []string) []ContextHealth {
	results := make([]ContextHealth, len(ids))
	semaphore := make(chan struct{}, healthConcurrency)
	var wg sync.WaitGroup
	for index, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[index] = ContextHealth{ID: id, Status: "error", Message: "probe cancelled"}
				return
			}
			results[index] = m.probe(id)
		}()
	}
	wg.Wait()
	return results
}

func (m *Manager) probe(id string) ContextHealth {
	health := ContextHealth{ID: id, Status: "ok"}
	config, err := m.loader.ClientConfig(id).ClientConfig()
	if err != nil {
		health.Status = "error"
		health.Message = healthMessage(fmt.Errorf("load context %q: %w", id, err))
		return health
	}
	config.Timeout = healthTimeout
	config.UserAgent = version.UserAgent()
	start := time.Now()
	version, err := m.serverVersion(config)
	if err != nil {
		health.Status = "error"
		health.Message = healthMessage(err)
		return health
	}
	health.LatencyMs = time.Since(start).Milliseconds()
	health.Version = version
	return health
}

func healthMessage(err error) string {
	message := err.Error()
	if len(message) > healthMessageMax {
		message = message[:healthMessageMax]
	}
	return message
}
