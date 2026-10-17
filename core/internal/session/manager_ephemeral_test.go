package session

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	clienttesting "k8s.io/client-go/testing"
)

// newEphemeralTestManager wires a manager whose core client is a fake
// clientset seeded with the given pod.
func newEphemeralTestManager(t *testing.T, pod *corev1.Pod) (*Manager, *kubernetesfake.Clientset) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	config := api.Config{
		Clusters:  map[string]*api.Cluster{"cluster": {Server: "https://example.test"}},
		Contexts:  map[string]*api.Context{"context": {Cluster: "cluster"}},
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
	clientset := kubernetesfake.NewSimpleClientset(pod)
	manager := newManager(NewLoaderWithRules(rules), func(config *rest.Config) (dynamic.Interface, error) {
		return fake.NewSimpleDynamicClient(runtime.NewScheme()), nil
	})
	manager.coreFactory = func(config *rest.Config) (kubernetes.Interface, error) {
		return clientset, nil
	}
	return manager, clientset
}

func debugPod(name string, ephemeral ...corev1.EphemeralContainer) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "apps"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app", Image: "example/app:v1"}},
			EphemeralContainers: ephemeral,
		},
	}
}

func TestAddEphemeralContainerGeneratesUniqueNameAndAppends(t *testing.T) {
	existing := corev1.EphemeralContainer{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debugger-aaaaa", Image: "busybox:1.36"}}
	pod := debugPod("web", existing)
	manager, clientset := newEphemeralTestManager(t, pod)

	entry, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "web", "", "busybox:1.36", nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(entry.Name, "debugger-") || entry.Name == "debugger-aaaaa" {
		t.Fatalf("generated name = %q", entry.Name)
	}
	if entry.Image != "busybox:1.36" || entry.Stdin || entry.TTY {
		t.Fatalf("entry = %#v", entry.EphemeralContainerCommon)
	}
	if entry.TerminationMessagePolicy != corev1.TerminationMessageReadFile {
		t.Fatalf("terminationMessagePolicy = %q", entry.TerminationMessagePolicy)
	}
	// Append semantics: the existing ephemeral container survives.
	stored, err := clientset.CoreV1().Pods("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Spec.EphemeralContainers) != 2 || stored.Spec.EphemeralContainers[0].Name != "debugger-aaaaa" {
		t.Fatalf("stored ephemeral containers = %#v", stored.Spec.EphemeralContainers)
	}
	if stored.Spec.Containers[0].Image != "example/app:v1" || len(stored.Spec.Containers) != 1 {
		t.Fatalf("regular pod spec was modified: %#v", stored.Spec.Containers)
	}
	// The write went through the pods/ephemeralcontainers subresource.
	sawSubresource := false
	for _, action := range clientset.Actions() {
		if update, ok := action.(clienttesting.UpdateAction); ok && action.GetResource().Resource == "pods" {
			if action.GetSubresource() != "ephemeralcontainers" {
				t.Fatalf("pod update hit subresource %q", action.GetSubresource())
			}
			sawSubresource = true
			if _, ok := update.GetObject().(*corev1.Pod); !ok {
				t.Fatalf("update carried %T", update.GetObject())
			}
		}
	}
	if !sawSubresource {
		t.Fatal("no ephemeralcontainers update was issued")
	}
}

func TestAddEphemeralContainerPassesExplicitFields(t *testing.T) {
	manager, clientset := newEphemeralTestManager(t, debugPod("web"))
	env := []corev1.EnvVar{{Name: "TRACE", Value: "1"}}

	entry, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "web", "inspect", "busybox:1.36",
		[]string{"/bin/sh", "-c"}, []string{"ps aux"}, "app", env)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Name != "inspect" || entry.TargetContainerName != "app" {
		t.Fatalf("entry = %#v", entry)
	}
	if len(entry.Command) != 2 || entry.Command[0] != "/bin/sh" || len(entry.Args) != 1 || entry.Args[0] != "ps aux" {
		t.Fatalf("argv = %v %v", entry.Command, entry.Args)
	}
	if len(entry.Env) != 1 || entry.Env[0] != env[0] {
		t.Fatalf("env = %#v", entry.Env)
	}
	stored, err := clientset.CoreV1().Pods("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Spec.EphemeralContainers) != 1 || stored.Spec.EphemeralContainers[0].Name != "inspect" {
		t.Fatalf("stored = %#v", stored.Spec.EphemeralContainers)
	}
}

func TestAddEphemeralContainerRejectsDuplicateName(t *testing.T) {
	pod := debugPod("web", corev1.EphemeralContainer{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "inspect", Image: "busybox:1.36"}})
	manager, clientset := newEphemeralTestManager(t, pod)

	_, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "web", "inspect", "busybox:1.36", nil, nil, "", nil)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("err = %v", err)
	}
	for _, action := range clientset.Actions() {
		if action.GetVerb() == "update" {
			t.Fatal("a duplicate name still issued an update")
		}
	}
}

func TestAddEphemeralContainerPodMissing(t *testing.T) {
	manager, _ := newEphemeralTestManager(t, debugPod("web"))

	_, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "gone", "", "busybox:1.36", nil, nil, "", nil)
	if err == nil {
		t.Fatal("missing pod was accepted")
	}
	if !apierrors.IsNotFound(err) && !strings.Contains(err.Error(), "get pod") {
		t.Fatalf("err = %v", err)
	}
}

func TestAddEphemeralContainerSubresourceRejection(t *testing.T) {
	manager, clientset := newEphemeralTestManager(t, debugPod("web"))
	rejection := apierrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "web", nil)
	clientset.PrependReactor("update", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		if action.GetSubresource() == "ephemeralcontainers" {
			return true, nil, rejection
		}
		return false, nil, nil
	})

	_, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "web", "inspect", "busybox:1.36", nil, nil, "", nil)
	if err == nil || !strings.Contains(err.Error(), "update ephemeral containers") {
		t.Fatalf("err = %v", err)
	}
	if !apierrors.IsInvalid(err) {
		t.Fatalf("subresource rejection lost its API error shape: %v", err)
	}
}

func TestAddEphemeralContainerRequiresImage(t *testing.T) {
	manager, _ := newEphemeralTestManager(t, debugPod("web"))
	if _, err := manager.AddEphemeralContainer(context.Background(), "context", "apps", "web", "", "  ", nil, nil, "", nil); err == nil || !strings.Contains(err.Error(), "image") {
		t.Fatalf("err = %v", err)
	}
	if _, err := manager.AddEphemeralContainer(context.Background(), "", "apps", "web", "", "busybox:1.36", nil, nil, "", nil); err == nil {
		t.Fatal("missing contextId was accepted")
	}
}
