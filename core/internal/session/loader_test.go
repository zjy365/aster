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
	isolateChain(t)
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
	loader := NewLoaderWithSources([]string{first, second}, true)
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
	isolateChain(t)
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
	loader := NewLoaderWithSources([]string{dir}, true)
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || contexts[0].Name != "a-ctx" || contexts[0].Source != filepath.Join(dir, "cluster-a.yaml") {
		t.Fatalf("contexts=%#v", contexts)
	}
}

func TestLoaderWithSourcesDegradesOnMissingFile(t *testing.T) {
	isolateChain(t)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "empty"))
	loader := NewLoaderWithSources([]string{filepath.Join(t.TempDir(), "gone.yaml")}, true)
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatalf("missing file must not fail the load: %v", err)
	}
	if len(contexts) != 0 {
		t.Fatalf("contexts=%#v", contexts)
	}
}

// setTestHome points the platform home directory at dir. os.UserHomeDir reads
// HOME on Unix but USERPROFILE on Windows, so both must be set for the loader
// to see a deterministic home in tests on every platform.
func setTestHome(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}

// isolateChain points HOME at a temp dir so the real ~/.kube/config can
// never leak into tests, and clears KUBECONFIG unless a test overrides it.
func isolateChain(t *testing.T) {
	t.Helper()
	setTestHome(t, t.TempDir())
	t.Setenv("KUBECONFIG", "")
}

func writeDefaultConfig(t *testing.T, home string) string {
	t.Helper()
	path := filepath.Join(home, ".kube", "config")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, path, `
apiVersion: v1
kind: Config
clusters:
- name: default-cluster
  cluster:
    server: https://default.example
contexts:
- name: default-ctx
  context:
    cluster: default-cluster
    user: default-user
users:
- name: default-user
  user:
    token: default-token
`)
	return path
}

func TestLoaderWithSourcesCanExcludeStandardChain(t *testing.T) {
	isolateChain(t)
	writeDefaultConfig(t, os.Getenv("HOME"))

	loader := NewLoaderWithSources(nil, false)
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 0 {
		t.Fatalf("chain excluded, want no contexts: %#v", contexts)
	}
	if report := loader.SourceReports(); len(report.Chain) != 0 {
		t.Fatalf("chain excluded, want empty chain report: %#v", report.Chain)
	}

	// With the chain included the same default file loads and reports.
	included := NewLoaderWithSources(nil, true)
	contexts, err = included.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || contexts[0].Name != "default-ctx" {
		t.Fatalf("contexts=%#v", contexts)
	}
	if chain := included.SourceReports().Chain; len(chain) != 1 || !chain[0].Default {
		t.Fatalf("chain=%#v", chain)
	}
}

func TestLoaderWithSourcesDedupesChainEntries(t *testing.T) {
	isolateChain(t)
	dup := filepath.Join(t.TempDir(), "staging")
	writeTestFile(t, dup, `
apiVersion: v1
kind: Config
clusters:
- name: staging-cluster
  cluster:
    server: https://staging.example
contexts:
- name: staging-ctx
  context:
    cluster: staging-cluster
    user: staging-user
users:
- name: staging-user
  user:
    token: staging-token
`)
	// The same file arrives via $KUBECONFIG and as a configured source.
	t.Setenv("KUBECONFIG", dup)
	loader := NewLoaderWithSources([]string{dup}, true)
	if len(loader.rules.Precedence) != 1 {
		t.Fatalf("precedence=%#v, want the file loaded once", loader.rules.Precedence)
	}
	report := loader.SourceReports()
	if len(report.Configured) != 1 || !report.Configured[0].InChain {
		t.Fatalf("configured=%#v, want the duplicate flagged", report.Configured)
	}
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || contexts[0].Source != dup {
		t.Fatalf("contexts=%#v", contexts)
	}
}

func TestDefaultChainIncludesKubeconfigAndDefaultConfig(t *testing.T) {
	isolateChain(t)
	home := t.TempDir()
	setTestHome(t, home)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "staging"))

	defaultConfig := filepath.Join(home, ".kube", "config")
	if err := os.MkdirAll(filepath.Dir(defaultConfig), 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, defaultConfig, `
apiVersion: v1
kind: Config
clusters:
- name: default-cluster
  cluster:
    server: https://default.example
contexts:
- name: default-ctx
  context:
    cluster: default-cluster
    user: default-user
users:
- name: default-user
  user:
    token: default-token
`)
	writeTestFile(t, os.Getenv("KUBECONFIG"), `
apiVersion: v1
kind: Config
clusters:
- name: staging-cluster
  cluster:
    server: https://staging.example
contexts:
- name: staging-ctx
  context:
    cluster: staging-cluster
    user: staging-user
users:
- name: staging-user
  user:
    token: staging-token
`)

	// A KUBECONFIG override must augment the default location, not replace
	// it — the settings dialog always shows ~/.kube/config as a source.
	contexts, err := NewLoader().Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 2 {
		t.Fatalf("contexts=%#v", contexts)
	}
	byName := map[string]ContextInfo{}
	for _, info := range contexts {
		byName[info.Name] = info
	}
	if byName["staging-ctx"].Source != os.Getenv("KUBECONFIG") {
		t.Fatalf("staging source=%q", byName["staging-ctx"].Source)
	}
	if byName["default-ctx"].Source != defaultConfig {
		t.Fatalf("default source=%q", byName["default-ctx"].Source)
	}
}

func TestDefaultChainSkipsMissingDefaultConfig(t *testing.T) {
	isolateChain(t)
	t.Setenv("KUBECONFIG", filepath.Join(t.TempDir(), "empty"))
	contexts, err := NewLoader().Contexts()
	if err != nil {
		t.Fatalf("missing default config must not fail the load: %v", err)
	}
	if len(contexts) != 0 {
		t.Fatalf("contexts=%#v", contexts)
	}
}

func TestDirectoryScanAdmitsUnSuffixedKubeconfigs(t *testing.T) {
	isolateChain(t)
	dir := t.TempDir()
	writeTestFile(t, filepath.Join(dir, "devbox-review-189-kubeconfig"), `
apiVersion: v1
kind: Config
clusters:
- name: devbox
  cluster:
    server: https://devbox.example
contexts:
- name: devbox-ctx
  context:
    cluster: devbox
    user: devbox
users:
- name: devbox
  user:
    token: devbox
`)
	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte{0, 0, 0, 0, 1}, 0o600); err != nil {
		t.Fatal(err)
	}
	// YAML, but not a kubeconfig (kubecm's own config file): must be skipped
	// by content, not by extension.
	if err := os.WriteFile(filepath.Join(dir, "kubecm.config"), []byte("keys: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	loader := NewLoaderWithSources([]string{dir}, true)
	contexts, err := loader.Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || contexts[0].Name != "devbox-ctx" {
		t.Fatalf("contexts=%#v", contexts)
	}
	if contexts[0].Source != filepath.Join(dir, "devbox-review-189-kubeconfig") {
		t.Fatalf("source=%q", contexts[0].Source)
	}
}

func TestContextConflictsAcrossSources(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	// The real failure: first defines cluster "shared-cluster" against hzh;
	// second defines the same cluster name against usw AND a context that uses
	// it. First wins on the cluster name, so the context silently connects to
	// hzh instead of usw.
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
clusters:
- name: shared-cluster
  cluster:
    server: https://hzh.example.test
contexts:
- name: other-ctx
  context:
    cluster: shared-cluster
    user: other-user
users:
- name: other-user
  user:
    token: token-other
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: shared-cluster
  cluster:
    server: https://usw.example.test
contexts:
- name: shared
  context:
    cluster: shared-cluster
    user: shared-user
    namespace: ns-a
users:
- name: shared-user
  user:
    token: token-a
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]ContextInfo{}
	for _, context := range contexts {
		byName[context.Name] = context
	}
	shared := byName["shared"]
	if shared.Source != second {
		t.Fatalf("shared source = %q, want second", shared.Source)
	}
	// The merged server is first's (hzh), not second's (usw): the context is
	// silently pointed at the wrong cluster.
	if shared.Server != "https://hzh.example.test" {
		t.Fatalf("shared server = %q, want first's hzh server", shared.Server)
	}
	// The conflicting cluster definition in first is reported.
	want := ConflictInfo{Path: first, Kind: "cluster", Name: "shared-cluster", Suggestion: "shared-cluster-hzh"}
	if len(shared.Conflicts) != 1 || shared.Conflicts[0] != want {
		t.Fatalf("shared conflicts = %#v, want [%+v]", shared.Conflicts, want)
	}
}

func TestContextIdenticalAcrossSourcesHasNoConflict(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	content := `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://same.example.test
contexts:
- name: same-ctx
  context:
    cluster: c
    user: u
    namespace: ns-a
users:
- name: u
  user:
    token: t
`
	writeTestFile(t, first, content)
	writeTestFile(t, second, content)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || len(contexts[0].Conflicts) != 0 {
		t.Fatalf("contexts=%#v, want no conflict for identical definitions", contexts)
	}
}

func TestContextSingleSourceHasNoConflict(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	only := filepath.Join(directory, "only.yaml")
	writeTestFile(t, only, `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://solo.example.test
contexts:
- name: solo-ctx
  context:
    cluster: c
    user: u
users:
- name: u
  user:
    token: t
`)
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{only}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 || len(contexts[0].Conflicts) != 0 {
		t.Fatalf("contexts=%#v, want no conflict for a single source", contexts)
	}
}

func TestContextNameConflictDifferentServer(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	// Same context name "shared" in both files, but the second points at a
	// different server: the losing definition is silently dropped by the merge.
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
clusters:
- name: c1
  cluster:
    server: https://usw.example.test
contexts:
- name: shared
  context:
    cluster: c1
    user: u
users:
- name: u
  user:
    token: t
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: c2
  cluster:
    server: https://hzh.example.test
contexts:
- name: shared
  context:
    cluster: c2
    user: u
users:
- name: u
  user:
    token: t
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 {
		t.Fatalf("contexts = %d, want 1", len(contexts))
	}
	if contexts[0].Source != first {
		t.Fatalf("source = %q, want first (winner)", contexts[0].Source)
	}
	want := ConflictInfo{Path: second, Kind: "context", Name: "shared", Suggestion: "shared-hzh"}
	if len(contexts[0].Conflicts) != 1 || contexts[0].Conflicts[0] != want {
		t.Fatalf("conflicts = %#v, want [%+v]", contexts[0].Conflicts, want)
	}
}

func TestContextNameConflictDifferentNamespace(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	first := filepath.Join(directory, "first.yaml")
	second := filepath.Join(directory, "second.yaml")
	// Same context name and server, but a different namespace in the second
	// file: the losing namespace is silently dropped by the merge.
	writeTestFile(t, first, `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://same.example.test
contexts:
- name: shared
  context:
    cluster: c
    user: u
    namespace: ns-a
users:
- name: u
  user:
    token: t
`)
	writeTestFile(t, second, `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://same.example.test
contexts:
- name: shared
  context:
    cluster: c
    user: u
    namespace: ns-b
users:
- name: u
  user:
    token: t
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{first, second}
	contexts, err := NewLoaderWithRules(rules).Contexts()
	if err != nil {
		t.Fatal(err)
	}
	if len(contexts) != 1 {
		t.Fatalf("contexts = %d, want 1", len(contexts))
	}
	want := ConflictInfo{Path: second, Kind: "context", Name: "shared", Suggestion: "shared-same"}
	if len(contexts[0].Conflicts) != 1 || contexts[0].Conflicts[0] != want {
		t.Fatalf("conflicts = %#v, want [%+v]", contexts[0].Conflicts, want)
	}
}

func TestRenameClusterEntryUpdatesReferences(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	file := filepath.Join(directory, "cluster.yaml")
	original := `
apiVersion: v1
kind: Config
clusters:
- name: sealos
  cluster:
    server: https://usw.example.test
contexts:
- name: ctx-a
  context:
    cluster: sealos
    user: u
- name: ctx-b
  context:
    cluster: other
    user: u
current-context: ctx-a
users:
- name: u
  user:
    token: t
`
	writeTestFile(t, file, original+`
clusters: nil
`)
	writeTestFile(t, file, original)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{file}
	loader := NewLoaderWithRules(rules)

	if err := loader.RenameEntry(file, "cluster", "sealos", "sealos-usw"); err != nil {
		t.Fatal(err)
	}
	config, err := clientcmd.LoadFromFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := config.Clusters["sealos"]; exists {
		t.Fatal("old cluster name still present")
	}
	if config.Clusters["sealos-usw"].Server != "https://usw.example.test" {
		t.Fatalf("renamed cluster server = %q", config.Clusters["sealos-usw"].Server)
	}
	if config.Contexts["ctx-a"].Cluster != "sealos-usw" {
		t.Fatalf("ctx-a cluster = %q, want renamed reference", config.Contexts["ctx-a"].Cluster)
	}
	if config.Contexts["ctx-b"].Cluster != "other" {
		t.Fatalf("ctx-b cluster = %q, want untouched", config.Contexts["ctx-b"].Cluster)
	}
	// The pre-edit original is preserved next to the file.
	backup, err := os.ReadFile(file + ".aster.bak")
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if string(backup) != original {
		t.Fatal("backup does not hold the original content")
	}
}

func TestRenameContextEntryUpdatesCurrentContext(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	file := filepath.Join(directory, "context.yaml")
	writeTestFile(t, file, `
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster:
    server: https://one.example.test
contexts:
- name: shared
  context:
    cluster: c
    user: u
current-context: shared
users:
- name: u
  user:
    token: t
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{file}
	loader := NewLoaderWithRules(rules)

	if err := loader.RenameEntry(file, "context", "shared", "shared-one"); err != nil {
		t.Fatal(err)
	}
	config, err := clientcmd.LoadFromFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := config.Contexts["shared"]; exists {
		t.Fatal("old context name still present")
	}
	if _, exists := config.Contexts["shared-one"]; !exists {
		t.Fatal("renamed context missing")
	}
	if config.CurrentContext != "shared-one" {
		t.Fatalf("current-context = %q, want renamed", config.CurrentContext)
	}
}

func TestRenameEntryRejectsUntrackedPath(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	file := filepath.Join(directory, "a.yaml")
	other := filepath.Join(directory, "other.yaml")
	writeTestFile(t, file, "apiVersion: v1\nkind: Config\n")
	writeTestFile(t, other, "apiVersion: v1\nkind: Config\n")

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{file}
	loader := NewLoaderWithRules(rules)

	if err := loader.RenameEntry(other, "cluster", "c", "c2"); err == nil {
		t.Fatal("want error for a path outside the configured sources")
	}
	if err := loader.RenameEntry(file, "cluster", "missing", "c2"); err == nil {
		t.Fatal("want error for an undefined entry")
	}
}

func TestRenameEntryRejectsTakenName(t *testing.T) {
	isolateChain(t)
	directory := t.TempDir()
	file := filepath.Join(directory, "taken.yaml")
	writeTestFile(t, file, `
apiVersion: v1
kind: Config
clusters:
- name: a
  cluster:
    server: https://a.example.test
- name: b
  cluster:
    server: https://b.example.test
`)

	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.Precedence = []string{file}
	loader := NewLoaderWithRules(rules)

	if err := loader.RenameEntry(file, "cluster", "a", "b"); err == nil {
		t.Fatal("want error when the new name is already taken")
	}
	if err := loader.RenameEntry(file, "deployment", "a", "a2"); err == nil {
		t.Fatal("want error for an unknown kind")
	}
}
