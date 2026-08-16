import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, nativeTheme, type BrowserWindow } from "electron";
import { CoreTransport, LogFollowSupervisor, WatchSupervisor } from "./core-transport";
import { registerIpc } from "./ipc";
import { Sidecar, sidecarExecutablePath } from "./sidecar";
import { createSettingsFile } from "./settings";
import { AppUpdater, type AutoUpdaterLike } from "./updater";
import { DesktopWindowManager, installApplicationMenu } from "./window";
import { WriteSafetyPolicy } from "./write-safety";

const UPDATE_REPOSITORY = "zjy365/aster";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function configureApplicationStorage(): void {
  const override = process.env.ASTER_DESKTOP_USER_DATA;
  const userDataPath = override
    ? path.resolve(override)
    : path.join(app.getPath("appData"), "Aster");

  fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
  app.setPath("userData", userDataPath);
  if (override) {
    const logPath = path.join(userDataPath, "logs");
    fs.mkdirSync(logPath, { recursive: true, mode: 0o700 });
    app.setAppLogsPath(logPath);
  } else {
    app.setAppLogsPath();
  }
}

app.setName("Aster");
configureApplicationStorage();

const settingsFile = createSettingsFile();

const sidecar = new Sidecar({
  executablePath: () => sidecarExecutablePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    currentDirectory: moduleDirectory,
    arch: process.arch,
    platform: process.platform,
  }),
  extraEnv: () => {
    // Configured sources ride the environment; the core appends them ahead
    // of the standard ~/.kube/config chain. An empty config leaves any
    // externally provided value (tests, power users) untouched.
    const sources = settingsFile.read().kubeconfigSources;
    return sources.length > 0 ? { ASTER_KUBECONFIG_SOURCES: sources.join(path.delimiter) } : {};
  },
  version: () => app.getVersion(),
});
const transport = new CoreTransport(sidecar);
const watches = new WatchSupervisor(transport);
const logStreams = new LogFollowSupervisor(transport);
const writeSafety = new WriteSafetyPolicy();

function cancelRendererWork(): void {
  watches.cancelAll();
  logStreams.cancelAll();
}

async function createUpdater(): Promise<AppUpdater | undefined> {
  if (!app.isPackaged) return undefined;
  // electron-updater is CJS and exposes autoUpdater through a getter that
  // ESM named-export detection cannot see, so it must be required.
  const { autoUpdater } = createRequire(import.meta.url)("electron-updater") as { autoUpdater: AutoUpdaterLike };
  return new AppUpdater({
    autoUpdater,
    ...(process.env.ASTER_UPDATER_FEED ? { feedUrl: process.env.ASTER_UPDATER_FEED } : {}),
    releaseUrl: (version) => `https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${version}`,
  });
}

let updater: AppUpdater | undefined;

const windows = new DesktopWindowManager({
  preloadFile: path.join(moduleDirectory, "../preload/index.cjs"),
  rendererFile: path.join(moduleDirectory, "../../dist/index.html"),
  ...(process.env.VITE_DEV_SERVER_URL
    ? { devServerUrl: process.env.VITE_DEV_SERVER_URL }
    : {}),
}, {
  onClosed: cancelRendererWork,
});

sidecar.onStatus((status) => windows.send("core:status-changed", status));
sidecar.onExit(cancelRendererWork);

function wireRendererCapabilities(): void {
  registerIpc({
    getWindow: () => windows.current,
    sidecar,
    transport,
    watches,
    logsFollow: logStreams,
    writeSafety,
    setThemeSource: (theme) => {
      nativeTheme.themeSource = theme;
      windows.syncAppearance();
    },
    appVersion: () => app.getVersion(),
    ...(updater ? { updater } : {}),
    settingsFile,
    applySettings: () => {
      // Sources are captured at core startup, so applying means a restart.
      cancelRendererWork();
      sidecar.stop();
      void sidecar.start().catch((error) => console.error("Failed to restart Aster core", error));
    },
    pickFile: async (window?: BrowserWindow) => {
      const options: Electron.OpenDialogOptions = {
        title: "Add a kubeconfig file",
        properties: ["openFile"],
        filters: [{ name: "Kubeconfig", extensions: ["yaml", "yml", "json", "config"] }],
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    pickFolder: async (window?: BrowserWindow) => {
      const options: Electron.OpenDialogOptions = { title: "Add a folder of kubeconfigs", properties: ["openDirectory"] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
  });
}

async function launch(): Promise<void> {
  nativeTheme.on("updated", () => windows.syncAppearance());
  installApplicationMenu((command) => windows.send("app:command", command));
  updater = await createUpdater();
  wireRendererCapabilities();
  windows.open();
  updater?.start();

  try {
    await sidecar.start();
  } catch (error) {
    console.error("Failed to start Aster core", error);
  }
}

void app.whenReady().then(launch).catch((error: unknown) => {
  console.error("Failed to initialize Aster", error);
  app.quit();
});

app.on("activate", () => {
  if (app.isReady()) windows.open();
});
app.on("before-quit", () => {
  updater?.stop();
  sidecar.stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
