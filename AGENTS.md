# Aster agent guidance

Aster is an Electron + React desktop application with a Go Kubernetes sidecar.

## Boundaries

- Renderer code never uses Node or Electron directly; use the allowlisted preload API.
- Electron main owns the sidecar token, base URL, process lifecycle, filesystem and native dialogs.
- Go core only listens on random loopback ports and requires bearer authentication.
- Kubernetes clients are lazy and scoped to explicit views. Never add global informer caches or startup cache sync.
- Never return kubeconfig contents, credentials, Secret data, or the sidecar token to the renderer.
- Never create ServiceAccounts, Roles, ClusterRoles, RoleBindings, or ClusterRoleBindings as a convenience for terminal or other features.
- Keep server pagination and virtual rendering. Do not add an `All` page size.
- New code is Apache-2.0. Do not copy implementation code from external reference projects.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
go -C core test -race ./...
go -C core vet ./...
```

UI changes require a real Electron screenshot and overlap/overflow inspection before completion.
