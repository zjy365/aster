package session

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

func TestManagerHealthReportsPerContext(t *testing.T) {
	directory := t.TempDir()
	writeTestFile(t, filepath.Join(directory, "config"), `
apiVersion: v1
kind: Config
clusters:
- name: dev-cluster
  cluster:
    server: https://dev.example.test
- name: prod-cluster
  cluster:
    server: https://prod.example.test
contexts:
- name: dev
  context:
    cluster: dev-cluster
    user: dev-user
- name: prod
  context:
    cluster: prod-cluster
    user: prod-user
users:
- name: dev-user
  user:
    token: secret-dev-token
- name: prod-user
  user:
    token: secret-prod-token
`)
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: filepath.Join(directory, "config")}
	manager := newManager(NewLoaderWithRules(rules), nil)
	manager.serverVersion = func(config *rest.Config) (string, error) {
		if config.Host == "https://prod.example.test" {
			return "", errors.New("dial tcp: i/o timeout")
		}
		// The probe must carry a hard timeout so a dead cluster cannot stall
		// the picker.
		if config.Timeout != healthTimeout {
			t.Errorf("probe timeout = %v, want %v", config.Timeout, healthTimeout)
		}
		return "v1.30.1", nil
	}

	results := manager.Health(context.Background(), []string{"dev", "prod"})
	if len(results) != 2 {
		t.Fatalf("got %d results", len(results))
	}
	if results[0].ID != "dev" || results[0].Status != "ok" || results[0].Version != "v1.30.1" {
		t.Errorf("dev result = %+v", results[0])
	}
	if results[1].ID != "prod" || results[1].Status != "error" || results[1].Message != "dial tcp: i/o timeout" {
		t.Errorf("prod result = %+v", results[1])
	}
}

func TestManagerHealthReportsUnresolvableContext(t *testing.T) {
	directory := t.TempDir()
	writeTestFile(t, filepath.Join(directory, "config"), `
apiVersion: v1
kind: Config
clusters: []
contexts: []
users: []
`)
	rules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: filepath.Join(directory, "config")}
	manager := newManager(NewLoaderWithRules(rules), nil)

	results := manager.Health(context.Background(), []string{"ghost"})
	if len(results) != 1 || results[0].Status != "error" || results[0].Message == "" {
		t.Fatalf("ghost result = %+v", results)
	}
}

func TestHealthMessageTruncates(t *testing.T) {
	long := healthMessage(errors.New(string(make([]byte, healthMessageMax+50))))
	if len(long) != healthMessageMax {
		t.Fatalf("message length = %d, want %d", len(long), healthMessageMax)
	}
}
