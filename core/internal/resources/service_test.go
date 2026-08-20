package resources

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"
)

type fakeProvider struct {
	client     dynamic.Interface
	logs       string
	execStdout string
	execStderr string
}

func (f fakeProvider) Client(contextID string) (dynamic.Interface, error) {
	return f.client, nil
}

func (f fakeProvider) PodLogs(context.Context, string, string, string, string, int64, bool, bool) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader(f.logs)), nil
}

func (f fakeProvider) PodLogsFollow(context.Context, string, string, string, string, int64, bool, bool) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader(f.logs)), nil
}

func (f fakeProvider) PodExec(context.Context, string, string, string, string, []string) (string, string, error) {
	return f.execStdout, f.execStderr, nil
}

func TestServiceListPassesPaginationSelectorsAndProjectsDeployment(t *testing.T) {
	deployment := testObject("apps/v1", "Deployment", "demo", "apps")
	deployment.SetUID("uid-1")
	deployment.SetResourceVersion("42")
	deployment.SetLabels(map[string]string{"app": "demo"})
	deployment.Object["spec"] = map[string]any{
		"replicas": int64(3),
		"template": map[string]any{"spec": map[string]any{"containers": []any{
			map[string]any{"name": "app", "image": "example/app:v1"},
		}}},
	}
	deployment.Object["status"] = map[string]any{
		"readyReplicas": int64(2), "availableReplicas": int64(2), "updatedReplicas": int64(3),
	}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), deployment)
	client.PrependReactor("list", "deployments", func(action clienttesting.Action) (bool, runtime.Object, error) {
		listAction := action.(clienttesting.ListAction)
		restrictions := listAction.GetListRestrictions()
		if restrictions.Labels.String() != "app=demo" || restrictions.Fields.String() != "metadata.name=demo" {
			t.Fatalf("restrictions = %#v", restrictions)
		}
		if listAction.GetNamespace() != "apps" {
			t.Fatalf("namespace = %q", listAction.GetNamespace())
		}
		list := &unstructured.UnstructuredList{Items: []unstructured.Unstructured{*deployment.DeepCopy()}}
		list.SetGroupVersionKind(schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "DeploymentList"})
		list.SetContinue("next-page")
		list.SetResourceVersion("84")
		return true, list, nil
	})

	result, err := NewService(fakeProvider{client: client}).List(context.Background(), ListRequest{
		ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespace: "apps", Limit: 20, ContinueToken: "previous-page",
		LabelSelector: "app=demo", FieldSelector: "metadata.name=demo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.ContinueToken != "next-page" || result.ResourceVersion != "84" || len(result.Items) != 1 {
		t.Fatalf("result = %#v", result)
	}
	row := result.Items[0]
	if row.UID != "uid-1" || row.Name != "demo" || row.Namespace != "apps" || row.Status != "Progressing" {
		t.Fatalf("row = %#v", row)
	}
	if row.Desired == nil || *row.Desired != 3 || row.Ready == nil || *row.Ready != 2 || len(row.Images) != 1 {
		t.Fatalf("deployment projection = %#v", row)
	}
}

func TestServiceListSendsPaginationToKubernetesAPI(t *testing.T) {
	var query url.Values
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		query = request.URL.Query()
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"apiVersion": "apps/v1",
			"kind":       "DeploymentList",
			"metadata": map[string]any{
				"continue":        "next-token",
				"resourceVersion": "91",
			},
			"items": []any{},
		})
	}))
	defer server.Close()
	client, err := dynamic.NewForConfig(&rest.Config{Host: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewService(fakeProvider{client: client}).List(context.Background(), ListRequest{
		ContextID:     "context",
		GVR:           GVR{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespace:     "apps",
		Limit:         25,
		ContinueToken: "current-token",
		LabelSelector: "app=demo",
		FieldSelector: "metadata.name=demo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if query.Get("limit") != "25" || query.Get("continue") != "current-token" ||
		query.Get("labelSelector") != "app=demo" || query.Get("fieldSelector") != "metadata.name=demo" {
		t.Fatalf("query = %v", query)
	}
	if result.ContinueToken != "next-token" || result.ResourceVersion != "91" {
		t.Fatalf("result = %#v", result)
	}
}

func TestServiceListUsesClusterScopeForNamespaces(t *testing.T) {
	namespace := testObject("v1", "Namespace", "default", "")
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), namespace)
	result, err := NewService(fakeProvider{client: client}).List(context.Background(), ListRequest{
		ContextID: "context", GVR: GVR{Version: "v1", Resource: "namespaces"}, Namespace: "ignored",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "default" {
		t.Fatalf("result = %#v", result)
	}
}

func TestServiceGetReturnsSanitizedYAML(t *testing.T) {
	configMap := testObject("v1", "ConfigMap", "settings", "apps")
	configMap.SetManagedFields([]metav1.ManagedFieldsEntry{{Manager: "kubectl"}})
	configMap.SetAnnotations(map[string]string{
		"kubectl.kubernetes.io/last-applied-configuration": `{"secret":"remove"}`,
		"keep": "yes",
	})
	configMap.Object["data"] = map[string]any{"z": "last", "a": "first"}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), configMap)
	result, err := NewService(fakeProvider{client: client}).Get(context.Background(), GetRequest{
		ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Name: "settings",
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(result.YAML, "managedFields") || strings.Contains(result.YAML, "last-applied") || strings.Contains(result.YAML, "remove") {
		t.Fatalf("yaml was not sanitized:\n%s", result.YAML)
	}
	if !strings.Contains(result.YAML, "keep: \"yes\"") || !strings.Contains(result.YAML, "a: first") {
		t.Fatalf("yaml missing retained data:\n%s", result.YAML)
	}
	if strings.Join(result.Resource.DataKeys, ",") != "a,z" {
		t.Fatalf("data keys = %#v", result.Resource.DataKeys)
	}
}

func TestServiceValidation(t *testing.T) {
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme())})
	for _, request := range []ListRequest{
		{ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Limit: maxPageSize + 1},
		{ContextID: "context", GVR: GVR{Version: "v1", Resource: "widgets"}},
	} {
		if _, err := service.List(context.Background(), request); err == nil {
			t.Fatalf("request %#v unexpectedly succeeded", request)
		}
	}
}

func TestServiceGetNeverReturnsSecretValues(t *testing.T) {
	secret := testObject("v1", "Secret", "credentials", "apps")
	secret.Object["type"] = "Opaque"
	secret.Object["data"] = map[string]any{"password": "c2VjcmV0LXZhbHVl"}
	secret.Object["stringData"] = map[string]any{"token": "plain-secret-value"}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), secret)
	result, err := NewService(fakeProvider{client: client}).Get(context.Background(), GetRequest{
		ContextID: "context", GVR: GVR{Version: "v1", Resource: "secrets"}, Namespace: "apps", Name: "credentials",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"c2VjcmV0LXZhbHVl", "plain-secret-value"} {
		if strings.Contains(result.YAML, forbidden) {
			t.Fatalf("secret YAML leaked %q:\n%s", forbidden, result.YAML)
		}
	}
	// Keys stay visible with masked values so the view shows the secret's shape.
	if !strings.Contains(result.YAML, "password: '[redacted]'") && !strings.Contains(result.YAML, "password: \"[redacted]\"") && !strings.Contains(result.YAML, "password: [redacted]") {
		t.Fatalf("secret keys were not preserved with a mask:\n%s", result.YAML)
	}
	if strings.Join(result.Resource.DataKeys, ",") != "password,token" || result.Resource.Type != "Opaque" {
		t.Fatalf("secret projection = %#v", result.Resource)
	}
}

func TestResourceCatalogScopeAndKinds(t *testing.T) {
	tests := []struct {
		gvr        GVR
		kind       string
		namespaced bool
	}{
		{GVR{Group: "apps", Version: "v1", Resource: "statefulsets"}, "StatefulSet", true},
		{GVR{Group: "apps", Version: "v1", Resource: "daemonsets"}, "DaemonSet", true},
		{GVR{Version: "v1", Resource: "services"}, "Service", true},
		{GVR{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, "Ingress", true},
		{GVR{Version: "v1", Resource: "secrets"}, "Secret", true},
		{GVR{Version: "v1", Resource: "nodes"}, "Node", false},
		{GVR{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, "Role", true},
		{GVR{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, "ClusterRole", false},
		{GVR{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, "RoleBinding", true},
		{GVR{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, "ClusterRoleBinding", false},
		{GVR{Group: "batch", Version: "v1", Resource: "jobs"}, "Job", true},
		{GVR{Group: "batch", Version: "v1", Resource: "cronjobs"}, "CronJob", true},
		{GVR{Version: "v1", Resource: "serviceaccounts"}, "ServiceAccount", true},
		{GVR{Version: "v1", Resource: "persistentvolumeclaims"}, "PersistentVolumeClaim", true},
		{GVR{Version: "v1", Resource: "persistentvolumes"}, "PersistentVolume", false},
		{GVR{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, "NetworkPolicy", true},
		{GVR{Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"}, "StorageClass", false},
	}
	for _, test := range tests {
		_, definition, err := validateGVR(test.gvr)
		if err != nil {
			t.Fatalf("%#v: %v", test.gvr, err)
		}
		if definition.Kind != test.kind || definition.Namespaced != test.namespaced {
			t.Fatalf("%#v definition = %#v", test.gvr, definition)
		}
	}
}

func TestMutateRestartAndResourceVersionConflict(t *testing.T) {
	object := testObject("apps/v1", "Deployment", "web", "apps")
	object.SetResourceVersion("7")
	object.Object["spec"] = map[string]any{"template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "app", "image": "old:1"}}}}}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), object)
	service := NewService(fakeProvider{client: client})
	request := MutationRequest{ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Namespace: "apps", Name: "web", Operation: "restart", ResourceVersion: "7"}
	result, err := service.Mutate(context.Background(), request)
	if err != nil || !result.Changed {
		t.Fatalf("restart result=%#v err=%v", result, err)
	}
	updated, err := client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}).Namespace("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	annotations, found, err := unstructured.NestedStringMap(updated.Object, "spec", "template", "metadata", "annotations")
	if err != nil || !found || annotations["kubectl.kubernetes.io/restartedAt"] == "" {
		t.Fatalf("pod template restart annotation was not written: found=%v annotations=%#v err=%v", found, annotations, err)
	}
	if updated.GetAnnotations()["kubectl.kubernetes.io/restartedAt"] != "" {
		t.Fatal("restart annotation was incorrectly written to workload metadata")
	}
	replicas := int64(2)
	_, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: request.GVR, Namespace: "apps", Name: "web", Operation: "scale", Replicas: &replicas, ResourceVersion: "stale"})
	if err == nil || !strings.Contains(err.Error(), "resource version conflict") {
		t.Fatalf("stale mutation error=%v", err)
	}
}

func TestMutationOperationResourceMatrix(t *testing.T) {
	for _, test := range []struct{ resource, operation string }{
		{"daemonsets", "scale"}, {"configmaps", "scale"}, {"configmaps", "restart"},
		{"deployments", "unknown"},
	} {
		if err := validateMutationOperation(test.resource, test.operation); err == nil {
			t.Fatalf("%s %s was accepted", test.operation, test.resource)
		}
	}
	for _, test := range []struct{ resource, operation string }{
		{"deployments", "scale"}, {"statefulsets", "scale"}, {"daemonsets", "restart"},
		{"daemonsets", "image"}, {"configmaps", "yaml"}, {"deployments", "yaml"},
		{"configmaps", "create"}, {"deployments", "delete"},
	} {
		if err := validateMutationOperation(test.resource, test.operation); err != nil {
			t.Fatalf("%s %s was rejected: %v", test.operation, test.resource, err)
		}
	}
}

func TestMutateDryRunScaleAndImageDoesNotPersist(t *testing.T) {
	object := testObject("apps/v1", "Deployment", "web", "apps")
	object.Object["spec"] = map[string]any{
		"replicas": int64(1),
		"template": map[string]any{"spec": map[string]any{"containers": []any{map[string]any{"name": "app", "image": "old:1"}}}},
	}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), object)
	client.PrependReactor("update", "deployments", func(action clienttesting.Action) (bool, runtime.Object, error) {
		update := action.(clienttesting.UpdateAction)
		if len(update.GetSubresource()) != 0 {
			return false, nil, nil
		}
		if options, ok := update.(interface{ GetUpdateOptions() metav1.UpdateOptions }); ok && len(options.GetUpdateOptions().DryRun) == 1 {
			return true, update.GetObject(), nil
		}
		return false, nil, nil
	})
	service := NewService(fakeProvider{client: client})
	replicas := int64(3)
	result, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Namespace: "apps", Name: "web", Operation: "scale", Replicas: &replicas, DryRun: true})
	if err != nil || !result.DryRun || !result.Changed || !strings.Contains(result.YAML, "replicas: 3") {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	current, err := client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}).Namespace("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	value, _, _ := unstructured.NestedInt64(current.Object, "spec", "replicas")
	if value != 1 {
		t.Fatalf("dry-run persisted replicas=%d", value)
	}
	_, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Namespace: "apps", Name: "web", Operation: "image", Image: "new:2", Container: "app"})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}).Namespace("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	containers, _, _ := unstructured.NestedSlice(updated.Object, "spec", "template", "spec", "containers")
	if containers[0].(map[string]any)["image"] != "new:2" {
		t.Fatalf("image mutation=%#v", containers)
	}
}

func TestMutateConfigMapYAMLAndSecretMutationDisabled(t *testing.T) {
	configMap := testObject("v1", "ConfigMap", "settings", "apps")
	configMap.Object["data"] = map[string]any{"mode": "old"}
	secret := testObject("v1", "Secret", "credentials", "apps")
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), configMap, secret)
	service := NewService(fakeProvider{client: client})
	yamlText := "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\ndata:\n  mode: new\n  feature: enabled\n"
	result, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Name: "settings", Operation: "yaml", YAML: yamlText})
	if err != nil || !result.Changed || !strings.Contains(result.YAML, "feature: enabled") {
		t.Fatalf("configmap result=%#v err=%v", result, err)
	}
	updated, err := client.Resource(schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}).Namespace("apps").Get(context.Background(), "settings", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	data, _, _ := unstructured.NestedStringMap(updated.Object, "data")
	if data["mode"] != "new" || data["feature"] != "enabled" {
		t.Fatalf("configmap data=%#v", data)
	}
	renamed := strings.Replace(yamlText, "name: settings", "name: other", 1)
	_, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Name: "settings", Operation: "yaml", YAML: renamed})
	if err == nil || !strings.Contains(err.Error(), "must stay") {
		t.Fatalf("rename attempt err=%v", err)
	}
	_, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "secrets"}, Namespace: "apps", Name: "credentials", Operation: "yaml", YAML: yamlText})
	if err == nil || !strings.Contains(err.Error(), "Secret") {
		t.Fatalf("secret mutation err=%v", err)
	}
}

func TestLogsAreBoundedAndValidateScope(t *testing.T) {
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), logs: strings.Repeat("line\n", 4)})
	result, err := service.Logs(context.Background(), LogsRequest{ContextID: "context", Namespace: "apps", Name: "web", TailLines: 4})
	if err != nil || result.Text != strings.Repeat("line\n", 4) || result.Truncated {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if _, err := service.Logs(context.Background(), LogsRequest{ContextID: "context", Name: "web"}); err == nil {
		t.Fatal("missing namespace was accepted")
	}
}

func TestLogs100kFixtureIsCappedWithoutLargeAllocation(t *testing.T) {
	fixture := strings.Repeat("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n", 100_000)
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), logs: fixture})
	started := time.Now()
	result, err := service.Logs(context.Background(), LogsRequest{ContextID: "context", Namespace: "apps", Name: "web", TailLines: 100_000})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Truncated || len(result.Text) != 4<<20 {
		t.Fatalf("result length=%d truncated=%v", len(result.Text), result.Truncated)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("100k log fixture took %s", elapsed)
	}
}

func BenchmarkLogs100kFixture(b *testing.B) {
	fixture := strings.Repeat("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n", 100_000)
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), logs: fixture})
	request := LogsRequest{ContextID: "context", Namespace: "apps", Name: "web", TailLines: 100_000}
	b.SetBytes(int64(len(fixture)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result, err := service.Logs(context.Background(), request)
		if err != nil || !result.Truncated || len(result.Text) != 4<<20 {
			b.Fatalf("result length=%d truncated=%v err=%v", len(result.Text), result.Truncated, err)
		}
	}
}

func TestExecValidatesArgvAndCapsOutput(t *testing.T) {
	service := NewService(fakeProvider{client: fake.NewSimpleDynamicClient(runtime.NewScheme()), execStdout: "ok", execStderr: "warn"})
	result, err := service.Exec(context.Background(), ExecRequest{ContextID: "context", Namespace: "apps", Name: "web", Command: []string{"/bin/echo", "ok"}})
	if err != nil || result.Stdout != "ok" || result.Stderr != "warn" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if _, err := service.Exec(context.Background(), ExecRequest{ContextID: "context", Namespace: "apps", Name: "web", Command: []string{""}}); err == nil {
		t.Fatal("empty argv was accepted")
	}
}

func testObject(apiVersion, kind, name, namespace string) *unstructured.Unstructured {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiVersion,
		"kind":       kind,
		"metadata": map[string]any{
			"name":              name,
			"namespace":         namespace,
			"creationTimestamp": time.Now().UTC().Format(time.RFC3339),
		},
	}}
	return object
}

func TestMutateCreateAndDelete(t *testing.T) {
	existing := testObject("v1", "ConfigMap", "settings", "apps")
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), existing)
	// The fake tracker ignores dry-run on its own, so intercept to assert the flag.
	client.PrependReactor("create", "configmaps", func(action clienttesting.Action) (bool, runtime.Object, error) {
		create := action.(clienttesting.CreateAction)
		if options, ok := interface{}(create).(interface{ GetCreateOptions() metav1.CreateOptions }); ok && len(options.GetCreateOptions().DryRun) == 1 {
			return true, create.GetObject(), nil
		}
		return false, nil, nil
	})
	client.PrependReactor("delete", "configmaps", func(action clienttesting.Action) (bool, runtime.Object, error) {
		deleteAction := action.(clienttesting.DeleteAction)
		if options, ok := interface{}(deleteAction).(interface{ GetDeleteOptions() metav1.DeleteOptions }); ok && len(options.GetDeleteOptions().DryRun) == 1 {
			return true, nil, nil
		}
		return false, nil, nil
	})
	service := NewService(fakeProvider{client: client})
	configMaps := func() []string {
		list, err := client.Resource(schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}).Namespace("apps").List(context.Background(), metav1.ListOptions{})
		if err != nil {
			t.Fatal(err)
		}
		names := make([]string, 0, len(list.Items))
		for _, item := range list.Items {
			names = append(names, item.GetName())
		}
		return names
	}

	createYAML := "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: created\ndata:\n  mode: fresh\n"
	dryRun, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Operation: "create", YAML: createYAML, DryRun: true})
	if err != nil || !dryRun.Changed || dryRun.Name != "created" || !strings.Contains(dryRun.YAML, "mode: fresh") {
		t.Fatalf("create dry-run result=%#v err=%v", dryRun, err)
	}
	if got := configMaps(); len(got) != 1 || got[0] != "settings" {
		t.Fatalf("dry-run persisted create: %v", got)
	}
	applied, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Operation: "create", YAML: createYAML})
	if err != nil || applied.Name != "created" {
		t.Fatalf("create apply result=%#v err=%v", applied, err)
	}
	created, err := client.Resource(schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}).Namespace("apps").Get(context.Background(), "created", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if data, _, _ := unstructured.NestedStringMap(created.Object, "data"); data["mode"] != "fresh" {
		t.Fatalf("created data=%#v", data)
	}

	if _, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Operation: "create", YAML: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\n  namespace: other\n"}); err == nil || !strings.Contains(err.Error(), "namespace mismatch") {
		t.Fatalf("namespace mismatch err=%v", err)
	}
	if _, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Operation: "create", YAML: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: x\n"}); err == nil || !strings.Contains(err.Error(), "kind must be") {
		t.Fatalf("kind mismatch err=%v", err)
	}
	if _, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Operation: "create", YAML: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: \"\n"}); err == nil {
		t.Fatalf("empty name was accepted")
	}

	deleteDryRun, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Name: "created", Operation: "delete", DryRun: true})
	if err != nil || !deleteDryRun.Changed || deleteDryRun.Name != "created" || !strings.Contains(deleteDryRun.YAML, "mode: fresh") {
		t.Fatalf("delete dry-run result=%#v err=%v", deleteDryRun, err)
	}
	if got := configMaps(); len(got) != 2 {
		t.Fatalf("dry-run deleted object: %v", got)
	}
	if _, err = service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "configmaps"}, Namespace: "apps", Name: "created", Operation: "delete"}); err != nil {
		t.Fatal(err)
	}
	if got := configMaps(); len(got) != 1 || got[0] != "settings" {
		t.Fatalf("delete apply left %v", got)
	}
}

func TestMutateYAMLForWorkloadKind(t *testing.T) {
	deployment := testObject("apps/v1", "Deployment", "web", "apps")
	deployment.Object["spec"] = map[string]any{"replicas": int64(1)}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), deployment)
	service := NewService(fakeProvider{client: client})
	yamlText := "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: apps\nspec:\n  replicas: 3\n"
	result, err := service.Mutate(context.Background(), MutationRequest{ContextID: "context", GVR: GVR{Group: "apps", Version: "v1", Resource: "deployments"}, Namespace: "apps", Name: "web", Operation: "yaml", YAML: yamlText})
	if err != nil || !result.Changed {
		t.Fatalf("deployment yaml result=%#v err=%v", result, err)
	}
	updated, err := client.Resource(schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}).Namespace("apps").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if replicas, _, _ := unstructured.NestedFloat64(updated.Object, "spec", "replicas"); replicas != 3 {
		t.Fatalf("replicas=%v", replicas)
	}
}

func TestSecretGetMasksDataKeys(t *testing.T) {
	secret := testObject("v1", "Secret", "credentials", "apps")
	secret.Object["data"] = map[string]any{"password": "c2VjcmV0"}
	client := fake.NewSimpleDynamicClient(runtime.NewScheme(), secret)
	service := NewService(fakeProvider{client: client})
	response, err := service.Get(context.Background(), GetRequest{ContextID: "context", GVR: GVR{Version: "v1", Resource: "secrets"}, Namespace: "apps", Name: "credentials"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(response.YAML, "password: '[redacted]'") && !strings.Contains(response.YAML, "password: \"[redacted]\"") && !strings.Contains(response.YAML, "password: [redacted]") {
		t.Fatalf("secret yaml=%q", response.YAML)
	}
	if strings.Contains(response.YAML, "c2VjcmV0") {
		t.Fatalf("secret value leaked: %q", response.YAML)
	}
}
