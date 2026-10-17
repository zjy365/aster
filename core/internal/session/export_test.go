package session

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"k8s.io/client-go/tools/clientcmd"
)

// exportLoader builds a loader over two kubeconfigs: the first defines dev
// plus a shared entry, the second defines prod plus a losing duplicate of dev
// against a different server. Export must follow the loader's first-wins
// merge, exactly like listing and connecting do.
func exportLoader(t *testing.T) *Loader {
	t.Helper()
	isolateChain(t)
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
current-context: dev
clusters:
- name: dev-cluster
  cluster:
    server: https://dev.example.test
- name: shared-cluster
  cluster:
    server: https://shared.example.test
contexts:
- name: dev
  context:
    cluster: dev-cluster
    user: dev-user
    namespace: apps
- name: other
  context:
    cluster: shared-cluster
    user: other-user
users:
- name: dev-user
  user:
    token: secret-dev-token
- name: other-user
  user:
    client-key-data: b3RoZXI=
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: prod-cluster
  cluster:
    server: https://prod.example.test
- name: dev-cluster
  cluster:
    server: https://evil.example.test
contexts:
- name: prod
  context:
    cluster: prod-cluster
    user: prod-user
- name: dev
  context:
    cluster: dev-cluster
    user: attacker
users:
- name: prod-user
  user:
    username: prod
    password: secret-prod-password
- name: attacker
  user:
    token: attacker-token
`)
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	return NewLoaderWithRules(rules)
}

func TestExportContextNarrowsToExactlyOneContext(t *testing.T) {
	loader := exportLoader(t)
	for _, target := range []string{"dev", "prod"} {
		data, err := loader.ExportContext(target)
		if err != nil {
			t.Fatalf("export %s: %v", target, err)
		}
		config, err := clientcmd.Load(data)
		if err != nil {
			t.Fatalf("export %s: re-parse: %v", target, err)
		}
		if config.CurrentContext != target {
			t.Fatalf("current-context = %q, want %q", config.CurrentContext, target)
		}
		if len(config.Contexts) != 1 {
			t.Fatalf("contexts = %v, want exactly the exported one", config.Contexts)
		}
		if _, exists := config.Contexts[target]; !exists {
			t.Fatalf("exported context %q missing", target)
		}
		if len(config.Clusters) != 1 || len(config.AuthInfos) != 1 {
			t.Fatalf("clusters = %v users = %v, want one of each", config.Clusters, config.AuthInfos)
		}
		context := config.Contexts[target]
		if _, exists := config.Clusters[context.Cluster]; !exists {
			t.Fatalf("cluster %q referenced but not exported", context.Cluster)
		}
		if _, exists := config.AuthInfos[context.AuthInfo]; !exists {
			t.Fatalf("user %q referenced but not exported", context.AuthInfo)
		}
	}
}

func TestExportContextFollowsFirstWinsMergeAndKeepsNamespace(t *testing.T) {
	loader := exportLoader(t)
	data, err := loader.ExportContext("dev")
	if err != nil {
		t.Fatal(err)
	}
	config, err := clientcmd.Load(data)
	if err != nil {
		t.Fatal(err)
	}
	if server := config.Clusters["dev-cluster"].Server; server != "https://dev.example.test" {
		t.Fatalf("dev-cluster server = %q, want the first file's (first-wins merge)", server)
	}
	if token := config.AuthInfos["dev-user"].Token; token != "secret-dev-token" {
		t.Fatalf("dev-user token = %q, want the first file's", token)
	}
	if namespace := config.Contexts["dev"].Namespace; namespace != "apps" {
		t.Fatalf("dev namespace = %q, want apps preserved", namespace)
	}
	// The losing duplicate must not leak into the narrowed document at all.
	if strings.Contains(string(data), "attacker") || strings.Contains(string(data), "evil.example.test") {
		t.Fatalf("export leaked a losing duplicate definition: %s", data)
	}
}

func TestExportContextIsACompleteKubeconfigDocument(t *testing.T) {
	loader := exportLoader(t)
	data, err := loader.ExportContext("prod")
	if err != nil {
		t.Fatal(err)
	}
	document := string(data)
	if !strings.Contains(document, "apiVersion: v1") || !strings.Contains(document, "kind: Config") {
		t.Fatalf("document missing apiVersion/kind headers: %s", document)
	}
	config, err := clientcmd.Load(data)
	if err != nil {
		t.Fatal(err)
	}
	// The exported user's credential survives the round-trip: the whole point
	// of the handoff is a working kubectl, so the secret must be present here
	// (this document is shell-bound only, never renderer-bound).
	if config.AuthInfos["prod-user"].Password != "secret-prod-password" {
		t.Fatal("prod-user credentials did not round-trip")
	}
}

func TestExportContextRejectsUnknownContext(t *testing.T) {
	loader := exportLoader(t)
	_, err := loader.ExportContext("does-not-exist")
	if !errors.Is(err, ErrContextNotFound) {
		t.Fatalf("err = %v, want ErrContextNotFound", err)
	}
	if _, err := loader.ExportContext(""); !errors.Is(err, ErrContextNotFound) {
		t.Fatalf("err = %v, want ErrContextNotFound for an empty id", err)
	}
}

func TestExportContextOfContextWithoutUserEntry(t *testing.T) {
	// A context whose user is not defined anywhere still exports: the
	// narrowed document simply has no users section, matching what the
	// loader's listing already reports as an error.
	path := filepath.Join(t.TempDir(), "config.yaml")
	writeTestFile(t, path, `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://c.example.test
contexts:
- name: orphan
  context:
    cluster: c
    user: nobody
`)
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{path}
	loader := NewLoaderWithRules(rules)
	config, err := clientcmd.Load(mustExport(t, loader, "orphan"))
	if err != nil {
		t.Fatal(err)
	}
	if len(config.AuthInfos) != 0 {
		t.Fatalf("users = %v, want none", config.AuthInfos)
	}
	if len(config.Clusters) != 1 {
		t.Fatalf("clusters = %v, want the referenced one", config.Clusters)
	}
}

func TestManagerExportContext(t *testing.T) {
	manager := NewManager(exportLoader(t))
	if _, err := manager.ExportContext("dev"); err != nil {
		t.Fatal(err)
	}
	_, err := manager.ExportContext("")
	if !errors.Is(err, ErrContextNotFound) {
		t.Fatalf("err = %v, want ErrContextNotFound for an empty id", err)
	}
}

// Exporting must not corrupt the merged view the loader still owns: the
// entries are shared, not copied, so the narrowed document takes references
// without mutating the merged maps.
func TestExportContextDoesNotCorruptTheMergedConfig(t *testing.T) {
	loader := exportLoader(t)
	if _, err := loader.ExportContext("dev"); err != nil {
		t.Fatal(err)
	}
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 3 {
		t.Fatalf("contexts after export = %d, want 3", len(contexts))
	}
}

func mustExport(t *testing.T, loader *Loader, contextID string) []byte {
	t.Helper()
	data, err := loader.ExportContext(contextID)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
