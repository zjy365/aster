package session

import (
	"fmt"
	"net/url"
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
	// Conflicts lists the entries in other source files that collide with this
	// context's identity. The winning source is not listed: it is the one the
	// client actually connects to.
	Conflicts []ConflictInfo `json:"conflicts,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// ConflictInfo describes one colliding definition in another source file:
// which entry collides (a context name, or the cluster name this context
// references) and a suggested rename that would resolve the collision in
// that file.
type ConflictInfo struct {
	Path       string `json:"path"`
	Kind       string `json:"kind"` // "context" or "cluster"
	Name       string `json:"name"`
	Suggestion string `json:"suggestion"`
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
	// Chain starts as an empty slice, not nil: the renderer reads
	// chain.length directly, and a nil slice would serialize as JSON null.
	report := SourcesReport{Chain: []SourceReport{}}
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
	defs := l.fileDefs()
	for index := range contexts {
		contexts[index].Source = perFile[contexts[index].Name]
		contexts[index].Conflicts = l.sourceConflicts(contexts[index], defs)
	}
	return contexts, nil
}

// fileDefs parses every precedence file once, capturing each file's clusters
// (name → server) and contexts (name → cluster, server, namespace) so conflict
// detection never re-reads files per context.
type fileDefs map[string]fileDef

type fileDef struct {
	clusters map[string]string // cluster name -> server
	contexts map[string]struct {
		cluster   string
		server    string
		namespace string
	}
}

func (l *Loader) fileDefs() fileDefs {
	defs := make(fileDefs)
	for _, file := range l.rules.Precedence {
		if file == "" {
			continue
		}
		config, err := clientcmd.LoadFromFile(file)
		if err != nil {
			continue
		}
		def := fileDef{
			clusters: make(map[string]string, len(config.Clusters)),
			contexts: make(map[string]struct {
				cluster   string
				server    string
				namespace string
			}, len(config.Contexts)),
		}
		for name, cluster := range config.Clusters {
			def.clusters[name] = cluster.Server
		}
		for name, context := range config.Contexts {
			def.contexts[name] = struct {
				cluster   string
				server    string
				namespace string
			}{context.Cluster, config.Clusters[context.Cluster].Server, context.Namespace}
		}
		defs[file] = def
	}
	return defs
}

// sourceConflicts reports which configured sources define the same context
// name, or the same cluster name, with different content than the winning
// source. Two silent-misconnection failure modes are caught:
//
//   - context-name collision: another file defines the same context name
//     against a different server or namespace, so under first-wins merge the
//     losing definition is silently dropped.
//   - cluster-name collision: another file defines the cluster this context
//     references with a different server, overriding the winner's cluster
//     server and redirecting the context to the wrong cluster.
//
// Sources whose definitions match the winner are not conflicts.
func (l *Loader) sourceConflicts(context ContextInfo, defs fileDefs) []ConflictInfo {
	source, ok := defs[context.Source]
	if !ok {
		return nil
	}
	var conflicts []ConflictInfo
	seen := map[string]bool{}
	add := func(file, kind, name, server string, taken func(string) bool) {
		key := file + "|" + kind + "|" + name
		if seen[key] {
			return
		}
		seen[key] = true
		conflicts = append(conflicts, ConflictInfo{
			Path:       file,
			Kind:       kind,
			Name:       name,
			Suggestion: suggestedName(name, server, taken),
		})
	}
	for file, def := range defs {
		if file == context.Source {
			continue
		}
		if other, exists := def.contexts[context.Name]; exists {
			namespaceDiffers := other.namespace != "" && context.Namespace != "" && other.namespace != context.Namespace
			if other.server != context.Server || namespaceDiffers {
				add(file, "context", context.Name, other.server, func(candidate string) bool {
					_, exists := def.contexts[candidate]
					return exists
				})
			}
		}
		if sourceServer, exists := source.clusters[context.Cluster]; exists {
			if otherServer, exists := def.clusters[context.Cluster]; exists && otherServer != sourceServer {
				add(file, "cluster", context.Cluster, otherServer, func(candidate string) bool {
					_, exists := def.clusters[candidate]
					return exists
				})
			}
		}
	}
	return conflicts
}

// suggestedName proposes a collision-free rename: base plus the first DNS
// label of the entry's own server (so "sealos" against usw-1.sealos.io
// becomes "sealos-usw-1"), numbered upward if the candidate is also taken.
func suggestedName(base, server string, taken func(string) bool) string {
	suffix := ""
	if parsed, err := url.Parse(server); err == nil {
		if host := parsed.Hostname(); host != "" {
			suffix = strings.SplitN(host, ".", 2)[0]
		}
	}
	if suffix == "" {
		suffix = "copy"
	}
	candidate := base + "-" + suffix
	for number := 2; taken(candidate); number++ {
		candidate = fmt.Sprintf("%s-%s-%d", base, suffix, number)
	}
	return candidate
}

// RenameEntry renames a cluster or context entry inside one of the loader's
// kubeconfig files, updating in-file references to it (cluster renames update
// the contexts that point at the cluster; context renames update
// current-context). The pre-edit original is preserved once next to the file
// as <name>.aster.bak. The path must be one of the loader's precedence files
// so the endpoint cannot write to arbitrary files.
func (l *Loader) RenameEntry(path, kind, name, newName string) error {
	if !containsPath(l.rules.Precedence, path) {
		return fmt.Errorf("source %q is not a configured kubeconfig file", path)
	}
	config, err := clientcmd.LoadFromFile(path)
	if err != nil {
		return fmt.Errorf("load %s: %w", path, err)
	}
	switch kind {
	case "cluster":
		cluster, exists := config.Clusters[name]
		if !exists {
			return fmt.Errorf("cluster %q is not defined in %s", name, path)
		}
		if _, exists := config.Clusters[newName]; exists {
			return fmt.Errorf("cluster %q already exists in %s", newName, path)
		}
		config.Clusters[newName] = cluster
		delete(config.Clusters, name)
		for _, context := range config.Contexts {
			if context.Cluster == name {
				context.Cluster = newName
			}
		}
	case "context":
		context, exists := config.Contexts[name]
		if !exists {
			return fmt.Errorf("context %q is not defined in %s", name, path)
		}
		if _, exists := config.Contexts[newName]; exists {
			return fmt.Errorf("context %q already exists in %s", newName, path)
		}
		config.Contexts[newName] = context
		delete(config.Contexts, name)
		if config.CurrentContext == name {
			config.CurrentContext = newName
		}
	default:
		return fmt.Errorf("kind must be \"cluster\" or \"context\"")
	}
	if err := backupOnce(path); err != nil {
		return fmt.Errorf("back up %s: %w", path, err)
	}
	data, err := clientcmd.Write(*config)
	if err != nil {
		return fmt.Errorf("encode %s: %w", path, err)
	}
	mode := os.FileMode(0o600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	return os.WriteFile(path, data, mode)
}

// backupOnce preserves the file's original content next to it, only when no
// backup exists yet, so repeated renames never overwrite the pre-Aster state.
func backupOnce(path string) error {
	backup := path + ".aster.bak"
	if _, err := os.Stat(backup); err == nil {
		return nil
	}
	original, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return os.WriteFile(backup, original, 0o600)
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
