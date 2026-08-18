# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Aster serves Kubernetes operators and developers who inspect, diagnose, and make deliberate changes to clusters from a local desktop application. They need dense resource navigation, preserved working context, and explicit safety boundaries rather than a browser-hosted control plane.

## Product Purpose

Aster is a fast, local-first Kubernetes desktop workbench. It lets users discover kubeconfig contexts, browse and watch Kubernetes resources, inspect sanitized details, read bounded logs, run constrained one-shot terminal commands, and apply a limited set of reviewed mutations.

Success means common inspection work is immediate and keyboard-friendly, large resource lists remain responsive, and every write remains understandable and intentionally confirmed.

## Positioning

Aster combines a native desktop workbench with a narrow, loopback-only Go sidecar. Kubernetes clients are created lazily for explicit views, while credentials, kubeconfig contents, Secret values, sidecar tokens, and service addresses remain outside the renderer.

## Operating Context

- Users move from kubeconfig context selection to namespace-scoped resource lists, then into resource details, YAML, Events, Related objects, Logs, Terminal, and safe mutation review.
- The application is used primarily on desktop systems and should feel at home on macOS while retaining solid, accessible Windows and Linux fallbacks.
- Users may inspect large clusters, rapidly switch contexts, and depend on server pagination, scoped watches, and virtual rendering.
- The product is read-write: mutations go through server-side dry-run and explicit Apply, with no read-only lock.

## Capabilities and Constraints

- Electron main/preload/renderer isolation with a typed, allowlisted `window.aster` API.
- Random loopback Go sidecar protected by one-time bearer authentication.
- Native Kubernetes pagination, selectors, scoped watch, bookmark handling, reconnect, and expired-resource-version reset.
- Virtualized resource tables; never add an `All` page size or render full large lists into the DOM.
- Sanitized resource details; never expose kubeconfig contents, credentials, Secret data, the sidecar token, or its base URL to the renderer.
- Safe Deployment, StatefulSet, DaemonSet, and ConfigMap mutations use server-side dry-run, semantic Diff, resource-version checks, and explicit Apply.
- Bounded Pod Logs and one-shot Pod Terminal only; no persistent shell.
- Never create ServiceAccounts, Roles, ClusterRoles, RoleBindings, or ClusterRoleBindings as a convenience feature.
- This UI redesign does not add cluster aggregation, Metrics APIs, global informer caches, telemetry, user accounts, or remote services.

## Brand Commitments

- Product name: Aster.
- The experience should be simple, easy to use, restrained, and feel native to macOS.
- Aptakube is a layout reference for its persistent source list, unified scope toolbar, dense resource table, and full workspace detail flow; its visual skin is not a brand reference.
- Aster orange remains a restrained brand identifier. System interaction blue owns selection, focus, and navigation; semantic colors are reserved for status.

## Evidence on Hand

- Product and architecture documentation in `README.md` and `apps/desktop/README.md`.
- Existing renderer, typed preload API, Go sidecar, unit tests, packaged Electron smoke fixture, and visual screenshots.
- Five user-provided Aptakube screenshots documenting the accepted layout topology.
- No customer claims, performance benchmarks, telemetry, or metrics data should be fabricated.

## Product Principles

1. Preserve context: list state, scope, selection, and scroll position survive detail work.
2. Make complexity available, not mandatory: the default path is calm and direct while advanced Kubernetes detail remains close.
3. Keep safety visible: dry-run results, diffs, and destructive actions are explicit.
4. Stay fast at cluster scale: lazy clients, server pagination, scoped watches, and virtual rendering are product behavior.
5. Feel native through structure and behavior: system typography, desktop shortcuts, clear focus, and restrained motion matter more than decorative chrome.

## Accessibility & Inclusion

- All primary workflows must be keyboard-operable with visible focus and correct focus restoration.
- Status must never rely on color alone.
- Light, Dark, System appearance and reduced-motion preferences must remain usable.
- Controls require accessible names, adequate hit targets, and resilient layouts for long Kubernetes identifiers.
