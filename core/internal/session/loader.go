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
	// configured is the raw user source list (files and directories) this
	// loader was built from. Kept so SourceReports can describe the same
	// expansion the load used instead of re-deriving it from Precedence.
	configured []string
	// includeChain reports whether the standard chain ($KUBECONFIG plus
	// ~/.kube/config) participates in the load. False means the configured
	// sources are the whole world.
	includeChain bool
}

func NewLoader() *Loader {
	rules := &clientcmd.ClientConfigLoadingRules{Precedence: chainFiles()}
	return NewLoaderWithRules(rules)
}

// NewLoaderWithSources builds a loader over an explicit source list. Files
// are used as-is; directories are expanded to the kubeconfig files they
// contain, admitted by content rather than extension so un-suffixed
// kubeconfigs (the common ~/.kube/name-admin layout) load without forcing a
// rename. When includeChain is true the standard chain is consulted last; it
// is a default, not a privilege, so callers may leave it out entirely —
// removing every source simply yields an empty context list. Unreadable or
// non-kubeconfig files degrade to nothing rather than failing the whole load.
func NewLoaderWithSources(sources []string, includeChain bool) *Loader {
	cleaned := make([]string, 0, len(sources))
	for _, source := range sources {
		if source = strings.TrimSpace(source); source != "" {
			cleaned = append(cleaned, source)
		}
	}
	files, _ := expandSources(cleaned)
	precedence := files
	if includeChain {
		// A configured file that is also part of the chain (e.g. added to
		// $KUBECONFIG by the user and then picked in settings) loads once, at
		// the configured position where it wins ties.
		for _, chainFile := range chainFiles() {
			if !containsPath(files, chainFile) {
				precedence = append(precedence, chainFile)
			}
		}
	}
	rules := &clientcmd.ClientConfigLoadingRules{Precedence: precedence}
	loader := NewLoaderWithRules(rules)
	loader.configured = cleaned
	loader.includeChain = includeChain
	return loader
}

// containsPath reports whether path is already in files, comparing cleaned
// paths so trivial spelling differences do not double-load a file.
func containsPath(files []string, path string) bool {
	for _, file := range files {
		if filepath.Clean(file) == filepath.Clean(path) {
			return true
		}
	}
	return false
}

// expandSources resolves user source paths to concrete files, sniffing
// directory contents by what they parse as. The returned reports mirror the
// returned files, so the settings dialog can show what the load will use.
func expandSources(sources []string) ([]string, []SourceReport) {
	files := make([]string, 0, len(sources))
	reports := make([]SourceReport, 0, len(sources))
	for _, source := range sources {
		info, err := os.Stat(source)
		if err != nil || !info.IsDir() {
			files = append(files, source)
			reports = append(reports, fileReport(source))
			continue
		}
		report := directoryReport(source)
		for _, entry := range report.Entries {
			files = append(files, entry.Path)
		}
		reports = append(reports, report)
	}
	return files, reports
}

// SourceReport describes one kubeconfig source: a file, or a directory
// expanded by content sniffing. Paths and counts only — file contents and
// credentials never leave the core.
type SourceReport struct {
	Path     string         `json:"path"`
	Kind     string         `json:"kind"` // "file" | "directory"
	Files    int            `json:"files"`
	Contexts int            `json:"contexts"`
	Default  bool           `json:"default,omitempty"` // the standard ~/.kube/config
	InChain  bool           `json:"inChain,omitempty"` // configured source already covered by the chain
	Error    string         `json:"error,omitempty"`
	Entries  []SourceReport `json:"entries,omitempty"`
}

// SourcesReport groups the standard chain (default location + $KUBECONFIG)
// apart from the user-configured sources so the settings dialog can present
// each with its own affordance. The chain is empty when the user has turned
// it off; configured sources that duplicate a chain entry are flagged so the
// dialog can suggest removing them.
type SourcesReport struct {
	Chain      []SourceReport `json:"chain"`
	Configured []SourceReport `json:"configured"`
}

func (l *Loader) SourceReports() SourcesReport {
	var report SourcesReport
	chain := chainFiles()
	if l.includeChain {
		home, _ := os.UserHomeDir()
		defaultPath := filepath.Join(home, ".kube", "config")
		for _, file := range chain {
			if _, err := os.Stat(file); err != nil {
				continue
			}
			entry := fileReport(file)
			entry.Default = file == defaultPath
			report.Chain = append(report.Chain, entry)
		}
	}
	_, report.Configured = expandSources(l.configured)
	for index := range report.Configured {
		if report.Configured[index].Kind == "file" && containsPath(chain, report.Configured[index].Path) {
			report.Configured[index].InChain = true
		}
	}
	return report
}

func fileReport(path string) SourceReport {
	report := SourceReport{Path: path, Kind: "file"}
	config, err := clientcmd.LoadFromFile(path)
	if err != nil {
		report.Error = "not a readable kubeconfig"
		return report
	}
	report.Files = 1
	report.Contexts = len(config.Contexts)
	return report
}

func directoryReport(path string) SourceReport {
	report := SourceReport{Path: path, Kind: "directory"}
	entries, err := os.ReadDir(path)
	if err != nil {
		report.Error = err.Error()
		return report
	}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		child := filepath.Join(path, entry.Name())
		if !containsKubeconfig(child) {
			continue
		}
		childReport := fileReport(child)
		report.Files++
		report.Contexts += childReport.Contexts
		report.Entries = append(report.Entries, childReport)
	}
	return report
}

// maxSniffBytes caps how much of a directory entry we read when deciding
// whether it is a kubeconfig. Real kubeconfigs are a few KB; anything larger
// is not one.
const maxSniffBytes = 8 << 20

// containsKubeconfig reports whether path parses as a kubeconfig that
// declares at least one context or cluster.
func containsKubeconfig(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > maxSniffBytes {
		return false
	}
	config, err := clientcmd.LoadFromFile(path)
	if err != nil {
		return false
	}
	return len(config.Contexts) > 0 || len(config.Clusters) > 0
}

// chainFiles returns the standard kubeconfig chain: the files named by
// $KUBECONFIG (if set) followed by ~/.kube/config. Unlike kubectl, a
// KUBECONFIG override augments the default location rather than replacing it
// — Aster is a multi-source browser — and earlier entries win on name
// conflicts, so an explicit KUBECONFIG still takes precedence. Whether the
// chain participates at all is the caller's choice (includeChain).
func chainFiles() []string {
	files := make([]string, 0, 4)
	seen := make(map[string]bool)
	if value := os.Getenv("KUBECONFIG"); value != "" {
		for _, part := range strings.Split(value, string(os.PathListSeparator)) {
			if part = strings.TrimSpace(part); part != "" {
				files = append(files, part)
				seen[part] = true
			}
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return files
	}
	if def := filepath.Join(home, ".kube", "config"); !seen[def] {
		if _, statErr := os.Stat(def); statErr == nil {
			files = append(files, def)
		}
	}
	return files
}

func NewLoaderWithRules(rules *clientcmd.ClientConfigLoadingRules) *Loader {
	return &Loader{rules: rules, sources: map[string]string{}, includeChain: true}
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

// ClientConfig returns the client config for a context without connecting.
// Other domains (Helm) use it to build their own lazy clients from the same
// kubeconfig chain.
func (l *Loader) ClientConfig(contextID string) clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{CurrentContext: contextID}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(l.rules, overrides)
}
