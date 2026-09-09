// SPDX-License-Identifier: Apache-2.0
package session

import (
	"context"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/util/httpstream"
	streamspdy "k8s.io/apimachinery/pkg/util/httpstream/spdy"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/client-go/tools/portforward"
)

func forwardTestManager(t *testing.T, server *httptest.Server) *Manager {
	t.Helper()
	cluster := &api.Cluster{Server: server.URL}
	if cert := server.Certificate(); cert != nil {
		cluster.CertificateAuthorityData = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
	}
	config := api.Config{
		Clusters:  map[string]*api.Cluster{"cluster": cluster},
		Contexts:  map[string]*api.Context{"dev": {Cluster: "cluster", AuthInfo: "user"}},
		AuthInfos: map[string]*api.AuthInfo{"user": {Token: "test-token"}},
	}
	data, err := clientcmd.Write(config)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	rules.ExplicitPath = path
	return NewManager(NewLoaderWithRules(rules))
}

func TestPortForwardCancelsStalledUpgrade(t *testing.T) {
	entered := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(cancelled)
	}))
	defer server.Close()
	defer server.CloseClientConnections()
	manager := forwardTestManager(t, server)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, _, err := manager.PortForward(ctx, "dev", "apps", "web", 80, 0); result <- err }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("no upgrade request")
	}
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled setup succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("setup stuck")
	}
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream request leaked")
	}
}

func TestPortForwardConcurrentStopAndCancelReleasesListener(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("kubeconfig authentication was not preserved")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if _, err := httpstream.Handshake(r, w, []string{portforward.PortForwardProtocolV1Name}); err != nil {
			return
		}
		conn := streamspdy.NewResponseUpgrader().UpgradeResponse(w, r, func(stream httpstream.Stream, replied <-chan struct{}) error {
			if stream.Headers().Get("streamType") == "data" {
				go func() { <-replied; _, _ = io.Copy(stream, stream); stream.Close() }()
			}
			return nil
		})
		if conn == nil {
			return
		}
		defer conn.Close()
		<-conn.CloseChan()
		close(closed)
	}))
	defer server.Close()
	defer server.CloseClientConnections()
	manager := forwardTestManager(t, server)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop, port, err := manager.PortForward(ctx, "dev", "apps", "web", 80, 0)
	if err != nil {
		t.Fatal(err)
	}
	local, err := net.DialTimeout("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	local.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := local.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	response := make([]byte, 4)
	if _, err := io.ReadFull(local, response); err != nil {
		t.Fatal(err)
	}
	if string(response) != "ping" {
		t.Fatalf("response=%q", response)
	}
	local.Close()
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); stop(); cancel() }()
	}
	wg.Wait()
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream connection leaked")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err == nil {
			listener.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("listener not reclaimed: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
}
