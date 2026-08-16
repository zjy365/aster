package session

import (
	"fmt"
	"os"
	"path/filepath"
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
	Source    string `json:"source,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Loader struct {
	rules *clientcmd.ClientConfigLoadingRules
	// sources maps each merged context to the file it won from, so the
	// renderer can group the picker by origin. Precedence stays with the
	// client-go rules; this is bookkeeping only.
	sources map[string]string
}

func NewLoader() *Loader {
	return NewLoaderWithRules(clientcmd.NewDefaultClientConfigLoadingRules())
}

// NewLoaderWithSources builds a loader over an explicit source list. Files
// are used as-is; directories are expanded to the kubeconfig-looking files
// they contain (yaml/yml/json/config). The default ~/.kube/config and
// $KUBECONFIG chain is always consulted last, so the standard location can
// never be removed. Unreadable or non-kubeconfig files degrade to nothing
// rather than failing the whole load.
func NewLoaderWithSources(sources []string) *Loader {
	files := make([]string, 0, len(sources))
	for _, source := range sources {
		source = strings.TrimSpace(source)
		if source == "" {
			continue
		}
		info, err := os.Stat(source)
		if err != nil || !info.IsDir() {
			files = append(files, source)
			continue
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !looksLikeKubeconfig(entry.Name()) {
				continue
			}
			files = append(files, filepath.Join(source, entry.Name()))
		}
	}
	rules := &clientcmd.ClientConfigLoadingRules{Precedence: append(files, chainFiles()...)}
	return NewLoaderWithRules(rules)
}

func looksLikeKubeconfig(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".yaml", ".yml", ".json":
		return true
	default:
		return name == "config" || name == "kubeconfig"
	}
}

func chainFiles() []string {
	if value := os.Getenv("KUBECONFIG"); value != "" {
		parts := strings.Split(value, string(os.PathListSeparator))
		cleaned := make([]string, 0, len(parts))
		for _, part := range parts {
			if strings.TrimSpace(part) != "" {
				cleaned = append(cleaned, strings.TrimSpace(part))
			}
		}
		return cleaned
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	return []string{filepath.Join(home, ".kube", "config")}
}

func NewLoaderWithRules(rules *clientcmd.ClientConfigLoadingRules) *Loader {
	return &Loader{rules: rules, sources: map[string]string{}}
}

func (l *Loader) Contexts() ([]ContextInfo, error) {
	config, err := l.rules.Load()
	if err != nil {
		return nil, fmt.Errorf("load kubeconfig: %w", err)
	}
	perFile := map[string]string{}
	for _, file := range l.rules.Precedence {
		perFile = mergeContextSources(perFile, file)
	}
	if l.rules.ExplicitPath != "" {
		perFile = mergeContextSources(perFile, l.rules.ExplicitPath)
	}
	l.sources = perFile
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
	for index := range contexts {
		contexts[index].Source = perFile[contexts[index].Name]
	}
	return contexts, nil
}

// mergeContextSources records which file first declares each context name,
// mirroring the client-go precedence rule (earlier files win).
func mergeContextSources(current map[string]string, file string) map[string]string {
	if strings.TrimSpace(file) == "" {
		return current
	}
	config, err := clientcmd.LoadFromFile(file)
	if err != nil {
		return current
	}
	for name := range config.Contexts {
		if _, exists := current[name]; !exists {
			current[name] = file
		}
	}
	return current
}

func (l *Loader) clientConfig(contextID string) clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextID}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(l.rules, overrides)
}
