package session

import (
	"fmt"
	"sort"
	"strings"

	"k8s.io/client-go/tools/clientcmd"
)

type ContextInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Cluster   string `json:"cluster"`
	Server    string `json:"server,omitempty"`
	User      string `json:"user,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Current   bool   `json:"current"`
	Error     string `json:"error,omitempty"`
}

type Loader struct {
	rules *clientcmd.ClientConfigLoadingRules
}

func NewLoader() *Loader {
	return NewLoaderWithRules(clientcmd.NewDefaultClientConfigLoadingRules())
}

func NewLoaderWithRules(rules *clientcmd.ClientConfigLoadingRules) *Loader {
	return &Loader{rules: rules}
}

func (l *Loader) Contexts() ([]ContextInfo, error) {
	config, err := l.rules.Load()
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}

	contexts := make([]ContextInfo, 0, len(config.Contexts))
	for name, context := range config.Contexts {
		info := ContextInfo{
			ID:        name,
			Name:      name,
			Cluster:   context.Cluster,
			User:      context.AuthInfo,
			Namespace: context.Namespace,
			Current:   name == config.CurrentContext,
		}
		cluster, exists := config.Clusters[context.Cluster]
		switch {
		case !exists:
			info.Error = fmt.Sprintf("cluster %q is not defined", context.Cluster)
		case strings.TrimSpace(cluster.Server) == "":
			info.Error = fmt.Sprintf("cluster %q has no server", context.Cluster)
		default:
			info.Server = cluster.Server
		}
		if context.AuthInfo != "" {
			if _, exists := config.AuthInfos[context.AuthInfo]; !exists {
				if info.Error != "" {
					info.Error += "; "
				}
				info.Error += fmt.Sprintf("user %q is not defined", context.AuthInfo)
			}
		}
		contexts = append(contexts, info)
	}
	sort.Slice(contexts, func(i, j int) bool { return contexts[i].Name < contexts[j].Name })
	return contexts, nil
}

func (l *Loader) clientConfig(contextID string) clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextID}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(l.rules, overrides)
}
