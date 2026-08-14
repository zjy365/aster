# Aster

Aster is a fast, local-first Kubernetes desktop workbench. It pairs an Electron desktop shell with a narrow Go sidecar, using lazy Kubernetes clients, native server-side pagination, and a virtualized resource table instead of a web platform, a global cache, or full-list rendering.

## Current state

The current v0.1 milestone includes:

- Electron main/preload/renderer isolation with a typed `window.aster` API.
- A loopback-only Go sidecar with one-time bearer authentication.
- Default kubeconfig context discovery without exposing credentials.
- Lazy dynamic clients for the common Kubernetes resource catalog (workloads, traffic, storage, config, and RBAC), with sanitized detail projections.
- Native Kubernetes pagination and selectors.
- A virtualized resource table, resource inspector, and sanitized YAML view.
- Native scoped Kubernetes watch with bookmark handling, reconnect, and expired-resource-version reset.
- Safe Phase 2 mutations for Deployment, StatefulSet, and DaemonSet scale/image/restart, including server-side dry-run and resource-version conflict checks.
- A renderer-side read-only switch, dry-run confirmation, and a persisted per-context operation journal containing summaries only.
- Event projection and a related-object Events view for the selected namespaced resource.
- Bounded Pod Logs retrieval (tail-lines request, 4 MiB response cap, and no follow stream).
- One-shot Pod Terminal execution with argv validation and a 1 MiB output cap; no persistent shell and no command contents in the journal.

ConfigMap/YAML editing, one-shot Terminal, a semantic dry-run diff preview, owner-reference Related navigation, and a local per-context operation journal are available from the Inspector. Logs are intentionally bounded one-shot reads; follow-mode streaming and broader graph navigation are outside this v0.1 scope. Secret mutation is intentionally disabled.

## Architecture

```text
React renderer -> allowlisted preload -> Electron main -> local Go sidecar -> Kubernetes API
```

The renderer never receives kubeconfig contents, API credentials, the sidecar token, or its base URL. The sidecar listens on a random loopback port and creates Kubernetes clients only when a context is queried.

## Development

Requirements: Node.js 22.19+, pnpm 10.12.2, Go 1.26+, and an optional kubeconfig for live data.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm run pack
```

Go checks run from `core/`:

```bash
go test -race ./...
go vet ./...
```

## Security boundary

- No user database, OAuth, platform RBAC, AI provider, connector, telemetry, or remote web server.
- No controller-runtime manager, global informer cache, or startup cache sync.
- Aster uses the permissions already present in the selected kubeconfig context.
- Aster never creates a ServiceAccount, ClusterRole, or ClusterRoleBinding.

## Acknowledgements

Thanks to [Kite](https://github.com/kite-org/kite) and its contributors for inspiration around Kubernetes resource navigation and workflows.

## License

Aster is licensed under the Apache License 2.0.
