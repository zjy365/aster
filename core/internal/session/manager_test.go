package session

import (
	"os"
	"path/filepath"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
)

func TestManagerCreatesClientsLazilyAndCachesThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	config := api.Config{
		Clusters: map[string]*api.Cluster{"cluster": {Server: "https://example.test"}},
		Contexts: map[string]*api.Context{"context": {Cluster: "cluster"}},
	}
	value, err := clientcmd.Write(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, value, 0o600); err != nil {
		t.Fatal(err)
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.ExplicitPath = path

	created := 0
	var captured *rest.Config
	manager := newManager(NewLoaderWithRules(rules), func(config *rest.Config) (dynamic.Interface, error) {
		created++
		captured = config
		return fake.NewSimpleDynamicClient(runtime.NewScheme()), nil
	})
	if created != 0 {
		t.Fatal("client was created before first request")
	}
	first, err := manager.Client("context")
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Client("context")
	if err != nil {
		t.Fatal(err)
	}
	if first != second || created != 1 {
		t.Fatalf("cache failed: same=%v created=%d", first == second, created)
	}
	if captured.UserAgent != "aster/0.1" || captured.QPS != 30 || captured.Burst != 60 {
		t.Fatalf("config = %#v", captured)
	}
}

func TestUpstreamURLScheme(t *testing.T) {
	cases := []struct{ host, wantScheme string }{
		{"https://127.0.0.1:6443", "https"},
		{"http://127.0.0.1:8080", "http"},
		{"127.0.0.1:8080", "https"},
	}
	for _, tc := range cases {
		got := upstreamURL(tc.host, "apps", "web")
		if got.Scheme != tc.wantScheme {
			t.Errorf("host %q: scheme = %q, want %q", tc.host, got.Scheme, tc.wantScheme)
		}
		if got.Host != "127.0.0.1:6443" && got.Host != "127.0.0.1:8080" {
			t.Errorf("host %q: unexpected host %q", tc.host, got.Host)
		}
	}
}
