# Packaged Electron smoke tests

`electron-smoke.mjs` launches the unpacked, packaged Aster executable through Playwright. It does not use the Vite development server.

The default mode is hermetic and suitable for CI:

```bash
pnpm --dir apps/desktop pack
pnpm --dir apps/desktop smoke:visual
```

For the fast Context Picker regression loop only:

```bash
ASTER_E2E_SCOPE=context-picker pnpm --dir apps/desktop smoke:visual
```

That scope verifies the macOS titlebar does not contain duplicate branding, switches both renderer colors and Electron `nativeTheme`, and captures complete light/dark native windows including traffic lights.

It starts a loopback Kubernetes API fixture with two contexts. The fixture proves that:

- all 10,000 fixture Deployments are loaded through 100 native server pages while the virtual table renders at most 150 DOM resource rows, including after scrolling;
- a deliberately delayed context response cannot overwrite the current context, namespace options, or resource rows;
- selecting a Deployment opens the full resource detail view, and returning preserves the resource list workflow;
- Events and owner-reference Related tabs render their fixture projections;
- `metadata.managedFields` and `kubectl.kubernetes.io/last-applied-configuration` do not reach the renderer;
- the source list, single main workspace, resource list and full detail view have no viewport overflow at explicit `900×640` and `1280×800` content sizes;
- the packaged workbench has no visible legacy branding, renderer exceptions, or console errors;
- the write workflow stops after server-side dry-run, renders a reviewable Diff, and only applies after the explicit `Apply changes` action;
- scale, image update, rollout restart, and ConfigMap YAML each send distinct dry-run and apply requests and appear in the per-Context operation journal;
- Pod Logs render through the packaged sidecar, and Terminal is enabled only after writes are explicitly enabled and becomes blocked again in read-only mode without sending an exec request.

Run the same read-only checks against a real staging kubeconfig explicitly:

```bash
ASTER_E2E_MODE=real KUBECONFIG=/absolute/path/to/staging-kubeconfig \
  pnpm --dir apps/desktop smoke:visual
```

Real mode requires the selected/current context to expose at least one Deployment. It never creates, updates, or deletes Kubernetes resources. When the kubeconfig has more than one context, it also switches away and back rapidly and checks that rendered rows still belong to the original response set. With one context, that portion is reported as skipped; deterministic stale-response coverage remains provided by fixture mode and is not reported as real-cluster evidence.

The optional `real-write-acceptance.mjs` script is separate from read-only Playwright smoke. It is a guarded, reversible scale test and refuses to run unless `ASTER_ALLOW_REAL_WRITE=1`, an explicit context/namespace/name, and `ASTER_REAL_WRITE_CONFIRM=I_UNDERSTAND_ASTER_WILL_WRITE` are provided. It is never invoked by CI or the normal smoke commands.

Cluster picker, resource list and full detail screenshots at the explicit compact and standard viewport sizes, plus native-window light/dark captures, dry-run Diff screenshots and JSON evidence, are written under `output/playwright/` with `fixture` or `real` in the filename. The JSON receipt records whether sizing used Electron `BrowserWindow.setContentSize` or the Playwright viewport fallback. Real receipts redact Context, Namespace, resource names, and document body text.

The Go resource tests also include a 100,000-line log fixture. `TestLogs100kFixtureIsCappedWithoutLargeAllocation` verifies that the response is capped at 4 MiB and completes within the test's sub-second budget. `BenchmarkLogs100kFixture` records time, throughput, bytes/op and allocations/op.
