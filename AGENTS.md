# Aster agent guidance

Aster is a Tauri (Rust shell) + React desktop application with a Go Kubernetes sidecar.

## Boundaries

- Renderer code never uses Node, Rust, or shell APIs directly; use the typed `DesktopApi` from `src/renderer/lib/desktop.ts`.
- The Tauri Rust side owns the sidecar token, base URL, process lifecycle, filesystem, and native dialogs. The token and loopback URL never cross into the renderer.
- Go core only listens on random loopback ports and requires bearer authentication, and re-validates every input cap the shell enforces (core/internal/rpc/validate.go).
- Kubernetes clients are lazy and scoped to explicit views. Never add global informer caches or startup cache sync.
- Never return kubeconfig contents, credentials, Secret data, or the sidecar token to the renderer.
- Never create ServiceAccounts, Roles, ClusterRoles, RoleBindings, or ClusterRoleBindings as a convenience for terminal or other features.
- Keep server pagination and virtual rendering for resource tables. Do not add an `All` page size. Log streams (and any future terminal surface) render through xterm.js instead — its own scrollback buffer is the cap, not a virtualized list.
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

## Landing site (`apps/landing`)

- 静态营销站，与 `apps/desktop` 完全解耦；不得从 `apps/desktop` 或 `core/` import 任何代码。
- 页面上的每一条能力声明和每一个数字，必须能在 `core/`、`PRODUCT.md` 或 `DESIGN.md` 中找到出处。
  不得出现客户证言、性能基准、遥测或统计数字。
- 颜色 token 与 `DESIGN.md` 保持同步；system blue 用于交互，Aster orange 仅用于品牌标识。
- 不参与根 `pnpm check`。验证：`pnpm --dir apps/landing typecheck && pnpm --dir apps/landing build`。

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
