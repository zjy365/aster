# Aster v0.1 completion audit

Audit date: 2026-08-14 (Asia/Shanghai)

This matrix treats a requirement as complete only when current source and executable evidence both support it. It does not treat documentation claims alone as proof.

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| Electron + React + Go sidecar | Proven | Packaged arm64 and x64 apps launch their architecture-matched `aster-core`; renderer is sandboxed with context isolation and uses only the allowlisted preload API. |
| Context / Namespace | Proven | The launch screen presents kubeconfig contexts with search, grid/list layouts, refresh and explicit Connect. The fixture proves zero cluster API requests before Connect and a working return/reconnect path. Go tests prove merged discovery without credential fields; packaged fixture has two contexts and rejects stale context/namespace responses; the real read-only run discovers one redacted context. |
| Common resource browsing | Proven | The Go catalog allowlists 22 Kubernetes resources and the renderer exposes workloads, traffic, storage, configuration and RBAC navigation. List/get paths run through the packaged sidecar. |
| Server pagination | Proven | The packaged fixture loads all 10,000 Deployments as 100 Kubernetes pages of 100 using continuation tokens. |
| Scoped on-demand watch | Proven | Electron owns one active watch for the explicit context/resource/namespace, handles bookmarks and RESET/relist, and cancels it on view/window/core teardown. Cancellation race tests pass 50 iterations. No informer factory exists. |
| Virtual table | Proven | 10,000 loaded resources retain 23 DOM rows after scrolling in the current packaged run; threshold is at most 150. |
| YAML / Events / Related | Proven | Packaged E2E verifies sanitized Deployment YAML, event text and owner-reference Related; Go tests prove Secret data/stringData and managed fields/last-applied content are removed. |
| Image / scale / restart | Proven | Packaged E2E observes separate Kubernetes dry-run and apply updates for each operation. Go tests prove restart changes `spec.template.metadata.annotations`, not workload metadata, and reject invalid operation/resource combinations. |
| ConfigMap / YAML edit | Proven | Packaged E2E observes ConfigMap dry-run and apply with the expected data; Secret mutation is outside the allowlist. |
| Dry-run Diff | Proven | UI requires a successful server-side dry-run, renders a line-aligned review Diff, and exposes separate Apply/Cancel actions; packaged screenshot and request sequence prove no implicit apply. |
| Operation journal | Proven | Successful scale/image/restart/yaml operations appear in a per-context, summary-only, capped local journal; no YAML, Secret, token or Terminal command is recorded. |
| Logs | Proven | Packaged fixture renders Pod logs. The 100,000-line Go fixture is capped at 4 MiB and benchmarks at 0.265–0.272 ms/op, about 8.40 MB/op and 4 allocs/op on the audit host. |
| Terminal | Proven for approved v0.1 one-shot scope | Renderer exposes a bounded argv-only Pod command; Go validates argv and caps stdout/stderr; the Kubernetes client uses SPDY exec with no stdin or TTY. Persistent interactive PTY/follow mode is explicitly outside v0.1. |
| Three cumulative runnable phases | Proven | Phase 1 read-only, Phase 2 guarded mutation, and Phase 3 diagnostics/package capabilities are documented in `DELIVERY_STATUS.md`; the cumulative result passes `pnpm check` and packaged smoke without replacing the architecture. |
| TypeScript / Go verification | Proven | `pnpm check` passes TypeScript typecheck, 7 Vitest tests, Go race tests, Go vet and production build; watch/resource race repetition passes 50 runs. |
| Electron packaged workflow/screenshots | Proven | Packaged fixture covers the cluster picker plus 11 workbench workflows with zero console errors and no viewport overflow; cluster picker, overview, detail, dry-run Diff and Pod diagnostics screenshots exist. Packaged real read-only run also passes. |
| 10k / 100k performance | Proven | Structured fixture receipt records 3.46 s for 10k paginated load/scroll, 23 DOM rows and about 13.4 MB renderer heap; Go benchmark records the 100k log metrics above. |
| macOS arm64 / x64 installers | Proven as unsigned QA builds | Both DMG checksums pass `hdiutil verify`, both ZIPs pass `unzip -t`, both DMGs mount read-only, and each contains a matching Electron launcher and Go sidecar. Native arm64 and Rosetta x64 packaged smoke pass. |
| Real kubeconfig read-only acceptance | Proven | The ignored, redacted receipt proves cluster selection and reconnect, then records 100 resources, 23 rendered rows, a 209 ms detail load, zero console errors and no overflow. It contains no body text, YAML, Context name or Namespace name. |
| Real kubeconfig write acceptance | Blocked externally | The reversible scale script exists and verifies dry-run, apply, fresh GET, restore and fresh GET, then writes a redacted receipt. It refuses to run because no explicitly authorized Context/Namespace/Deployment and confirmation are configured. No write was attempted. |
| Developer ID signing/notarization | Blocked externally | No signing/notary variables or identities are available. Current `codesign --verify --deep --strict` and Gatekeeper assessment fail as expected for unsigned QA artifacts. |

## Boundary audit

- Source contains no Kubernetes `Create`, `Delete`, `Patch` or `DeleteCollection` call. The only resource mutation is allowlisted `Update`.
- No GPUI, Tauri, Wails, controller-runtime manager, informer factory, account platform, product OAuth, AI provider, Connector or Helm marketplace implementation exists. `golang.org/x/oauth2` is only an indirect `client-go` dependency, not a Aster OAuth feature.
- Renderer source imports neither Node nor Electron.
- The sidecar binds `127.0.0.1:0`, requires a random bootstrap bearer token, and never exposes its token or base URL through preload.
- Real receipts and all runtime/package evidence are ignored by Git. The only certificate/key-looking content found in source is deliberately fake kubeconfig data inside the credential-leak unit test.
- Product references are not declared as implementation sources. External packages remain governed by their own licenses, separately from product inspiration.

## Required external inputs

1. An explicitly disposable/staging Deployment target: `ASTER_REAL_WRITE_CONTEXT`, `ASTER_REAL_WRITE_NAMESPACE`, `ASTER_REAL_WRITE_NAME`, plus `ASTER_ALLOW_REAL_WRITE=1` and the documented confirmation phrase.
2. Apple Developer ID signing material and notarization credentials (`CSC_LINK` or an installed identity, plus the configured notary credentials).

Until both gates pass, v0.1 implementation and unsigned QA packaging are complete, but the full objective's real-write and signed-release acceptance are not.
