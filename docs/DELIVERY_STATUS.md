# Aster v0.1 delivery status

Updated: 2026-08-14 (Asia/Shanghai)

Each phase uses the same Electron + React + Go sidecar architecture and remains buildable with `pnpm check`. Later phases add capabilities without replacing the runnable result from an earlier phase.

## Phase 1 — read-only workbench: complete

- Secure Electron main/preload/renderer boundary and authenticated loopback-only Go sidecar.
- A dedicated launch-time cluster picker with search, grid/list layouts, refresh, explicit Connect and a workbench return path. Namespace/resource calls do not begin until Connect.
- Kubeconfig Context and Namespace discovery without returning authentication material.
- Allowlisted common-resource list/get, native server pagination/selectors and scoped on-demand watch.
- Virtual resource table plus sanitized YAML, Events and owner-reference Related views.
- Packaged Playwright fixture and real-kubeconfig read-only acceptance.

## Phase 2 — guarded operations: complete

- Per-context read-only switch enforced in Electron main for both resource mutations and Pod exec.
- Deployment/StatefulSet scale; Deployment/StatefulSet/DaemonSet image update and rollout restart.
- ConfigMap YAML editing; Secret mutation remains disabled.
- Resource-version conflict protection and Kubernetes server-side dry-run.
- Two-step `Dry-run -> review Diff -> Apply/Cancel` UI and summary-only local operation journal.
- List/watch/detail failures are isolated so a transient watch, next-page or Inspector error does not discard an already loaded resource page.

## Phase 3 — diagnostics and packaging: locally complete, external release gates open

- Bounded one-shot Pod Logs (100,000 requested lines, 4 MiB response ceiling).
- Bounded one-shot Pod Terminal command with argv validation; it is not a persistent TTY and never records command contents.
- Unsigned macOS arm64 and x64 DMG/ZIP verification builds, each with an architecture-matched Go sidecar.
- Native arm64 and Rosetta x64 packaged launch smoke pass locally.

External gates still required before calling the release fully accepted:

1. Run the guarded real-cluster write acceptance against an explicitly named disposable/staging Deployment and confirm restoration. No target or opt-in confirmation is currently configured.
2. Provide Apple Developer ID and notarization credentials, then sign, notarize, staple and Gatekeeper-check both architectures. Current artifacts are intentionally unsigned QA builds.

## Current repeatable evidence

- `pnpm check`: TypeScript typecheck, Vitest, Go race tests, Go vet and production build pass.
- Watch cancellation: `go -C core test -race -count=50 ./internal/resources ./internal/rpc` passes.
- Cluster picker fixture: usable in 1.86 s, search and grid/list layouts pass, Connect and return/reconnect pass, and the Kubernetes fixture receives zero requests before Connect.
- 10k resource fixture: 100 pages of 100 loaded in 3.46 s; 23 DOM rows after scrolling; renderer heap about 13.4 MB on an Apple M5 host.
- 100k logs fixture benchmark: 0.265–0.272 ms/op, about 8.40 MB/op and 4 allocations/op; the response is capped at 4 MiB.
- Packaged Playwright fixture: cluster selection, Context race, sanitized detail, Events, owner Related, scale, image update, rollout restart, ConfigMap YAML, dry-run review/apply, operation journal, Pod Logs and Terminal read-only enforcement pass with zero console errors and no viewport overflow. The receipt stores request counts rather than request bodies.
- Real kubeconfig read-only: cluster selection and reconnect pass with one redacted Context; 100 resources load with 23 DOM rows, detail in 209 ms and zero console errors. The available kubeconfig exposes only one Context, so multi-Context real switching remains covered by the deterministic fixture rather than claimed as real-cluster evidence.

Generated screenshots and JSON receipts are stored in ignored `output/playwright/`; real receipts redact Context, Namespace and document body text.

The requirement-by-requirement evidence and remaining external gates are recorded in `COMPLETION_AUDIT.md`.
