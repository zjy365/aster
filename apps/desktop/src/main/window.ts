import {
  BrowserWindow,
  Menu,
  nativeTheme,
  screen,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import type { AppCommand } from "../shared/types";
import { isSafeExternalUrl } from "./validation";

export interface WindowAssets {
  preloadFile: string;
  rendererFile: string;
  devServerUrl?: string;
}

export interface WindowLifecycle {
  onClosed(): void;
}

const MINIMUM_SIZE = { width: 900, height: 640 } as const;
const DEFAULT_SIZE = { widthRatio: 0.86, heightRatio: 0.9 } as const;

function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#f5f5f7";
}

function initialWindowSize(): { width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: Math.max(1100, Math.floor(workArea.width * DEFAULT_SIZE.widthRatio)),
    height: Math.max(720, Math.floor(workArea.height * DEFAULT_SIZE.heightRatio)),
  };
}

/**
 * Owns the only renderer window. Main-process features receive this manager's
 * current window instead of retaining BrowserWindow references themselves.
 */
export class DesktopWindowManager {
  private window?: BrowserWindow;

  constructor(
    private readonly assets: WindowAssets,
    private readonly lifecycle: WindowLifecycle,
  ) {}

  get current(): BrowserWindow | undefined {
    return this.window?.isDestroyed() ? undefined : this.window;
  }

  open(): BrowserWindow {
    const existing = this.current;
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }

    const window = this.buildWindow();
    this.window = window;
    this.attachNavigationPolicy(window);
    this.attachLifecycle(window);
    this.loadRenderer(window);
    return window;
  }

  send(channel: string, ...payload: unknown[]): void {
    const window = this.current;
    if (window && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...payload);
    }
  }

  syncAppearance(): void {
    this.current?.setBackgroundColor(backgroundColor());
  }

  private buildWindow(): BrowserWindow {
    return new BrowserWindow({
      ...initialWindowSize(),
      minWidth: MINIMUM_SIZE.width,
      minHeight: MINIMUM_SIZE.height,
      show: false,
      backgroundColor: backgroundColor(),
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      trafficLightPosition: { x: 17, y: 18 },
      webPreferences: {
        preload: this.assets.preloadFile,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  }

  private attachLifecycle(window: BrowserWindow): void {
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.once("closed", () => {
      if (this.window === window) this.window = undefined;
      this.lifecycle.onClosed();
    });
  }

  private attachNavigationPolicy(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (targetUrl !== window.webContents.getURL()) event.preventDefault();
    });
  }

  private loadRenderer(window: BrowserWindow): void {
    if (this.assets.devServerUrl) {
      void window.loadURL(this.assets.devServerUrl);
      return;
    }
    void window.loadFile(this.assets.rendererFile);
  }
}

function commandItem(
  label: string,
  accelerator: string,
  command: AppCommand,
  sendCommand: (command: AppCommand) => void,
): MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(command) };
}

export function installApplicationMenu(sendCommand: (command: AppCommand) => void): void {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      commandItem("Choose Cluster…", "CmdOrCtrl+Shift+O", "show-contexts", sendCommand),
      { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" },
    ],
  };
  const navigationMenu: MenuItemConstructorOptions = {
    label: "Navigate",
    submenu: [
      commandItem("Back to Resource List", "CmdOrCtrl+[", "go-back", sendCommand),
      commandItem("Filter Resources", "CmdOrCtrl+F", "focus-filter", sendCommand),
      commandItem("Refresh Resources", "CmdOrCtrl+R", "refresh", sendCommand),
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    fileMenu,
    { role: "editMenu" },
    navigationMenu,
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
