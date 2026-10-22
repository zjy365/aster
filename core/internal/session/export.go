package session

import (
	"errors"
	"fmt"

	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
)

// ErrContextNotFound reports an export request for a context the merged
// kubeconfig does not define. Sentinel so the RPC layer can map it to 404
// instead of a generic load failure.
var ErrContextNotFound = errors.New("context not found")

// ExportContext narrows the loader's merged kubeconfig to exactly one
// context: the named context, the cluster it references, and the user it
// references, with current-context pinned to that name. The result is a
// self-contained kubeconfig document the desktop shell stages as a 0600 temp
// file behind KUBECONFIG for a terminal handoff.
//
// The document carries real credentials, so it is returned to the shell only
// — never through the renderer. Load precedence (first file wins) is whatever
// the loader already resolved for listing, so the exported context is the
// same one Aster connects with.
func (l *Loader) ExportContext(contextID string) ([]byte, error) {
	config, err := l.rules.Load()
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}
	context, exists := config.Contexts[contextID]
	if !exists {
		return nil, fmt.Errorf("%w: %q", ErrContextNotFound, contextID)
	}
	narrowed := api.NewConfig()
	narrowed.Kind = "Config"
	narrowed.APIVersion = "v1"
	narrowed.Preferences = config.Preferences
	narrowed.CurrentContext = contextID
	narrowed.Contexts[contextID] = context
	if cluster, exists := config.Clusters[context.Cluster]; exists {
		narrowed.Clusters[context.Cluster] = cluster
	}
	if context.AuthInfo != "" {
		if authInfo, exists := config.AuthInfos[context.AuthInfo]; exists {
			narrowed.AuthInfos[context.AuthInfo] = authInfo
		}
	}
	data, err := clientcmd.Write(*narrowed)
	if err != nil {
		return nil, fmt.Errorf("encode kubeconfig: %w", err)
	}
	return data, nil
}
