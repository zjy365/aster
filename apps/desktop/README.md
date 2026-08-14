# Aster Desktop

Aster Desktop is an Electron + React workbench backed by the local Go core in `../../core`.

## Development

From the repository root:

```bash
pnpm install
pnpm check
pnpm dev
```

`pnpm run pack` creates an unpacked application for local smoke testing. Release builds use electron-builder and compile the Go sidecar for each target architecture.

The renderer is sandboxed and only accesses Kubernetes through the allowlisted preload API. It never receives kubeconfig contents, bearer tokens, Secret values, or the sidecar address.
The Inspector now shows sanitized owner-reference Related entries when Kubernetes objects provide them.
