package session

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
)

// Refresh must replace transports as well as the context inventory. Otherwise
// a corrected kubeconfig still fails TLS until the desktop core is restarted.
func TestContextRefreshReloadsClientCAs(t *testing.T) {
	_, oldCA := refreshCertificate(t)
	certificate, newCA := refreshCertificate(t)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/statefulsets":
			io.WriteString(w, `{"apiVersion":"apps/v1","kind":"StatefulSetList","items":[]}`)
		case "/api/v1/namespaces/default/pods":
			io.WriteString(w, `{"apiVersion":"v1","kind":"PodList","items":[]}`)
		case "/version":
			io.WriteString(w, `{"gitVersion":"v1.36.3"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}}
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config")
	writeConfig := func(ca []byte) {
		t.Helper()
		cluster := &api.Cluster{Server: server.URL, CertificateAuthorityData: ca}
		config := api.Config{
			Clusters: map[string]*api.Cluster{"cluster": cluster},
			Contexts: map[string]*api.Context{"context": {Cluster: "cluster"}},
		}
		data, err := clientcmd.Write(config)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(configPath, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeConfig(oldCA)
	manager := NewManager(NewLoaderWithRules(&clientcmd.ClientConfigLoadingRules{ExplicitPath: configPath}))
	requests := map[string]func() error{
		"dynamic": func() error {
			client, err := manager.Client("context")
			if err != nil {
				return err
			}
			_, err = client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}).List(context.Background(), metav1.ListOptions{Limit: 100})
			return err
		},
		"core": func() error {
			client, err := manager.coreClient("context")
			if err != nil {
				return err
			}
			_, err = client.CoreV1().Pods("default").List(context.Background(), metav1.ListOptions{})
			return err
		},
		"discovery": func() error {
			client, err := manager.Discovery("context")
			if err != nil {
				return err
			}
			_, err = client.ServerVersion()
			return err
		},
	}
	for name, request := range requests {
		var unknownCA x509.UnknownAuthorityError
		if err := request(); !errors.As(err, &unknownCA) {
			t.Fatalf("%s with old CA: got %v, want unknown authority", name, err)
		}
	}
	writeConfig(newCA)
	if _, err := manager.Contexts(); err != nil {
		t.Fatal(err)
	}
	for name, request := range requests {
		if err := request(); err != nil {
			t.Errorf("%s after CA update and context refresh: %v", name, err)
		}
	}

	// Refresh and lazy client creation can overlap across RPC requests.
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			if _, err := manager.Contexts(); err != nil {
				t.Error(err)
			}
		})
		for name, request := range requests {
			wg.Go(func() {
				if err := request(); err != nil {
					t.Errorf("concurrent %s: %v", name, err)
				}
			})
		}
	}
	wg.Wait()
}

func refreshCertificate(t *testing.T) (tls.Certificate, []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "kubernetes-ca"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true,
		KeyUsage:    x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	certificate, err := tls.X509KeyPair(ca, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	if err != nil {
		t.Fatal(err)
	}
	return certificate, ca
}
