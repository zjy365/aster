# Renderer smoke tests

`renderer-smoke.spec.ts` drives the built renderer in plain Chromium via Playwright. A mock `DesktopApi` is injected before the app boots (the `window.__ASTER_DESKTOP__` hook in `src/renderer/lib/desktop.ts`), so no Tauri shell, Go core, or cluster is involved.

```bash
pnpm --dir apps/desktop smoke:visual
```

The fixture serves two contexts and 10,000 Deployments across 100-item pages. It proves that:

- the context picker and workbench render with no horizontal overflow at 1280×800 and 900×640;
- the virtual table renders a small DOM slice (~100 loaded rows) out of 10,000 resources;
- selecting a Deployment opens the detail view with the Overview and YAML projections, with write operations available;
- the renderer produces no page errors or console errors.

Screenshots are written to `output/playwright/renderer-*.png`.

What this suite intentionally does not cover (and where that coverage lives):

- Rust shell ↔ Go core HTTP pipeline, watch/log streaming, reconnect and cancellation — `src-tauri` integration tests (`cargo test --manifest-path src-tauri/Cargo.toml`).
- Kubernetes API behavior (pagination, selectors, projections) — `core` Go tests (`go -C core test -race ./...`).
- End-to-end window/sidecar behavior — manual `pnpm dev` checklist against a real kubeconfig.
