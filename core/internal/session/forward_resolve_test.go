package session

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	appsv1 "k8s.io/api/apps/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
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
			ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "apps", Labels: map[string]string{"kubernetes.io/service-name": "web"}},
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
			Endpoints: []discoveryv1.Endpoint{{Conditions: discoveryv1.EndpointConditions{Ready: &notReady}, TargetRef: v1ObjectReference("Pod", "web")}},
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
			Phase:     phase,
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
