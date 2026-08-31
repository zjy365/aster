package session

import (
	"context"
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
)

// PortForwardTarget mirrors resources.PortForwardRequest for the session
// layer: the request kind plus which object name and port the forward is
// aimed at. Kept local to avoid resources -> session coupling.
type PortForwardTarget struct {
	Namespace string
	Name      string
	PodPort   int64
	Kind      string
}

// forwardWorkloadKinds are the selector-based kinds a forward can resolve to
// a single backing pod. Every one of them exposes spec.selector of
// metav1.LabelSelector shape, so the same code path serves all.
var forwardWorkloadKinds = map[string]bool{
	"Deployment":  true,
	"StatefulSet": true,
	"DaemonSet":   true,
	"ReplicaSet":  true,
}

// ResolveForwardTarget maps a Service or workload port-forward request to
// the pod that will actually carry the connection, translating named
// target ports to numbers. Service resolution reads the API server's own
// EndpointSlices (falling back to legacy Endpoints), which sidesteps
// selector translation entirely; workload resolution uses the full
// spec.selector, including matchExpressions.
func (m *Manager) ResolveForwardTarget(ctx context.Context, contextID, namespace, name, kind string, podPort int64) (string, int64, error) {
	request := PortForwardTarget{Namespace: namespace, Name: name, PodPort: podPort, Kind: kind}
	switch request.Kind {
	case "Service":
		return m.resolveServiceForwardTarget(ctx, contextID, request)
	case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet":
		return m.resolveWorkloadForwardTarget(ctx, contextID, request)
	default:
		return "", 0, fmt.Errorf("%q cannot be resolved to a backing pod", request.Kind)
	}
}

func (m *Manager) resolveServiceForwardTarget(ctx context.Context, contextID string, request PortForwardTarget) (string, int64, error) {
	client, err := m.coreClient(contextID)
	if err != nil {
		return "", 0, err
	}
	service, err := client.CoreV1().Services(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return "", 0, fmt.Errorf("get service %q: %w", request.Name, err)
	}
	var servicePort *corev1.ServicePort
	for index := range service.Spec.Ports {
		if int64(service.Spec.Ports[index].Port) == request.PodPort {
			port := service.Spec.Ports[index]
			servicePort = &port
			break
		}
	}
	if servicePort == nil {
		return "", 0, fmt.Errorf("service %q has no port %d", request.Name, request.PodPort)
	}
	if servicePort.Protocol != "" && servicePort.Protocol != corev1.ProtocolTCP {
		return "", 0, fmt.Errorf("port %d on service %q is %s; only TCP can be forwarded", request.PodPort, request.Name, servicePort.Protocol)
	}

	slices, err := client.DiscoveryV1().EndpointSlices(request.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "kubernetes.io/service-name=" + request.Name,
	})
	if err != nil && apierrors.IsNotFound(err) {
		// Pre-1.19 clusters only have the legacy Endpoints object.
		slices = nil
	} else if err != nil {
		return "", 0, fmt.Errorf("list endpointslices for service %q: %w", request.Name, err)
	}
	for index := range slices.Items {
		slice := &slices.Items[index]
		for endpointIndex := range slice.Endpoints {
			endpoint := &slice.Endpoints[endpointIndex]
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" || !endpointReady(endpoint) {
				continue
			}
			for portIndex := range slice.Ports {
				port := slice.Ports[portIndex]
				if portMatchesServicePort(port, servicePort) {
					return endpoint.TargetRef.Name, int64(portValue(port)), nil
				}
			}
		}
	}
	if slices != nil {
		// Newer path found slices but no ready port matched: try legacy
		// Endpoints before giving up so nothing regresses on mixed clusters.
		if fallback, port, err := m.resolveLegacyEndpoints(ctx, client, request, servicePort); err == nil {
			return fallback, port, nil
		}
		return "", 0, fmt.Errorf("service %q has no ready endpoints", request.Name)
	}
	return m.resolveLegacyEndpoints(ctx, client, request, servicePort)
}

func (m *Manager) resolveLegacyEndpoints(ctx context.Context, client kubernetes.Interface, request PortForwardTarget, servicePort *corev1.ServicePort) (string, int64, error) {
	endpoints, err := client.CoreV1().Endpoints(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
	if err != nil {
		return "", 0, fmt.Errorf("get endpoints for service %q: %w", request.Name, err)
	}
	for subsetIndex := range endpoints.Subsets {
		subset := &endpoints.Subsets[subsetIndex]
		for addressIndex := range subset.Addresses {
			address := &subset.Addresses[addressIndex]
			if address.TargetRef == nil || address.TargetRef.Kind != "Pod" {
				continue
			}
			for portIndex := range subset.Ports {
				port := subset.Ports[portIndex]
			if port.Name == servicePort.TargetPort.StrVal || (servicePort.TargetPort.Type == intstr.Int && int64(port.Port) == int64(servicePort.TargetPort.IntValue())) {
					return address.TargetRef.Name, int64(port.Port), nil
				}
			}
		}
	}
	return "", 0, fmt.Errorf("service %q has no ready endpoints", request.Name)
}

func endpointReady(endpoint *discoveryv1.Endpoint) bool {
	return endpoint.Conditions.Ready == nil || *endpoint.Conditions.Ready
}

func portMatchesServicePort(port discoveryv1.EndpointPort, servicePort *corev1.ServicePort) bool {
	if servicePort.TargetPort.Type == intstr.Int {
		return port.Port != nil && int64(*port.Port) == int64(servicePort.TargetPort.IntValue())
	}
	return port.Name != nil && *port.Name == servicePort.TargetPort.StrVal
}

func portValue(port discoveryv1.EndpointPort) int32 {
	if port.Port == nil {
		return 0
	}
	return *port.Port
}

func (m *Manager) resolveWorkloadForwardTarget(ctx context.Context, contextID string, request PortForwardTarget) (string, int64, error) {
	client, err := m.coreClient(contextID)
	if err != nil {
		return "", 0, err
	}
	var selector *metav1.LabelSelector
	switch request.Kind {
	case "Deployment":
		object, err := client.AppsV1().Deployments(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
		if err != nil {
			return "", 0, fmt.Errorf("get deployment %q: %w", request.Name, err)
		}
		selector = object.Spec.Selector
	case "StatefulSet":
		object, err := client.AppsV1().StatefulSets(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
		if err != nil {
			return "", 0, fmt.Errorf("get statefulset %q: %w", request.Name, err)
		}
		selector = object.Spec.Selector
	case "DaemonSet":
		object, err := client.AppsV1().DaemonSets(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
		if err != nil {
			return "", 0, fmt.Errorf("get daemonset %q: %w", request.Name, err)
		}
		selector = object.Spec.Selector
	case "ReplicaSet":
		object, err := client.AppsV1().ReplicaSets(request.Namespace).Get(ctx, request.Name, metav1.GetOptions{})
		if err != nil {
			return "", 0, fmt.Errorf("get replicaset %q: %w", request.Name, err)
		}
		selector = object.Spec.Selector
	default:
		return "", 0, fmt.Errorf("%q is not a workload that can be forwarded", request.Kind)
	}
	if selector == nil {
		return "", 0, fmt.Errorf("workload %q has no pod selector", request.Name)
	}
	labelSelector, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return "", 0, fmt.Errorf("convert selector for %q: %w", request.Name, err)
	}
	pods, err := client.CoreV1().Pods(request.Namespace).List(ctx, metav1.ListOptions{LabelSelector: labelSelector.String()})
	if err != nil {
		return "", 0, fmt.Errorf("list pods for %q: %w", request.Name, err)
	}
	if len(pods.Items) == 0 {
		return "", 0, fmt.Errorf("no pods match %q %q", request.Kind, request.Name)
	}
	// Prefer Running and ready, then Running, then anything else; among
	// equals, pick the newest so a rollout lands on the current pods.
	sort.SliceStable(pods.Items, func(i, j int) bool {
		return podForwardRank(&pods.Items[i]) > podForwardRank(&pods.Items[j])
	})
	pod := &pods.Items[0]
	return pod.Name, request.PodPort, nil
}

func podForwardRank(pod *corev1.Pod) int {
	rank := 0
	if pod.Status.Phase == corev1.PodRunning {
		rank += 2
		for _, condition := range pod.Status.Conditions {
			if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
				rank++
				break
			}
		}
	}
	return rank
}
