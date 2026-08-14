import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeTheme } from "electron";
import { CoreTransport, LogFollowSupervisor, WatchSupervisor } from "./core-transport";
import { registerIpc } from "./ipc";
import { Sidecar, sidecarExecutablePath } from "./sidecar";
import { DesktopWindowManager, installApplicationMenu } from "./window";
import { WriteSafetyPolicy } from "./write-safety";

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

const sidecar = new Sidecar({
  executablePath: () => sidecarExecutablePath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    currentDirectory: moduleDirectory,
    arch: process.arch,
    platform: process.platform,
  }),
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
  });
}

async function launch(): Promise<void> {
  nativeTheme.on("updated", () => windows.syncAppearance());
  installApplicationMenu((command) => windows.send("app:command", command));
  wireRendererCapabilities();
  windows.open();

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
app.on("before-quit", () => sidecar.stop());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
