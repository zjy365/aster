package session

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func newResolveManager(objects ...runtime.Object) *Manager {
	clientset := kubernetesfake.NewSimpleClientset(objects...)
	manager := NewManager(nil)
	manager.coreClients["dev"] = clientset
	return manager
}

func TestResolveServiceForwardTargetPicksReadyEndpoint(t *testing.T) {
	ready := true
	notReady := false
	named := "http"
	port80 := int32(80)
	manager := newResolveManager(
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps"}, Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Name: "http", Port: 80, TargetPort: intstr.FromString(named)}}}},
		&discoveryv1.EndpointSlice{
			ObjectMeta:  metav1.ObjectMeta{Name: "web-1", Namespace: "apps", Labels: map[string]string{"kubernetes.io/service-name": "web"}},
			AddressType: "IPv4",
			Endpoints: []discoveryv1.Endpoint{
				{Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: v1ObjectReference("Pod", "web-not-ready")},
				{Conditions: discoveryv1.EndpointConditions{Ready: &ready}, TargetRef: v1ObjectReference("Pod", "web-ready")},
			},
			Ports: []discoveryv1.EndpointPort{{Name: &named, Port: &port80}},
		},
	)
	pod, port, err := manager.ResolveForwardTarget(context.Background(), "dev", "apps", "web", "Service", 80)
	if err != nil {
		t.Fatal(err)
	}
	if pod != "web-ready" || port != 80 {
		t.Fatalf("pod=%q port=%d", pod, port)
	}
}

func TestResolveServiceForwardTargetNoReadyEndpoints(t *testing.T) {
	notReady := false
	manager := newResolveManager(
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps"}, Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Port: 80, TargetPort: intstr.FromInt(8080)}}}},
		&discoveryv1.EndpointSlice{
			ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "apps", Labels: map[string]string{"kubernetes.io/service-name": "web"}},
			Endpoints:  []discoveryv1.Endpoint{{Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: v1ObjectReference("Pod", "web")}},
		},
	)
	if _, _, err := manager.ResolveForwardTarget(context.Background(), "dev", "apps", "web", "Service", 80); err == nil {
		t.Fatal("expected no-ready-endpoints error")
	}
}

func TestResolveWorkloadForwardTargetUsesFullSelector(t *testing.T) {
	manager := newResolveManager(
		appsv1Deployment("apps", "api", map[string]string{"app": "api"}, []metav1.LabelSelectorRequirement{{Key: "tier", Operator: metav1.LabelSelectorOpIn, Values: []string{"web", "edge"}}}),
		podWithLabels("apps", "api-a", map[string]string{"app": "api", "tier": "web"}, corev1.PodRunning, true),
		podWithLabels("apps", "api-b", map[string]string{"app": "api", "tier": "cache"}, corev1.PodRunning, true),
		podWithLabels("apps", "api-c", map[string]string{"app": "api", "tier": "web"}, corev1.PodPending, false),
	)
	pod, port, err := manager.ResolveForwardTarget(context.Background(), "dev", "apps", "api", "Deployment", 8080)
	if err != nil {
		t.Fatal(err)
	}
	if pod != "api-a" {
		t.Fatalf("pod=%q, want api-a (Running+ready, selector matches)", pod)
	}
	if port != 8080 {
		t.Fatalf("port=%d", port)
	}
}

func TestResolveWorkloadForwardTargetNoMatch(t *testing.T) {
	manager := newResolveManager(
		appsv1Deployment("apps", "api", map[string]string{"app": "api"}, nil),
		podWithLabels("apps", "other", map[string]string{"app": "other"}, corev1.PodRunning, true),
	)
	if _, _, err := manager.ResolveForwardTarget(context.Background(), "dev", "apps", "api", "Deployment", 8080); err == nil {
		t.Fatal("expected no-match error")
	}
}

func TestResolveWorkloadForwardTargetPrefersRunning(t *testing.T) {
	manager := newResolveManager(
		appsv1Deployment("apps", "api", map[string]string{"app": "api"}, nil),
		podWithLabels("apps", "api-pending", map[string]string{"app": "api"}, corev1.PodPending, false),
		podWithLabels("apps", "api-running", map[string]string{"app": "api"}, corev1.PodRunning, true),
	)
	pod, _, err := manager.ResolveForwardTarget(context.Background(), "dev", "apps", "api", "Deployment", 80)
	if err != nil {
		t.Fatal(err)
	}
	if pod != "api-running" {
		t.Fatalf("pod=%q, want api-running", pod)
	}
}

func v1ObjectReference(kind, name string) *corev1.ObjectReference {
	return &corev1.ObjectReference{Kind: kind, Name: name}
}

func podWithLabels(namespace, name string, labels map[string]string, phase corev1.PodPhase, ready bool) *corev1.Pod {
	status := corev1.ConditionFalse
	if ready {
		status = corev1.ConditionTrue
	}
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: labels, UID: types.UID(name)},
		Status: corev1.PodStatus{
			Phase:      phase,
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: status}},
		},
	}
}

func appsv1Deployment(namespace, name string, matchLabels map[string]string, matchExpressions []metav1.LabelSelectorRequirement) *appsv1.Deployment {
	return &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: matchLabels, MatchExpressions: matchExpressions},
		},
	}
}

func TestServiceForwardNamedPortAndLegacyFallback(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "slices", true: "legacy"}[legacy], func(t *testing.T) {
			name := "public"
			port := int32(8080)
			service := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps"}, Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Name: name, Port: 80, TargetPort: intstr.FromString("http")}}}}
			slice := &discoveryv1.EndpointSlice{ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "apps", Labels: map[string]string{"kubernetes.io/service-name": "web"}}, Endpoints: []discoveryv1.Endpoint{{TargetRef: v1ObjectReference("Pod", "web-1")}}, Ports: []discoveryv1.EndpointPort{{Name: &name, Port: &port}}}
			endpoints := &corev1.Endpoints{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "apps"}, Subsets: []corev1.EndpointSubset{{Addresses: []corev1.EndpointAddress{{TargetRef: v1ObjectReference("Pod", "web-1")}}, Ports: []corev1.EndpointPort{{Name: name, Port: port}}}}}
			var m *Manager
			if legacy {
				m = newResolveManager(service, endpoints)
				m.coreClients["dev"].(*kubernetesfake.Clientset).PrependReactor("list", "endpointslices", func(ktesting.Action) (bool, runtime.Object, error) {
					return true, nil, apierrors.NewNotFound(schema.GroupResource{Group: "discovery.k8s.io", Resource: "endpointslices"}, "")
				})
			} else {
				m = newResolveManager(service, slice)
			}
			pod, gotPort, err := m.ResolveForwardTarget(context.Background(), "dev", "apps", "web", "Service", 80)
			if err != nil || pod != "web-1" || gotPort != 8080 {
				t.Fatalf("pod=%q port=%d err=%v", pod, gotPort, err)
			}
		})
	}
}

func TestEndpointPortMatchesServiceNameAndTCP(t *testing.T) {
	name := "public"
	wrong := "http"
	port := int32(8080)
	udp := corev1.ProtocolUDP
	servicePort := &corev1.ServicePort{Name: name, Port: 80, TargetPort: intstr.FromString(wrong)}
	for _, tc := range []struct {
		name string
		port discoveryv1.EndpointPort
		want bool
	}{
		{"valid", discoveryv1.EndpointPort{Name: &name, Port: &port}, true},
		{"target name", discoveryv1.EndpointPort{Name: &wrong, Port: &port}, false},
		{"missing port", discoveryv1.EndpointPort{Name: &name}, false},
		{"udp", discoveryv1.EndpointPort{Name: &name, Port: &port, Protocol: &udp}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := portMatchesServicePort(tc.port, servicePort); got != tc.want {
				t.Fatalf("match=%v", got)
			}
		})
	}
}

func TestServiceForwardSelectsTCPWithSameNumberUDP(t *testing.T) {
	for _, udpFirst := range []bool{true, false} {
		name := "dns-tcp"
		port := int32(53)
		tcp := corev1.ProtocolTCP
		ports := []corev1.ServicePort{
			{Name: "dns-udp", Port: 53, TargetPort: intstr.FromInt(53), Protocol: corev1.ProtocolUDP},
			{Name: name, Port: 53, TargetPort: intstr.FromInt(53), Protocol: tcp},
		}
		if !udpFirst {
			ports[0], ports[1] = ports[1], ports[0]
		}
		m := newResolveManager(
			&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "dns", Namespace: "apps"}, Spec: corev1.ServiceSpec{Ports: ports}},
			&discoveryv1.EndpointSlice{ObjectMeta: metav1.ObjectMeta{Name: "dns-1", Namespace: "apps", Labels: map[string]string{"kubernetes.io/service-name": "dns"}}, Endpoints: []discoveryv1.Endpoint{{TargetRef: v1ObjectReference("Pod", "dns-1")}}, Ports: []discoveryv1.EndpointPort{{Name: &name, Port: &port, Protocol: &tcp}}},
		)
		pod, gotPort, err := m.ResolveForwardTarget(context.Background(), "dev", "apps", "dns", "Service", 53)
		if err != nil || pod != "dns-1" || gotPort != 53 {
			t.Fatalf("udpFirst=%v pod=%q port=%d err=%v", udpFirst, pod, gotPort, err)
		}
	}
}

func TestServiceForwardRejectsUDPOnly(t *testing.T) {
	m := newResolveManager(&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "dns", Namespace: "apps"}, Spec: corev1.ServiceSpec{Ports: []corev1.ServicePort{{Port: 53, Protocol: corev1.ProtocolUDP}}}})
	if _, _, err := m.ResolveForwardTarget(context.Background(), "dev", "apps", "dns", "Service", 53); err == nil {
		t.Fatal("UDP-only service accepted")
	}
}
