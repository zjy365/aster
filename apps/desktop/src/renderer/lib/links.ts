// SPDX-License-Identifier: Apache-2.0
// Canonical external destinations the renderer links to. The Rust shell
// keeps its own copy for the native Help menu (menu.rs): the renderer never
// shares modules with the shell, so the two lists are kept aligned by hand —
// smoke tests cover the renderer side only.

/** English canonical guide; the Chinese counterpart sits beside it. */
export const QUICKSTART_URL = "https://github.com/zjy365/aster/blob/main/docs/quickstart.md";
export const REPO_URL = "https://github.com/zjy365/aster";
export const REPORT_URL = "https://github.com/zjy365/aster/issues";
/** The author's personal profile — deliberately not the repo. */
export const AUTHOR_X_URL = "https://x.com/zjy365";
