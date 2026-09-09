package session

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	streamspdy "k8s.io/apimachinery/pkg/util/httpstream/spdy"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/zjy365/aster/core/internal/version"
)

type dynamicFactory func(*rest.Config) (dynamic.Interface, error)

type Manager struct {
	loader      *Loader
	factory     dynamicFactory
	coreFactory func(*rest.Config) (kubernetes.Interface, error)
	// serverVersion performs the /version probe behind Health; replaceable in
	// tests so probes never need a live API server.
	serverVersion func(*rest.Config) (string, error)

	mu               sync.Mutex
	clients          map[string]dynamic.Interface
	coreClients      map[string]kubernetes.Interface
	discoveryClients map[string]discovery.DiscoveryInterface
}

type cappedBuffer struct {
	value     bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedBuffer) Write(value []byte) (int, error) {
	if b.value.Len() < b.limit {
		remaining := b.limit - b.value.Len()
		if len(value) > remaining {
			_, _ = b.value.Write(value[:remaining])
			b.truncated = true
		} else {
			_, _ = b.value.Write(value)
		}
	} else if len(value) > 0 {
		b.truncated = true
	}
	return len(value), nil
}

func (b *cappedBuffer) String() string { return b.value.String() }

func NewManager(loader *Loader) *Manager {
	return newManager(loader, func(config *rest.Config) (dynamic.Interface, error) {
		return dynamic.NewForConfig(config)
	})
}

func newManager(loader *Loader, factory dynamicFactory) *Manager {
	return &Manager{
		loader:           loader,
		factory:          factory,
		coreFactory:      func(config *rest.Config) (kubernetes.Interface, error) { return kubernetes.NewForConfig(config) },
		serverVersion:    defaultServerVersion,
		clients:          make(map[string]dynamic.Interface),
		coreClients:      make(map[string]kubernetes.Interface),
		discoveryClients: make(map[string]discovery.DiscoveryInterface),
	}
}

func (m *Manager) PodLogs(ctx context.Context, contextID, namespace, name, container string, tailLines int64, previous, timestamps bool) (io.ReadCloser, error) {
	return m.podLogs(ctx, contextID, namespace, name, container, tailLines, false, previous, timestamps)
}

func (m *Manager) PodLogsFollow(ctx context.Context, contextID, namespace, name, container string, tailLines int64, previous, timestamps bool) (io.ReadCloser, error) {
	return m.podLogs(ctx, contextID, namespace, name, container, tailLines, true, previous, timestamps)
}

func (m *Manager) podLogs(ctx context.Context, contextID, namespace, name, container string, tailLines int64, follow, previous, timestamps bool) (io.ReadCloser, error) {
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("contextId, namespace and name are required")
	}
	client, err := m.coreClient(contextID)
	if err != nil {
		return nil, err
	}
	options := &corev1.PodLogOptions{Container: container, TailLines: &tailLines, Follow: follow, Previous: previous, Timestamps: timestamps}
	return client.CoreV1().Pods(namespace).GetLogs(name, options).Stream(ctx)
}

// PodContainers lists spec container names (app + init) so the log viewer can
// populate its picker without a second manifest fetch client-side.
func (m *Manager) PodContainers(ctx context.Context, contextID, namespace, name string) ([]string, error) {
	if contextID == "" || namespace == "" || name == "" {
		return nil, fmt.Errorf("contextId, namespace and name are required")
	}
	client, err := m.coreClient(contextID)
	if err != nil {
		return nil, err
	}
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get pod %q: %w", name, err)
	}
	names := make([]string, 0, len(pod.Spec.Containers)+len(pod.Spec.InitContainers))
	for _, container := range pod.Spec.Containers {
		names = append(names, container.Name)
	}
	for _, container := range pod.Spec.InitContainers {
		names = append(names, container.Name)
	}
	return names, nil
}

func (m *Manager) coreClient(contextID string) (kubernetes.Interface, error) {
	if contextID == "" {
		return nil, fmt.Errorf("contextId is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	client, exists := m.coreClients[contextID]
	if !exists {
		config, err := m.loader.ClientConfig(contextID).ClientConfig()
		if err != nil {
			return nil, fmt.Errorf("load context %q: %w", contextID, err)
		}
		config.UserAgent = version.UserAgent()
		client, err = m.coreFactory(config)
		if err != nil {
			return nil, fmt.Errorf("create core client for context %q: %w", contextID, err)
		}
		m.coreClients[contextID] = client
	}
	return client, nil
}

func (m *Manager) PodExec(ctx context.Context, contextID, namespace, name, container string, command []string) (string, string, error) {
	if contextID == "" || namespace == "" || name == "" || len(command) == 0 {
		return "", "", fmt.Errorf("contextId, namespace, name and command are required")
	}
	client, err := m.coreClient(contextID)
	if err != nil {
		return "", "", err
	}
	// The SPDY executor needs the raw rest config for its own transport.
	config, err := m.loader.ClientConfig(contextID).ClientConfig()
	if err != nil {
		return "", "", fmt.Errorf("load context %q: %w", contextID, err)
	}
	config.UserAgent = version.UserAgent()
	request := client.CoreV1().RESTClient().Post().Resource("pods").Name(name).Namespace(namespace).SubResource("exec").VersionedParams(&corev1.PodExecOptions{Container: container, Command: command, Stdin: false, Stdout: true, Stderr: true, TTY: false}, scheme.ParameterCodec)
	executor, err := remotecommand.NewSPDYExecutor(config, "POST", request.URL())
	if err != nil {
		return "", "", fmt.Errorf("create exec stream: %w", err)
	}
	stdout := &cappedBuffer{limit: 1 << 20}
	stderr := &cappedBuffer{limit: 1 << 20}
	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: stdout, Stderr: stderr})
	return stdout.String(), stderr.String(), err
}

func (m *Manager) Contexts() ([]ContextInfo, error) {
	return m.loader.Contexts()
}

// RenameEntry resolves a kubeconfig name collision by renaming the colliding
// entry inside a configured source file (see Loader.RenameEntry).
func (m *Manager) RenameEntry(path, kind, name, newName string) error {
	return m.loader.RenameEntry(path, kind, name, newName)
}

// ClientConfig exposes the context's client config to other domains (Helm).
// It performs no connection and validates the context id like the lazy
// clients do.
func (m *Manager) ClientConfig(contextID string) (clientcmd.ClientConfig, error) {
	if contextID == "" {
		return nil, fmt.Errorf("contextId is required")
	}
	return m.loader.ClientConfig(contextID), nil
}

func (m *Manager) SourceReports() SourcesReport {
	return m.loader.SourceReports()
}

func (m *Manager) Discovery(contextID string) (discovery.DiscoveryInterface, error) {
	if contextID == "" {
		return nil, fmt.Errorf("contextId is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if client, exists := m.discoveryClients[contextID]; exists {
		return client, nil
	}
	config, err := m.loader.ClientConfig(contextID).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("load context %q: %w", contextID, err)
	}
	config.UserAgent = version.UserAgent()
	client, err := discovery.NewDiscoveryClientForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create discovery client for context %q: %w", contextID, err)
	}
	m.discoveryClients[contextID] = client
	return client, nil
}

func (m *Manager) Client(contextID string) (dynamic.Interface, error) {
	if contextID == "" {
		return nil, fmt.Errorf("contextId is required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if client, exists := m.clients[contextID]; exists {
		return client, nil
	}

	config, err := m.loader.ClientConfig(contextID).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("load context %q: %w", contextID, err)
	}
	config.UserAgent = version.UserAgent()
	if config.QPS == 0 {
		config.QPS = 30
	}
	if config.Burst == 0 {
		config.Burst = 60
	}
	client, err := m.factory(config)
	if err != nil {
		return nil, fmt.Errorf("create client for context %q: %w", contextID, err)
	}
	m.clients[contextID] = client
	return client, nil
}

// PortForward opens a loopback listener on a random free port and forwards to
// the pod port over SPDY. The returned stop function tears the listener down;
// the forward also ends when the context is cancelled.
func (m *Manager) PortForward(ctx context.Context, contextID, namespace, name string, podPort, localPort int64) (func(), int, error) {
	if contextID == "" || namespace == "" || name == "" {
		return nil, 0, fmt.Errorf("contextId, namespace and name are required")
	}
	config, err := m.loader.ClientConfig(contextID).ClientConfig()
	if err != nil {
		return nil, 0, fmt.Errorf("load context %q: %w", contextID, err)
	}
	config.UserAgent = version.UserAgent()
	// HTTP/1.1 upgrades use net/http's cancellable response-header read.
	config.NextProtos = []string{"http/1.1"}
	client, err := rest.HTTPClientFor(config)
	if err != nil {
		return nil, 0, fmt.Errorf("create port-forward client: %w", err)
	}
	dialer := &portForwardDialer{ctx: ctx, client: client, url: upstreamURL(config.Host, namespace, name)}
	stopChan := make(chan struct{})
	stop := sync.OnceFunc(func() { close(stopChan) })
	readyChan := make(chan struct{})
	forwarder, err := portforward.New(dialer, []string{fmt.Sprintf("%d:%d", localPort, podPort)}, stopChan, readyChan, io.Discard, io.Discard)
	if err != nil {
		return nil, 0, fmt.Errorf("create port forwarder: %w", err)
	}
	errChan := make(chan error, 1)
	go func() { errChan <- forwarder.ForwardPorts() }()
	select {
	case <-readyChan:
	case err := <-errChan:
		return nil, 0, fmt.Errorf("port forward: %w", err)
	case <-ctx.Done():
		stop()
		return nil, 0, ctx.Err()
	}
	ports, err := forwarder.GetPorts()
	if err != nil || len(ports) == 0 {
		stop()
		return nil, 0, fmt.Errorf("read forwarded ports: %w", err)
	}
	go func() {
		select {
		case <-ctx.Done():
			stop()
		case <-stopChan:
		case <-errChan:
			stop()
		}
	}()
	return stop, int(ports[0].Local), nil
}

// client-go's SPDY transport does not cancel a blocked response-header read.
// net/http retains cancellation and kubeconfig transport settings, and exposes
// a successful 101 response as a duplex stream for the SPDY client.
type portForwardDialer struct {
	ctx    context.Context
	client *http.Client
	url    *url.URL
}

func (d *portForwardDialer) Dial(protocols ...string) (httpstream.Connection, string, error) {
	request, err := http.NewRequestWithContext(d.ctx, http.MethodPost, d.url.String(), nil)
	if err != nil {
		return nil, "", err
	}
	request.Header.Set(httpstream.HeaderConnection, httpstream.HeaderUpgrade)
	request.Header.Set(httpstream.HeaderUpgrade, streamspdy.HeaderSpdy31)
	for _, protocol := range protocols {
		request.Header.Add(httpstream.HeaderProtocolVersion, protocol)
	}
	var socket net.Conn
	request = request.WithContext(httptrace.WithClientTrace(request.Context(), &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) { socket = info.Conn },
	}))
	response, err := d.client.Do(request)
	if err != nil {
		return nil, "", err
	}
	protocol := response.Header.Get(httpstream.HeaderProtocolVersion)
	accepted := false
	for _, offered := range protocols {
		if protocol == offered {
			accepted = true
		}
	}
	if response.StatusCode != http.StatusSwitchingProtocols || !accepted ||
		!strings.EqualFold(response.Header.Get(httpstream.HeaderUpgrade), streamspdy.HeaderSpdy31) {
		response.Body.Close()
		return nil, "", fmt.Errorf("port-forward upgrade rejected: HTTP %d", response.StatusCode)
	}
	stream, ok := response.Body.(io.ReadWriteCloser)
	if !ok || socket == nil {
		response.Body.Close()
		return nil, "", fmt.Errorf("port-forward upgrade did not return a duplex stream")
	}
	connection, err := streamspdy.NewClientConnectionWithPings(&upgradedForwardConn{Conn: socket, stream: stream}, 5*time.Second)
	if err != nil {
		stream.Close()
		return nil, "", err
	}
	return connection, protocol, nil
}

// Read through the HTTP response body to preserve bytes buffered during the
// upgrade; delegate addresses and deadlines to the underlying socket.
type upgradedForwardConn struct {
	net.Conn
	stream io.ReadWriteCloser
}

func (c *upgradedForwardConn) Read(p []byte) (int, error)  { return c.stream.Read(p) }
func (c *upgradedForwardConn) Write(p []byte) (int, error) { return c.stream.Write(p) }
func (c *upgradedForwardConn) Close() error                { return c.stream.Close() }

func upstreamURL(host, namespace, name string) *url.URL {
	scheme := "https"
	trimmed := host
	if strings.HasPrefix(host, "http://") {
		scheme = "http"
		trimmed = strings.TrimPrefix(host, "http://")
	} else {
		trimmed = strings.TrimPrefix(host, "https://")
	}
	return &url.URL{
		Scheme: scheme,
		Host:   trimmed,
		Path:   fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/portforward", namespace, name),
	}
}
