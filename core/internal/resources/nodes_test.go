package resources

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
)

// typedNodeProvider adapts a typed fake clientset as the Service's client
// provider; the dynamic half is an inert empty fake because node operations
// only touch the typed interface.
type typedNodeProvider struct{ core *kubernetesfake.Clientset }

func (p typedNodeProvider) Client(string) (dynamic.Interface, error) {
	return dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()), nil
}

func (p typedNodeProvider) NodeClient(string) (kubernetes.Interface, error) {
	return p.core, nil
}

func TestCordonPatchesUnschedulableStrategically(t *testing.T) {
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-1"}}
	clientset := kubernetesfake.NewSimpleClientset(node)
	var patches []clienttesting.PatchAction
	clientset.PrependReactor("patch", "nodes", func(action clienttesting.Action) (bool, runtime.Object, error) {
		patch := action.(clienttesting.PatchAction)
		patches = append(patches, patch)
		return false, nil, nil
	})
	service := NewService(typedNodeProvider{core: clientset})

	result, err := service.Cordon(context.Background(), NodeCordonRequest{ContextID: "context", NodeName: "worker-1", Unschedulable: true})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Changed || !result.Unschedulable {
		t.Fatalf("cordon result = %#v", result)
	}
	if len(patches) != 1 {
		t.Fatalf("patches = %#v", patches)
	}
	if string(patches[0].GetPatch()) != `{"spec":{"unschedulable":true}}` {
		t.Fatalf("patch payload = %s", patches[0].GetPatch())
	}
	if patches[0].GetPatchType() != types.StrategicMergePatchType {
		t.Fatalf("patch type = %v", patches[0].GetPatchType())
	}
	updated, err := clientset.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Spec.Unschedulable {
		t.Fatal("node was not cordoned")
	}

	// Re-cordoning is a no-op report, not another write.
	repeat, err := service.Cordon(context.Background(), NodeCordonRequest{ContextID: "context", NodeName: "worker-1", Unschedulable: true})
	if err != nil {
		t.Fatal(err)
	}
	if repeat.Changed || !repeat.Unschedulable || len(patches) != 1 {
		t.Fatalf("repeat cordon = %#v patches=%d", repeat, len(patches))
	}

	uncordon, err := service.Cordon(context.Background(), NodeCordonRequest{ContextID: "context", NodeName: "worker-1", Unschedulable: false})
	if err != nil {
		t.Fatal(err)
	}
	if !uncordon.Changed || uncordon.Unschedulable || len(patches) != 2 {
		t.Fatalf("uncordon = %#v patches=%d", uncordon, len(patches))
	}
	if string(patches[1].GetPatch()) != `{"spec":{"unschedulable":false}}` {
		t.Fatalf("uncordon payload = %s", patches[1].GetPatch())
	}
}

func TestDrainCordonsFirstAndEvictsManagedPods(t *testing.T) {
	fixture := newDrainFixture(t)
	fixture.addPod(managedPod("apps", "web-1", "worker-1"))
	events := fixture.drain(NodeDrainOptions{IgnoreDaemonsets: true})

	fixture.assertNodeCordoned(t)
	if got := drainStatuses(events); strings.Join(got, ",") != "evicting,evicted" {
		t.Fatalf("pod statuses = %v", got)
	}
	summary := lastEvent(events)
	if summary.Type != "summary" || !summary.Complete || summary.Evicted != 1 || summary.Skipped != 0 || summary.Failed != 0 {
		t.Fatalf("summary = %#v", summary)
	}
	if summary.Total != 1 {
		t.Fatalf("summary total = %d", summary.Total)
	}
	// The eviction hit the eviction API, not a DELETE.
	if evictions := fixture.evictions(); len(evictions) != 1 {
		t.Fatalf("eviction actions = %#v", evictions)
	}
	if actions := fixture.actions("delete", "pods"); len(actions) != 0 {
		t.Fatalf("delete actions = %#v", actions)
	}
	// The pod list was scoped to this node's scheduler field.
	if selector := fixture.listFieldSelector(); selector != "spec.nodeName=worker-1" {
		t.Fatalf("list field selector = %q", selector)
	}
}

func TestDrainSkipsMirrorAndDaemonSetPods(t *testing.T) {
	fixture := newDrainFixture(t)
	mirror := managedPod("kube-system", "kube-apiserver-worker-1", "worker-1")
	mirror.Annotations = map[string]string{"kubernetes.io/config.mirror": "mirror-uid"}
	daemon := managedPod("kube-system", "fluentd-x7", "worker-1")
	daemon.OwnerReferences = []metav1.OwnerReference{ownerRef("DaemonSet", "fluentd", true)}
	fixture.addPod(mirror, daemon, managedPod("apps", "web-1", "worker-1"))

	events := fixture.drain(NodeDrainOptions{IgnoreDaemonsets: true})

	skipped := map[string]string{}
	for _, event := range events {
		if event.Type == "pod" && event.Status == "skipped" {
			skipped[event.Pod] = event.Reason
		}
	}
	if len(skipped) != 2 {
		t.Fatalf("skipped = %#v", skipped)
	}
	if !strings.Contains(skipped["kube-apiserver-worker-1"], "mirror") {
		t.Fatalf("mirror reason = %q", skipped["kube-apiserver-worker-1"])
	}
	if !strings.Contains(skipped["fluentd-x7"], "DaemonSet") {
		t.Fatalf("daemonset reason = %q", skipped["fluentd-x7"])
	}
	summary := lastEvent(events)
	if !summary.Complete || summary.Evicted != 1 || summary.Skipped != 2 || summary.Total != 3 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestDrainAbortsOnDaemonSetWithoutIgnore(t *testing.T) {
	fixture := newDrainFixture(t)
	daemon := managedPod("kube-system", "fluentd-x7", "worker-1")
	daemon.OwnerReferences = []metav1.OwnerReference{ownerRef("DaemonSet", "fluentd", true)}
	fixture.addPod(daemon, managedPod("apps", "web-1", "worker-1"))

	events := fixture.drain(NodeDrainOptions{})

	// kubectl refuses to drain past an unignored DaemonSet: nothing is evicted.
	if evictions := fixture.evictions(); len(evictions) != 0 {
		t.Fatalf("eviction actions = %#v", evictions)
	}
	summary := lastEvent(events)
	if summary.Complete || !strings.Contains(summary.Error, "DaemonSet") {
		t.Fatalf("summary = %#v", summary)
	}
	// Only the blocking DaemonSet pod is reported skipped; the managed pod
	// was never processed because the drain aborted before evicting.
	if summary.Skipped != 1 || summary.Total != 2 {
		t.Fatalf("summary = %#v", summary)
	}
	fixture.assertNodeCordoned(t)
}

func TestDrainForceEvictsUnmanagedPods(t *testing.T) {
	fixture := newDrainFixture(t)
	fixture.addPod(unmanagedPod("apps", "stray", "worker-1"))

	events := fixture.drain(NodeDrainOptions{})
	summary := lastEvent(events)
	if summary.Complete || !strings.Contains(summary.Error, "force") {
		t.Fatalf("unforced summary = %#v", summary)
	}
	if evictions := fixture.evictions(); len(evictions) != 0 {
		t.Fatalf("unforced evictions = %#v", evictions)
	}

	forced := newDrainFixture(t)
	forced.addPod(unmanagedPod("apps", "stray", "worker-1"))
	forcedEvents := forced.drain(NodeDrainOptions{Force: true})
	forcedSummary := lastEvent(forcedEvents)
	if !forcedSummary.Complete || forcedSummary.Evicted != 1 {
		t.Fatalf("forced summary = %#v", forcedSummary)
	}
}

func TestDrainAbortsOnEmptyDirWithoutOverride(t *testing.T) {
	fixture := newDrainFixture(t)
	local := managedPod("apps", "batchy", "worker-1")
	local.Spec.Volumes = []corev1.Volume{{Name: "scratch", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}}
	fixture.addPod(local, managedPod("apps", "web-1", "worker-1"))

	events := fixture.drain(NodeDrainOptions{IgnoreDaemonsets: true})
	summary := lastEvent(events)
	if summary.Complete || summary.Evicted != 0 || summary.Skipped != 1 || !strings.Contains(summary.Error, "emptyDir") {
		t.Fatalf("summary = %#v", summary)
	}
	if len(fixture.evictions()) != 0 || len(fixture.actions("delete", "pods")) != 0 {
		t.Fatal("emptyDir blocker must prevent every pod removal")
	}
	fixture.assertNodeCordoned(t)
	for _, event := range events {
		if event.Pod == "batchy" && event.Status == "skipped" && !strings.Contains(event.Reason, "emptyDir") {
			t.Fatalf("emptyDir reason = %q", event.Reason)
		}
	}

	override := newDrainFixture(t)
	localStill := managedPod("apps", "batchy", "worker-1")
	localStill.Spec.Volumes = []corev1.Volume{{Name: "scratch", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}}
	override.addPod(localStill)
	overrideEvents := override.drain(NodeDrainOptions{IgnoreDaemonsets: true, DeleteEmptyDirData: true})
	overrideSummary := lastEvent(overrideEvents)
	if !overrideSummary.Complete || overrideSummary.Evicted != 1 || overrideSummary.Skipped != 0 {
		t.Fatalf("override summary = %#v", overrideSummary)
	}
}

func TestDrainEvictionErrorPropagation(t *testing.T) {
	defer restoreDrainTiming(shrinkDrainTiming())

	// A PDB-blocked eviction exhausts its retries and is reported per pod;
	// the drain continues with the remaining pods.
	blocked := newDrainFixture(t)
	blocked.addPod(managedPod("apps", "guarded", "worker-1"), managedPod("apps", "free", "worker-1"))
	blocked.evictErrors = func(name string) error {
		if name == "guarded" {
			return apierrors.NewTooManyRequestsError("Cannot evict pod as it would violate the pod's disruption budget.")
		}
		return nil
	}
	events := blocked.drain(NodeDrainOptions{IgnoreDaemonsets: true})
	var guarded *NodeDrainEvent
	for index := range events {
		if events[index].Pod == "guarded" && events[index].Status == "failed" {
			guarded = &events[index]
		}
	}
	if guarded == nil || !strings.Contains(guarded.Message, "disruption budget") {
		t.Fatalf("guarded failure = %#v", guarded)
	}
	summary := lastEvent(events)
	if summary.Complete || summary.Failed != 1 || summary.Evicted != 1 {
		t.Fatalf("summary = %#v", summary)
	}

	// A final (non-retryable) eviction error surfaces immediately.
	forbidden := newDrainFixture(t)
	forbidden.addPod(managedPod("apps", "denied", "worker-1"))
	forbidden.evictErrors = func(string) error {
		return apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "denied", nil)
	}
	forbiddenEvents := forbidden.drain(NodeDrainOptions{IgnoreDaemonsets: true})
	forbiddenSummary := lastEvent(forbiddenEvents)
	if forbiddenSummary.Complete || forbiddenSummary.Failed != 1 || !strings.Contains(forbiddenEvents[len(forbiddenEvents)-2].Message, "denied") {
		t.Fatalf("forbidden summary = %#v events=%#v", forbiddenSummary, forbiddenEvents)
	}
}

func TestDrainDeletesTerminalAndDisableEvictionPods(t *testing.T) {
	fixture := newDrainFixture(t)
	terminal := unmanagedPod("apps", "done-job", "worker-1")
	terminal.Status.Phase = corev1.PodSucceeded
	fixture.addPod(terminal, managedPod("apps", "web-1", "worker-1"))

	events := fixture.drain(NodeDrainOptions{IgnoreDaemonsets: true, DisableEviction: true})

	if got := drainStatuses(events); strings.Join(got, ",") != "deleting,deleted,deleting,deleted" {
		t.Fatalf("pod statuses = %v", got)
	}
	if evictions := fixture.evictions(); len(evictions) != 0 {
		t.Fatalf("eviction actions = %#v", evictions)
	}
	if actions := fixture.actions("delete", "pods"); len(actions) != 2 {
		t.Fatalf("delete actions = %#v", actions)
	}
	summary := lastEvent(events)
	if !summary.Complete || summary.Evicted != 2 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestDrainTerminationWaitTimesOut(t *testing.T) {
	defer restoreDrainTiming(shrinkDrainTiming())
	fixture := newDrainFixture(t)
	// The eviction is accepted but the pod object never disappears, so the
	// bounded termination wait must fail the pod instead of hanging.
	fixture.stuckPods["stuck"] = true
	fixture.addPod(managedPod("apps", "stuck", "worker-1"))
	events := fixture.drain(NodeDrainOptions{IgnoreDaemonsets: true})
	summary := lastEvent(events)
	if summary.Complete || summary.Failed != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	for _, event := range events {
		if event.Pod == "stuck" && event.Status == "failed" && !strings.Contains(event.Message, "terminate") {
			t.Fatalf("stuck failure = %#v", event)
		}
	}
}

func TestDrainDoesNotRemoveSameNameReplacement(t *testing.T) {
	for _, mode := range []string{"eviction", "delete", "terminal"} {
		t.Run(mode, func(t *testing.T) {
			original := managedPod("apps", "database-0", "worker-1")
			original.UID = "original"
			if mode == "terminal" {
				original.Status.Phase = corev1.PodSucceeded
			}
			replacement := managedPod("apps", "database-0", "worker-2")
			replacement.UID = "replacement"
			client := kubernetesfake.NewSimpleClientset(&replacement)
			// Model a StatefulSet recreation between the drain's initial list
			// and its queued removal. The API rejects an old UID precondition.
			client.PrependReactor("*", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
				var options *metav1.DeleteOptions
				switch {
				case action.GetVerb() == "delete":
					value := action.(clienttesting.DeleteAction).GetDeleteOptions()
					options = &value
				case action.GetVerb() == "create" && action.GetSubresource() == "eviction":
					options = action.(clienttesting.CreateAction).GetObject().(*policyv1.Eviction).DeleteOptions
				default:
					return false, nil, nil
				}
				if options != nil && options.Preconditions != nil && options.Preconditions.UID != nil && *options.Preconditions.UID != replacement.UID {
					return true, nil, apierrors.NewConflict(schema.GroupResource{Resource: "pods"}, replacement.Name, fmt.Errorf("UID precondition failed"))
				}
				return true, nil, client.Tracker().Delete(podsGVR(), replacement.Namespace, replacement.Name)
			})
			err := removePod(context.Background(), client, original, NodeDrainOptions{DisableEviction: mode == "delete"})
			if !apierrors.IsConflict(err) {
				t.Fatalf("removing replaced pod returned %v, want UID conflict", err)
			}
			stored, err := client.CoreV1().Pods(replacement.Namespace).Get(context.Background(), replacement.Name, metav1.GetOptions{})
			if err != nil || stored.UID != replacement.UID || stored.Spec.NodeName != "worker-2" {
				t.Fatalf("replacement was affected: pod=%#v err=%v", stored, err)
			}
		})
	}
}

func TestDrainCompletesWhenRemovedPodIsRecreated(t *testing.T) {
	for _, disableEviction := range []bool{false, true} {
		t.Run(fmt.Sprintf("disableEviction=%t", disableEviction), func(t *testing.T) {
			original := managedPod("apps", "database-0", "worker-1")
			original.UID = "original"
			client := kubernetesfake.NewSimpleClientset(&original)
			client.PrependReactor("*", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
				if action.GetVerb() != "delete" && !(action.GetVerb() == "create" && action.GetSubresource() == "eviction") {
					return false, nil, nil
				}
				replacement := original.DeepCopy()
				replacement.UID = "replacement"
				replacement.Spec.NodeName = "worker-2"
				if err := client.Tracker().Update(podsGVR(), replacement, replacement.Namespace); err != nil {
					return true, nil, err
				}
				return true, replacement, nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			if err := removePod(ctx, client, original, NodeDrainOptions{DisableEviction: disableEviction}); err != nil {
				t.Fatalf("original UID is gone, but drain did not complete: %v", err)
			}
		})
	}
}

func TestDrainRemovesFinishedLocalStorageAndDaemonSetPods(t *testing.T) {
	for _, phase := range []corev1.PodPhase{corev1.PodSucceeded, corev1.PodFailed} {
		t.Run(string(phase), func(t *testing.T) {
			fixture := newDrainFixture(t)
			pod := managedPod("apps", "finished", "worker-1")
			pod.Status.Phase = phase
			pod.OwnerReferences = []metav1.OwnerReference{ownerRef("DaemonSet", "agent", true)}
			pod.Spec.Volumes = []corev1.Volume{{Name: "scratch", VolumeSource: corev1.VolumeSource{EmptyDir: &corev1.EmptyDirVolumeSource{}}}}
			fixture.addPod(pod)
			summary := lastEvent(fixture.drain(NodeDrainOptions{}))
			if !summary.Complete || summary.Evicted != 1 || len(fixture.actions("delete", "pods")) != 1 {
				t.Fatalf("finished pod should not need destructive overrides: %#v", summary)
			}
		})
	}
}

func TestPodsOnNodeFollowsPagination(t *testing.T) {
	client := kubernetesfake.NewSimpleClientset()
	pages := 0
	client.PrependReactor("list", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		options := action.(interface{ GetListOptions() metav1.ListOptions }).GetListOptions()
		if options.FieldSelector != "spec.nodeName=worker-1" || options.Limit != drainPodPageSize {
			t.Errorf("pagination lost node scope or page cap: %#v", options)
		}
		pages++
		if pages == 1 {
			if options.Continue != "" {
				t.Errorf("initial continuation = %q", options.Continue)
			}
			list := &corev1.PodList{ListMeta: metav1.ListMeta{Continue: "page-2"}}
			for index := 0; index < drainPodPageSize; index++ {
				list.Items = append(list.Items, managedPod("apps", fmt.Sprintf("web-%d", index), "worker-1"))
			}
			return true, list, nil
		}
		if pages != 2 || options.Continue != "page-2" {
			return true, nil, fmt.Errorf("unexpected pagination request %d: continue=%q", pages, options.Continue)
		}
		return true, &corev1.PodList{Items: []corev1.Pod{managedPod("apps", "last", "worker-1")}}, nil
	})
	pods, err := podsOnNode(context.Background(), client, "worker-1")
	if err != nil || len(pods) != drainPodPageSize+1 || pages != 2 {
		t.Fatalf("pods=%d pages=%d err=%v", len(pods), pages, err)
	}
}

// --- fixture ---

type drainFixture struct {
	t           *testing.T
	clientset   *kubernetesfake.Clientset
	service     *Service
	evictErrors func(podName string) error
	// stuckPods model pods whose eviction is accepted but which never
	// terminate: the reactor skips the tracker delete for them.
	stuckPods    map[string]bool
	fieldSel     string
	listActioned bool
}

func newDrainFixture(t *testing.T) *drainFixture {
	clientset := kubernetesfake.NewSimpleClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-1"}})
	fixture := &drainFixture{t: t, clientset: clientset, stuckPods: map[string]bool{}}
	clientset.PrependReactor("list", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		list := action.(clienttesting.ListAction)
		fixture.fieldSel = list.GetListRestrictions().Fields.String()
		fixture.listActioned = true
		return false, nil, nil
	})
	clientset.PrependReactor("create", "pods", func(action clienttesting.Action) (bool, runtime.Object, error) {
		create := action.(clienttesting.CreateAction)
		if create.GetSubresource() != "eviction" {
			return false, nil, nil
		}
		eviction := create.GetObject().(*policyv1.Eviction)
		if fixture.evictErrors != nil {
			if err := fixture.evictErrors(eviction.Name); err != nil {
				return true, nil, err
			}
		}
		if fixture.stuckPods[eviction.Name] {
			return true, eviction, nil
		}
		// Model the API server: an accepted eviction deletes the pod.
		if err := clientset.Tracker().Delete(podsGVR(), eviction.Namespace, eviction.Name); err != nil {
			return true, nil, err
		}
		return true, eviction, nil
	})
	fixture.service = NewService(typedNodeProvider{core: clientset})
	return fixture
}

func (f *drainFixture) addPod(pods ...corev1.Pod) {
	for _, pod := range pods {
		if _, err := f.clientset.CoreV1().Pods(pod.Namespace).Create(context.Background(), &pod, metav1.CreateOptions{}); err != nil {
			f.t.Fatal(err)
		}
	}
}

func (f *drainFixture) drain(options NodeDrainOptions) []NodeDrainEvent {
	events, err := f.service.StreamDrain(context.Background(), NodeDrainRequest{ContextID: "context", NodeName: "worker-1", Options: options})
	if err != nil {
		f.t.Fatal(err)
	}
	var collected []NodeDrainEvent
	for event := range events {
		collected = append(collected, event)
	}
	if len(collected) == 0 {
		f.t.Fatal("drain produced no events")
	}
	if collected[0].Type != "cordon" || !collected[0].Unschedulable {
		f.t.Fatalf("first event = %#v", collected[0])
	}
	return collected
}

// evictions returns only eviction-subresource creates; plain pod creates
// from fixture setup are excluded.
func (f *drainFixture) evictions() []clienttesting.Action {
	var matched []clienttesting.Action
	for _, action := range f.clientset.Actions() {
		if action.GetVerb() == "create" && action.GetResource().Resource == "pods" {
			if sub, ok := action.(interface{ GetSubresource() string }); ok && sub.GetSubresource() == "eviction" {
				matched = append(matched, action)
			}
		}
	}
	return matched
}

func (f *drainFixture) actions(verb, resource string) []clienttesting.Action {
	var matched []clienttesting.Action
	for _, action := range f.clientset.Actions() {
		if action.GetVerb() == verb && action.GetResource().Resource == resource {
			matched = append(matched, action)
		}
	}
	return matched
}

func (f *drainFixture) listFieldSelector() string {
	if !f.listActioned {
		f.t.Fatal("pods were never listed")
	}
	return f.fieldSel
}

func (f *drainFixture) assertNodeCordoned(t *testing.T) {
	t.Helper()
	node, err := f.clientset.CoreV1().Nodes().Get(context.Background(), "worker-1", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !node.Spec.Unschedulable {
		t.Fatal("node was not cordoned before draining")
	}
}

func drainStatuses(events []NodeDrainEvent) []string {
	var statuses []string
	for _, event := range events {
		if event.Type == "pod" {
			statuses = append(statuses, event.Status)
		}
	}
	return statuses
}

func lastEvent(events []NodeDrainEvent) NodeDrainEvent {
	return events[len(events)-1]
}

// --- pod builders ---

func managedPod(namespace, name, nodeName string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       namespace,
			OwnerReferences: []metav1.OwnerReference{ownerRef("ReplicaSet", name+"-abc123", true)},
		},
		Spec:   corev1.PodSpec{NodeName: nodeName},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
}

func unmanagedPod(namespace, name, nodeName string) corev1.Pod {
	return corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       corev1.PodSpec{NodeName: nodeName},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
}

func ownerRef(kind, name string, controller bool) metav1.OwnerReference {
	return metav1.OwnerReference{APIVersion: "apps/v1", Kind: kind, Name: name, Controller: &controller}
}

func podsGVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{Version: "v1", Resource: "pods"}
}

// --- timing knobs ---

func shrinkDrainTiming() (backoff, wait, poll time.Duration) {
	backoff, wait, poll = drainEvictionBackoff, drainTerminationWait, drainPollInterval
	drainEvictionBackoff = time.Millisecond
	drainTerminationWait = 10 * time.Millisecond
	drainPollInterval = time.Millisecond
	return
}

func restoreDrainTiming(backoff, wait, poll time.Duration) {
	drainEvictionBackoff = backoff
	drainTerminationWait = wait
	drainPollInterval = poll
}
