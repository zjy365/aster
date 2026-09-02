// SPDX-License-Identifier: Apache-2.0
// Canonical external destinations the app links to. The Rust shell keeps its
// own copy for the native Help menu (menu.rs): the renderer never shares
// modules with the shell, so the two lists are kept in sync by the smoke
// tests' URL assertions instead of a common source.

/** English canonical guide; the Chinese counterpart sits beside it. */
export const QUICKSTART_URL = "https://github.com/zjy365/aster/blob/main/docs/quickstart.md";
export const REPO_URL = "https://github.com/zjy365/aster";
export const REPORT_URL = "https://github.com/zjy365/aster/issues";
