package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
)

func TestLoaderContextsMergesFilesWithoutSecrets(t *testing.T) {
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
current-context: prod
clusters:
- name: prod-cluster
  cluster:
    server: https://prod.example.test
contexts:
- name: prod
  context:
    cluster: prod-cluster
    user: prod-user
    namespace: apps
users:
- name: prod-user
  user:
    token: secret-prod-token
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: dev-cluster
  cluster:
    server: https://dev.example.test
contexts:
- name: dev
  context:
    cluster: dev-cluster
    user: dev-user
users:
- name: dev-user
  user:
    client-key-data: c2VjcmV0
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 2 {
		t.Fatalf("contexts = %d, want 2", len(contexts))
	}
	if contexts[0].Name != "dev" || contexts[0].Server != "https://dev.example.test" {
		t.Fatalf("dev context = %#v", contexts[0])
	}
	if contexts[1].Name != "prod" || !contexts[1].Current || contexts[1].Namespace != "apps" {
		t.Fatalf("prod context = %#v", contexts[1])
	}
	for _, context := range contexts {
		encoded := context.Name + context.Cluster + context.Server + context.User + context.Namespace + context.Error
		if strings.Contains(encoded, "secret-prod-token") || strings.Contains(encoded, "c2VjcmV0") {
			t.Fatalf("context leaked credentials: %#v", context)
		}
	}
}

func TestLoaderContextsReportsBrokenReferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	writeTestFile(t, path, `
apiVersion: v1
kind: Config
contexts:
- name: broken
  context:
    cluster: missing-cluster
    user: missing-user
`)
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.ExplicitPath = path
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || !strings.Contains(contexts[0].Error, "not defined") {
		t.Fatalf("contexts = %#v", contexts)
	}
}

func writeTestFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoaderWithSourcesMergesAndAttributes(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "work.yaml")
	second := filepath.Join(dir, "personal.yaml")
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
current-context: work-ctx
clusters:
- name: work
  cluster:
    server: https://work.example
contexts:
- name: work-ctx
  context:
    cluster: work
    user: work
users:
- name: work
  user:
    token: work-token
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: personal
  cluster:
    server: https://home.example
contexts:
- name: home-ctx
  context:
    cluster: personal
    user: personal
users:
- name: personal
  user:
    token: home-token
`)

	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "empty"))
	loader := NewLoaderWithSources([]string{first, second})
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]ContextInfo{}
	for _, info := range contexts {
		byName[info.Name] = info
	}
	if len(contexts) != 2 {
		t.Fatalf("contexts=%#v", contexts)
	}
	if byName["work-ctx"].Source != first || byName["home-ctx"].Source != second {
		t.Fatalf("source attribution: %#v", byName)
	}
	if byName["work-ctx"].Server != "https://work.example" {
		t.Fatalf("work server=%q contexts=%#v", byName["work-ctx"].Server, byName)
	}
}

func TestLoaderWithSourcesExpandsDirectories(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "cluster-a.yaml"), `
apiVersion: v1
kind: Config
clusters:
- name: a
  cluster:
    server: https://a.example
contexts:
- name: a-ctx
  context:
    cluster: a
    user: a
users:
- name: a
  user:
    token: a
`)
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("not a kubeconfig"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "empty"))
	loader := NewLoaderWithSources([]string{dir})
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || contexts[0].Name != "a-ctx" || contexts[0].Source != filepath.Join(dir, "cluster-a.yaml") {
		t.Fatalf("contexts=%#v", contexts)
	}
}

func TestLoaderWithSourcesDegradesOnMissingFile(t *testing.T) {
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "empty"))
	loader := NewLoaderWithSources([]string{filepath.Join(t.TempDir(), "gone.yaml")})
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatalf("missing file must not fail the load: %v", err)
	}
	if len(contexts) != 0 {
		t.Fatalf("contexts=%#v", contexts)
	}
}
