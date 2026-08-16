import { describe, expect, it } from "vitest";
import { AppUpdater, type AutoUpdaterLike } from "./updater";

class FakeAutoUpdater implements AutoUpdaterLike {
  readonly currentVersion = { version: "0.1.0" };
  autoDownload = true;
  autoInstallOnAppQuit = true;
  feedUrl?: string;
  checked = 0;
  downloads = 0;
  installs = 0;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  setFeedURL(url: string): void {
    this.feedUrl = url;
  }

  async checkForUpdates(): Promise<unknown> {
    this.checked += 1;
    return null;
  }

  async downloadUpdate(): Promise<unknown> {
    this.downloads += 1;
    return null;
  }

  quitAndInstall(): void {
    this.installs += 1;
  }

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function harness(overrides: Partial<ConstructorParameters<typeof AppUpdater>[0]> = {}) {
  const autoUpdater = new FakeAutoUpdater();
  const updater = new AppUpdater({
    autoUpdater,
    releaseUrl: (version) => `https://example.com/releases/v${version}`,
    ...overrides,
  });
  return { autoUpdater, updater };
}

describe("AppUpdater", () => {
  it("disables automatic download and install by default", () => {
    const { updater } = harness();
    expect(updater.currentState()).toMatchObject({ state: "idle", currentVersion: "0.1.0" });
  });

  it("honors an explicit feed override", () => {
    const { autoUpdater } = harness({ feedUrl: "https://updates.example.com/aster" });
    expect(autoUpdater.feedUrl).toBe("https://updates.example.com/aster");
  });

  it("maps the update lifecycle to snapshots", () => {
    const { autoUpdater, updater } = harness();
    const snapshots: unknown[] = [];
    updater.on("state-changed", (snapshot) => snapshots.push(snapshot));

    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", {
      version: "0.2.0",
      releaseNotes: "## Fixed\n- <b>Crash</b> on start &amp; connect",
    });
    expect(updater.currentState()).toMatchObject({
      state: "available",
      currentVersion: "0.1.0",
      version: "0.2.0",
      releaseUrl: "https://example.com/releases/v0.2.0",
    });
    expect(updater.currentState().releaseNotes).not.toMatch(/<|&amp;|##/);

    void updater.download();
    expect(autoUpdater.downloads).toBe(1);
    autoUpdater.emit("download-progress", { percent: 41.6 });
    expect(updater.currentState()).toMatchObject({ state: "downloading", progressPercent: 42 });

    autoUpdater.emit("update-downloaded", { version: "0.2.0" });
    expect(updater.currentState()).toMatchObject({ state: "downloaded", version: "0.2.0" });

    updater.install();
    expect(autoUpdater.installs).toBe(1);
    expect(snapshots.length).toBeGreaterThanOrEqual(5);
  });

  it("refuses download and install outside their states", () => {
    const { autoUpdater, updater } = harness();
    void updater.download();
    updater.install();
    expect(autoUpdater.downloads).toBe(0);
    expect(autoUpdater.installs).toBe(0);
  });

  it("surfaces updater errors and clears stale fields on the next cycle", () => {
    const { autoUpdater, updater } = harness();
    autoUpdater.emit("update-available", { version: "0.2.0" });
    autoUpdater.emit("error", new Error("network unreachable"));
    expect(updater.currentState()).toMatchObject({ state: "error", message: "network unreachable" });

    autoUpdater.emit("update-not-available");
    expect(updater.currentState()).toMatchObject({ state: "not-available" });
    expect(updater.currentState().message).toBeUndefined();
    expect(updater.currentState().version).toBeUndefined();
  });

  it("stops emitting after stop()", () => {
    const { autoUpdater, updater } = harness();
    updater.stop();
    autoUpdater.emit("update-available", { version: "0.2.0" });
    expect(updater.currentState().state).toBe("idle");
  });
});
