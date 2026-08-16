# Aster agent guidance

Aster is a Tauri (Rust shell) + React desktop application with a Go Kubernetes sidecar.

## Boundaries

- Renderer code never uses Node, Rust, or shell APIs directly; use the typed `DesktopApi` from `src/renderer/lib/desktop.ts`.
- The Tauri Rust side owns the sidecar token, base URL, process lifecycle, filesystem, write-safety policy, and native dialogs. The token and loopback URL never cross into the renderer.
- Go core only listens on random loopback ports and requires bearer authentication, and re-validates every input cap the shell enforces (core/internal/rpc/validate.go).
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
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

(`pnpm check` at the repository root runs the full suite.)

UI changes require the renderer Playwright smoke suite (`pnpm --dir apps/desktop smoke:visual`) to pass with screenshots and overlap/overflow inspection before completion. Shell changes additionally require a manual `pnpm dev` run against a real kubeconfig.
