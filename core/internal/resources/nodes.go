// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// Node operations: cordon/uncordon via spec.unschedulable, and an
// eviction-based drain modeled on kubectl drain semantics — the node is
// cordoned first, pods are classified against the same blockers kubectl
// refuses to cross (mirror pods, DaemonSets, local storage, unmanaged pods),
// and the eviction API enforces PodDisruptionBudgets server-side.

// NodeClientProvider supplies the typed core client that node operations run
// against. It is implemented by the session manager and optional like the
// log/exec providers, so tests inject a fake clientset.
type NodeClientProvider interface {
	NodeClient(contextID string) (kubernetes.Interface, error)
}

const (
	// drainPodPageSize bounds each pod list request; the loop walks continue
	// tokens so a fully loaded node still drains in a handful of calls.
	drainPodPageSize = 500
	drainMaxPodPages = 40
	// drainEvictionAttempts caps PDB-blocked eviction retries per pod before
	// the pod is reported failed and the drain moves on.
	drainEvictionAttempts = 5
	// drainEventBuffer keeps a drain streaming while the consumer renders.
	drainEventBuffer = 64
)

// Timing knobs are vars so tests can shrink them to milliseconds.
var (
	// drainEvictionBackoff doubles per retry: 1s, 2s, 4s, 8s.
	drainEvictionBackoff = time.Second
	// drainTerminationWait bounds how long a single accepted eviction waits
	// for the pod object to disappear before being reported failed.
	drainTerminationWait = 60 * time.Second
	// drainPollInterval is the pod-termination poll cadence.
	drainPollInterval = time.Second
)

func (s *Service) nodeClient(contextID string) (kubernetes.Interface, error) {
	provider, ok := s.clients.(NodeClientProvider)
	if !ok {
		return nil, invalid("node client provider is unavailable")
	}
	return provider.NodeClient(contextID)
}

// Cordon flips spec.unschedulable through a strategic merge patch. The
// response reports whether the node actually changed, mirroring how the
// mutation endpoint reports no-op writes.
func (s *Service) Cordon(ctx context.Context, request NodeCordonRequest) (NodeCordonResponse, error) {
	if strings.TrimSpace(request.ContextID) == "" || strings.TrimSpace(request.NodeName) == "" {
		return NodeCordonResponse{}, invalid("contextId and nodeName are required")
	}
	client, err := s.nodeClient(request.ContextID)
	if err != nil {
		return NodeCordonResponse{}, err
	}
	changed, unschedulable, err := patchUnschedulable(ctx, client, request.NodeName, request.Unschedulable)
	if err != nil {
		return NodeCordonResponse{}, err
	}
	return NodeCordonResponse{NodeName: request.NodeName, Unschedulable: unschedulable, Changed: changed}, nil
}

// patchUnschedulable reads the node first so an already-cordoned node is a
// no-op instead of a resourceVersion-bumping write.
func patchUnschedulable(ctx context.Context, client kubernetes.Interface, nodeName string, unschedulable bool) (changed, current bool, err error) {
	node, err := client.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		return false, false, fmt.Errorf("get node %q: %w", nodeName, err)
	}
	if node.Spec.Unschedulable == unschedulable {
		return false, node.Spec.Unschedulable, nil
	}
	patch := []byte(fmt.Sprintf(`{"spec":{"unschedulable":%t}}`, unschedulable))
	updated, err := client.CoreV1().Nodes().Patch(ctx, nodeName, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	if err != nil {
		return false, node.Spec.Unschedulable, fmt.Errorf("patch node %q: %w", nodeName, err)
	}
	return true, updated.Spec.Unschedulable, nil
}

// StreamDrain cordons the node, then removes its pods, publishing progress as
// ordered events on the returned channel. The channel closes after the
// summary event; cancelling the context aborts the drain and closes it too.
// Like Watch, validation happens synchronously so callers get request errors
// before committing to the stream.
func (s *Service) StreamDrain(ctx context.Context, request NodeDrainRequest) (<-chan NodeDrainEvent, error) {
	if strings.TrimSpace(request.ContextID) == "" || strings.TrimSpace(request.NodeName) == "" {
		return nil, invalid("contextId and nodeName are required")
	}
	client, err := s.nodeClient(request.ContextID)
	if err != nil {
		return nil, err
	}
	events := make(chan NodeDrainEvent, drainEventBuffer)
	go func() {
		defer close(events)
		s.drain(ctx, client, request, events)
	}()
	return events, nil
}

func (s *Service) drain(ctx context.Context, client kubernetes.Interface, request NodeDrainRequest, events chan<- NodeDrainEvent) {
	node := request.NodeName
	// Draining implies cordoning first (kubectl parity): no replacement pod
	// may land while the old ones are being removed.
	changed, _, err := patchUnschedulable(ctx, client, node, true)
	if err != nil {
		emitDrainEvent(ctx, events, NodeDrainEvent{Type: "summary", Node: node, Complete: false, Error: err.Error()})
		return
	}
	if !emitDrainEvent(ctx, events, NodeDrainEvent{Type: "cordon", Node: node, Unschedulable: true, Changed: changed}) {
		return
	}

	pods, err := podsOnNode(ctx, client, node)
	if err != nil {
		emitDrainEvent(ctx, events, NodeDrainEvent{Type: "summary", Node: node, Complete: false, Error: err.Error()})
		return
	}

	// kubectl classifies every pod before deleting anything: a blocking pod
	// (unignored DaemonSet, unmanaged pod without force) aborts the drain
	// while the node is still cordoned rather than half-emptying it.
	evictable := make([]corev1.Pod, 0, len(pods))
	skipped := 0
	blocked := ""
	for _, pod := range pods {
		plan := classifyDrainPod(&pod, request.Options)
		switch plan.action {
		case "evict", "delete":
			evictable = append(evictable, pod)
		default:
			skipped++
			if !emitDrainEvent(ctx, events, NodeDrainEvent{
				Type: "pod", Node: node, Namespace: pod.Namespace, Pod: pod.Name,
				Status: "skipped", Reason: plan.reason,
			}) {
				return
			}
			if plan.action == "abort" && blocked == "" {
				blocked = plan.reason
			}
		}
	}
	if blocked != "" {
		emitDrainEvent(ctx, events, NodeDrainEvent{
			Type: "summary", Node: node, Total: len(pods), Skipped: skipped,
			Complete: false, Error: blocked,
		})
		return
	}

	evicted, failed := 0, 0
	for _, pod := range evictable {
		// Terminal pods cannot pass the eviction API, and DisableEviction opts
		// out of PDBs entirely; both go through DELETE.
		done, doing := "evicted", "evicting"
		if request.Options.DisableEviction || terminalPod(&pod) {
			done, doing = "deleted", "deleting"
		}
		if !emitDrainEvent(ctx, events, NodeDrainEvent{
			Type: "pod", Node: node, Namespace: pod.Namespace, Pod: pod.Name, Status: doing,
		}) {
			return
		}
		err := removePod(ctx, client, pod, request.Options)
		switch {
		case err == nil:
			evicted++
			if !emitDrainEvent(ctx, events, NodeDrainEvent{
				Type: "pod", Node: node, Namespace: pod.Namespace, Pod: pod.Name, Status: done,
			}) {
				return
			}
		case ctx.Err() != nil:
			emitDrainEvent(ctx, events, NodeDrainEvent{
				Type: "summary", Node: node, Total: len(pods), Evicted: evicted, Skipped: skipped, Failed: failed,
				Complete: false, Error: "drain cancelled",
			})
			return
		default:
			failed++
			if !emitDrainEvent(ctx, events, NodeDrainEvent{
				Type: "pod", Node: node, Namespace: pod.Namespace, Pod: pod.Name,
				Status: "failed", Message: err.Error(),
			}) {
				return
			}
		}
	}

	emitDrainEvent(ctx, events, NodeDrainEvent{
		Type: "summary", Node: node, Total: len(pods), Evicted: evicted, Skipped: skipped, Failed: failed,
		Complete: failed == 0,
	})
}

// removePod evicts (or, with DisableEviction, deletes) one pod and waits for
// the object to disappear. Evictions retry PDB-blocked (429) and timeout
// responses with capped backoff, then surface the last error.
func removePod(ctx context.Context, client kubernetes.Interface, pod corev1.Pod, options NodeDrainOptions) error {
	if options.DisableEviction || terminalPod(&pod) {
		// Terminal pods cannot pass the eviction API, so they take the DELETE
		// path alongside DisableEviction requests.
		if err := deletePod(ctx, client, pod); err != nil {
			return err
		}
	} else {
		if err := evictPod(ctx, client, pod); err != nil {
			return err
		}
	}
	return waitForPodGone(ctx, client, pod)
}

func evictPod(ctx context.Context, client kubernetes.Interface, pod corev1.Pod) error {
	eviction := &policyv1.Eviction{
		ObjectMeta: metav1.ObjectMeta{Name: pod.Name, Namespace: pod.Namespace},
		DeleteOptions: &metav1.DeleteOptions{
			Preconditions: &metav1.Preconditions{UID: &pod.UID},
		},
	}
	backoff := drainEvictionBackoff
	var lastErr error
	for attempt := 0; attempt < drainEvictionAttempts; attempt++ {
		if attempt > 0 && !sleepContext(ctx, backoff) {
			return ctx.Err()
		}
		err := client.PolicyV1().Evictions(pod.Namespace).Evict(ctx, eviction)
		if err == nil || apierrors.IsNotFound(err) {
			return nil
		}
		lastErr = err
		// The eviction API answers a blocked PodDisruptionBudget with 429;
		// server timeouts are equally transient. Everything else is final.
		if !apierrors.IsTooManyRequests(err) && !apierrors.IsServerTimeout(err) && !apierrors.IsTimeout(err) {
			return err
		}
		backoff *= 2
	}
	return fmt.Errorf("eviction still blocked after %d attempts: %w", drainEvictionAttempts, lastErr)
}

func deletePod(ctx context.Context, client kubernetes.Interface, pod corev1.Pod) error {
	// A queued pod may have been replaced on another node since the list.
	// Never apply this drain's deletion to a new object with the same name.
	err := client.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{
		Preconditions: &metav1.Preconditions{UID: &pod.UID},
	})
	if err != nil && !apierrors.IsNotFound(err) {
		return err
	}
	return nil
}

func waitForPodGone(ctx context.Context, client kubernetes.Interface, pod corev1.Pod) error {
	deadline := time.Now().Add(drainTerminationWait)
	for {
		current, err := client.CoreV1().Pods(pod.Namespace).Get(ctx, pod.Name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if current.UID != pod.UID {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("pod did not terminate within %s", drainTerminationWait)
		}
		if !sleepContext(ctx, drainPollInterval) {
			return ctx.Err()
		}
	}
}

// podsOnNode lists every pod scheduled on the node across all namespaces.
func podsOnNode(ctx context.Context, client kubernetes.Interface, nodeName string) ([]corev1.Pod, error) {
	var pods []corev1.Pod
	continueToken := ""
	for page := 0; page < drainMaxPodPages; page++ {
		list, err := client.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{
			FieldSelector: "spec.nodeName=" + nodeName,
			Limit:         drainPodPageSize,
			Continue:      continueToken,
		})
		if err != nil {
			return nil, fmt.Errorf("list pods on node %q: %w", nodeName, err)
		}
		pods = append(pods, list.Items...)
		if list.Continue == "" {
			return pods, nil
		}
		continueToken = list.Continue
	}
	return nil, fmt.Errorf("node %q exceeded %d pages of pods", nodeName, drainMaxPodPages)
}

type drainPlan struct {
	action string // "evict" | "delete" | "skip" | "abort"
	reason string
}

// mirrorPodAnnotation marks static pods the kubelet manages directly; kubectl
// drain always skips them.
const mirrorPodAnnotation = "kubernetes.io/config.mirror"

// classifyDrainPod applies the kubectl drain filters in kubectl's order:
// mirror pods, terminal pods, DaemonSet ownership, local storage, then
// controller ownership. Finished pods can be removed without data-loss flags.
func classifyDrainPod(pod *corev1.Pod, options NodeDrainOptions) drainPlan {
	if _, mirror := pod.Annotations[mirrorPodAnnotation]; mirror {
		return drainPlan{action: "skip", reason: "mirror pod managed directly on the node"}
	}
	if terminalPod(pod) {
		return drainPlan{action: "delete", reason: "terminal pod"}
	}
	if daemonSetOwned(pod) {
		if !options.IgnoreDaemonsets {
			return drainPlan{action: "abort", reason: "DaemonSet-managed pods must be ignored to drain this node (enable ignoreDaemonsets)"}
		}
		return drainPlan{action: "skip", reason: "DaemonSet-managed"}
	}
	if hasEmptyDir(pod) && !options.DeleteEmptyDirData {
		return drainPlan{action: "abort", reason: "pods use emptyDir local storage (enable deleteEmptyDirData to discard it)"}
	}
	if !controllerOwned(pod) && !options.Force {
		return drainPlan{action: "abort", reason: "pods not managed by a controller must be forced (enable force)"}
	}
	return drainPlan{action: "evict"}
}

func daemonSetOwned(pod *corev1.Pod) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "DaemonSet" && owner.Controller != nil && *owner.Controller {
			return true
		}
	}
	return false
}

func controllerOwned(pod *corev1.Pod) bool {
	for _, owner := range pod.OwnerReferences {
		if owner.Controller != nil && *owner.Controller {
			return true
		}
	}
	return false
}

func terminalPod(pod *corev1.Pod) bool {
	return pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed
}

func hasEmptyDir(pod *corev1.Pod) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.EmptyDir != nil {
			return true
		}
	}
	return false
}

func emitDrainEvent(ctx context.Context, events chan<- NodeDrainEvent, event NodeDrainEvent) bool {
	select {
	case <-ctx.Done():
		return false
	case events <- event:
		return true
	}
}

// sleepContext waits for the duration or until the context ends; it reports
// whether the full duration elapsed.
func sleepContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
