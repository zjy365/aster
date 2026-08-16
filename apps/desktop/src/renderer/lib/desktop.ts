import type { DesktopApi } from "../../shared/types";
import { createTauriDesktopApi } from "./desktop-tauri";

declare global {
  interface Window {
    /** Test hook: renderer smoke tests inject a mock DesktopApi before the app boots. */
    __ASTER_DESKTOP__?: DesktopApi;
  }
}

/**
 * Shell-provided desktop capabilities. The Tauri shell is the only supported
 * runtime; the mock hook exists so Playwright can drive the renderer without
 * a shell at all.
 */
export const desktop: DesktopApi = window.__ASTER_DESKTOP__ ?? createTauriDesktopApi();
