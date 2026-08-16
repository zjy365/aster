import { EventEmitter } from "node:events";
import type { UpdaterSnapshot, UpdaterState } from "../shared/types";
import { releaseNotesText } from "./validation";

export interface ReleaseNotes {
  version?: string;
  releaseNotes?: unknown;
}

export interface AutoUpdaterLike {
  readonly currentVersion: { version: string } | string;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(url: string): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface UpdaterFields {
  version?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  progressPercent?: number;
  message?: string;
}

export interface UpdaterOptions {
  autoUpdater: AutoUpdaterLike;
  feedUrl?: string;
  releaseUrl: (version: string) => string;
  intervalMs?: number;
}

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Wraps electron-updater behind a snapshot state machine. The renderer only
 * ever sees UpdaterSnapshot values over IPC; download waits for an explicit
 * user action, and install is a quit-and-restart.
 */
export class AppUpdater extends EventEmitter {
  private state: UpdaterState;
  private snapshot?: UpdaterFields;
  private timer?: NodeJS.Timeout;
  private disposed = false;

  constructor(private readonly options: UpdaterOptions) {
    super();
    this.state = "idle";
    const autoUpdater = options.autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    if (options.feedUrl) autoUpdater.setFeedURL(options.feedUrl);
    autoUpdater.on("checking-for-update", () => this.transition("checking"));
    autoUpdater.on("update-available", (info: unknown) => this.available(info));
    autoUpdater.on("update-not-available", () => this.transition("not-available"));
    autoUpdater.on("download-progress", (progress: unknown) => this.downloadProgress(progress));
    autoUpdater.on("update-downloaded", (info: unknown) => this.downloaded(info));
    autoUpdater.on("error", (error: unknown) => this.updateError(error));
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => {
      if (!this.disposed && this.state !== "downloading" && this.state !== "downloaded") void this.check();
    }, this.options.intervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
  }

  currentState(): UpdaterSnapshot {
    return { state: this.state, currentVersion: this.version(), ...(this.snapshot ?? {}) };
  }

  async check(): Promise<void> {
    await this.options.autoUpdater.checkForUpdates();
  }

  async download(): Promise<void> {
    if (this.state !== "available") return;
    this.transition("downloading", { progressPercent: 0 });
    await this.options.autoUpdater.downloadUpdate();
  }

  install(): void {
    if (this.state !== "downloaded") return;
    this.options.autoUpdater.quitAndInstall();
  }

  private version(): string {
    const version = this.options.autoUpdater.currentVersion;
    return typeof version === "string" ? version : version.version;
  }

  private transition(state: UpdaterState, patch?: Partial<UpdaterSnapshot>): void {
    if (this.disposed) return;
    this.state = state;
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch === undefined || Object.keys(patch).length === 0) {
      const next = { ...this.snapshot };
      for (const key of ["version", "releaseNotes", "releaseUrl", "progressPercent", "message"] as const) {
        delete next[key];
      }
      this.snapshot = next;
    }
    this.emitSnapshot();
  }

  private available(info: unknown): void {
    const release = (info ?? {}) as ReleaseNotes;
    const version = typeof release.version === "string" ? release.version : undefined;
    this.transition("available", {
      version,
      releaseNotes: releaseNotesText(release.releaseNotes),
      ...(version ? { releaseUrl: this.options.releaseUrl(version) } : {}),
    });
  }

  private downloadProgress(progress: unknown): void {
    const percent = (progress ?? {}) as { percent?: number };
    const value = typeof percent.percent === "number" ? percent.percent : undefined;
    this.transition("downloading", { progressPercent: value === undefined ? undefined : Math.round(value) });
  }

  private downloaded(info: unknown): void {
    const release = (info ?? {}) as ReleaseNotes;
    const version = typeof release.version === "string" ? release.version : this.snapshot?.version;
    this.transition("downloaded", {
      ...(version ? { version } : {}),
      ...(version && !this.snapshot?.releaseUrl ? { releaseUrl: this.options.releaseUrl(version) } : {}),
    });
  }

  private updateError(error: unknown): void {
    this.transition("error", { message: error instanceof Error ? error.message : String(error) });
  }

  private emitSnapshot(): void {
    this.emit("state-changed", this.currentState());
  }
}
