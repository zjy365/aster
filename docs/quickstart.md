# Aster quickstart

[English](quickstart.md) · [简体中文](quickstart.zh-CN.md)

Aster reads the same kubeconfig that `kubectl` reads. If `kubectl get pods`
works on your machine, Aster works — open it and pick a cluster.

## 1. Get a cluster

Already have one (managed EKS/GKE/AKS, a home lab, a company context)? Skip
ahead. The fastest way to a local cluster is [kind](https://kind.sigs.k8s.io/):

```bash
# macOS
brew install kind
kind create cluster
```

```powershell
# Windows
winget install --id kind.sigs.k8s.kind
kind create cluster
```

Alternatives: [minikube](https://minikube.sigs.k8s.io/),
[k3d](https://k3d.io/), or any managed cluster. All of them write a kubeconfig
that Aster picks up automatically.

## 2. Add clusters to Aster

- **In `~/.kube/config` or `$KUBECONFIG`?** They already appear in the cluster
  picker on first launch. Nothing to configure.
- **Elsewhere?** Open **Settings → Kubeconfig** and add a file, a whole folder
  of kubeconfigs, or paste the contents of one.

## 3. The keys that matter

Aster is keyboard-first; menus are a fallback, not the path.

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette — switch cluster, jump to any resource kind, switch namespace, search the whole cluster by name, change theme |
| `⌘F` / `Ctrl+F` | Filter the current resource list |
| `↑` `↓` `⏎` | Navigate and open |
| `Esc` | Step back out, one layer at a time |

From there: click any row to inspect a resource, stream its logs, or edit its
YAML. Every write goes through a dry-run diff you have to read before it
applies.

## Getting help

- Report an issue: <https://github.com/zjy365/aster/issues>
- Source and releases: <https://github.com/zjy365/aster>
