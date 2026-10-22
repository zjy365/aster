# Aster Desktop

Aster Desktop is a Tauri (Rust) + React workbench backed by the local Go core in `../../core`.

## Development

From the repository root:

```bash
pnpm install
pnpm check
pnpm dev
```

`pnpm --dir apps/desktop dist` builds a signed, notarized-ready bundle with the Go sidecar embedded as a Tauri external binary. Release builds run in CI (`.github/workflows/release-tauri.yml`) and publish updater artifacts. Manual release runs build the requested tag, so workflow fixes on `main` can rebuild an existing release without moving its tag. Prerelease tags skip the workflow’s verification step and remain separate from the stable update feed.

The renderer is sandboxed and only accesses Kubernetes through the typed `DesktopApi` surface. It never receives kubeconfig contents, bearer tokens, Secret values, or the sidecar address — the token and loopback URL never leave the Rust side.
The Inspector shows sanitized owner-reference Related entries when Kubernetes objects provide them.
