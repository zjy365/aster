# Pre-rename v0.1 unsigned QA artifacts

These artifacts were built before the project was renamed from FastKube to Aster. Their original filenames and binary names are preserved below so the hashes remain verifiable; they are not Aster release packages.

Built 2026-08-14 08:43 +08:00 on macOS arm64 with Node 24.15.0, pnpm 10.12.2, Electron 43.4.0 and Go 1.26.0 (`GOTOOLCHAIN=auto`). This build includes the dedicated launch-time cluster picker and the existing resource workbench.

The source branch was `codex/bootstrap-fastkube` at base revision `9f8559c5552e4e191e34c14af4c9314170b949b9`. The build intentionally included the then-uncommitted migration worktree (225 status entries), so these hashes identify that QA output but are not a clean-release provenance claim.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `FastKube_0.1.0_arm64.dmg` | 140226038 | `4f1df3b3a2e4e454cc996cc423ffb05ebe611e3a6a604a0f72305daf48b700c8` |
| `FastKube_0.1.0_arm64.zip` | 140261418 | `3d71f8597ca4477dfa9ee36ce19c96360e67d4c3b51f1641332dabb7b347858a` |
| `FastKube_0.1.0_x64.dmg` | 143777657 | `9335d6d762abb9338e8e013be0ec7b9274c3fedab12f7e715a4f409aadb2eaa5` |
| `FastKube_0.1.0_x64.zip` | 143877632 | `f780a18c74a344cf5bd570bdf727b75a3ab5311fa19e3abe4713eb2f0fae3631` |

Both app launchers and bundled `fastkube-core` binaries were checked with `file`: the arm64 bundle contains only arm64 executables and the x64 bundle contains only x86_64 executables. Both unpacked apps passed the six-second packaged process smoke on the build host (x64 through Rosetta).

Both DMGs pass `hdiutil verify`, mount read-only, and expose their expected app bundle. Both ZIP archives pass `unzip -t` with no compressed-data errors.

These are unsigned verification artifacts. They have not passed Developer ID signing, Apple notarization, stapling or Gatekeeper acceptance and should not be presented as production release packages.
