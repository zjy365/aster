import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CoreStatus } from "../shared/types";

export interface ReadyMessage {
  type: "ready";
  address: string;
  port: number;
}

/** Parses the first stdout line of the sidecar. Pure so the contract is testable. */
export function parseReadyMessage(line: string): ReadyMessage {
  const ready = JSON.parse(line) as ReadyMessage;
  if (ready.type !== "ready" || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65_535) {
    throw new Error("invalid ready payload");
  }
  return ready;
}

export interface SidecarPaths {
  isPackaged: boolean;
  resourcesPath: string;
  currentDirectory: string;
  arch: string;
  platform: NodeJS.Platform;
}

export function sidecarExecutablePath(paths: SidecarPaths): string {
  if (paths.isPackaged) return path.join(paths.resourcesPath, "core", executableName(paths.platform));
  return path.resolve(paths.currentDirectory, "../../../../core/bin", paths.arch === "x64" ? "x64" : "arm64", executableName(paths.platform));
}

function executableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "aster-core.exe" : "aster-core";
}

export interface SidecarOptions {
  executablePath: () => string;
  spawnProcess?: (executable: string, env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
  readyTimeoutMs?: number;
  version?: () => string;
}

/**
 * Owns the Go sidecar process, its bearer token, and its loopback base URL.
 * The token never leaves this module; consumers ask for credentials() per
 * request so a restarting sidecar cannot leak stale authorization.
 */
export class Sidecar {
  private child?: ChildProcessWithoutNullStreams;
  private token = "";
  private baseUrl = "";
  private currentStatus: CoreStatus = { state: "stopped" };
  private stopping = false;
  private readonly statusListeners = new Set<(status: CoreStatus) => void>();
  private readonly exitListeners = new Set<() => void>();

  constructor(private readonly options: SidecarOptions) {}

  get status(): CoreStatus {
    return this.currentStatus;
  }

  onStatus(listener: (status: CoreStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Fires when the child process exits, expected or not. */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  credentials(): { baseUrl: string; token: string } {
    if (this.currentStatus.state !== "ready" || !this.baseUrl) {
      throw new Error(this.currentStatus.message || "Aster core is not ready");
    }
    return { baseUrl: this.baseUrl, token: this.token };
  }

  async start(): Promise<void> {
    if (this.child) return;
    const executable = this.options.executablePath();
    if (!fs.existsSync(executable)) throw new Error(`Aster core is missing at ${executable}`);
    this.token = randomBytes(32).toString("hex");
    this.setStatus({ state: "starting" });

    const spawnProcess = this.options.spawnProcess
      ?? ((file: string, env: NodeJS.ProcessEnv) => spawn(file, [], { env, stdio: ["pipe", "pipe", "pipe"] }));
    const readyTimeoutMs = this.options.readyTimeoutMs ?? 10_000;

    await new Promise<void>((resolve, reject) => {
      const child = spawnProcess(executable, { ...process.env, ASTER_BOOTSTRAP_TOKEN: this.token });
      child.stdin.end();
      this.child = child;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Aster core did not become ready within 10 seconds")), readyTimeoutMs);

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.child = undefined;
        this.baseUrl = "";
        this.token = "";
        this.setStatus({ state: "error", message: error.message });
        child.kill();
        reject(error);
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        const newline = stdout.indexOf("\n");
        if (newline < 0 || settled) return;
        const line = stdout.slice(0, newline).trim();
        try {
          const ready = parseReadyMessage(line);
          settled = true;
          clearTimeout(timeout);
          this.baseUrl = `http://127.0.0.1:${ready.port}`;
          this.setStatus({ state: "ready", version: this.options.version?.() });
          resolve();
        } catch (cause) {
          fail(new Error(`Aster core returned invalid readiness data: ${cause instanceof Error ? cause.message : String(cause)}`));
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-8_000);
      });
      child.once("error", (error) => fail(error));
      child.once("exit", (code, signal) => {
        const expected = this.stopping;
        for (const listener of this.exitListeners) listener();
        this.child = undefined;
        this.baseUrl = "";
        this.token = "";
        if (!settled) {
          fail(new Error(`Aster core exited before ready (${code ?? signal ?? "unknown"}). ${stderr}`.trim()));
          return;
        }
        if (!expected) this.setStatus({ state: "error", message: `Core stopped unexpectedly (${code ?? signal ?? "unknown"})` });
        else this.setStatus({ state: "stopped" });
      });
    });
  }

  stop(): void {
    this.stopping = true;
    for (const listener of this.exitListeners) listener();
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.baseUrl = "";
    this.token = "";
    this.setStatus({ state: "stopped" });
  }

  private setStatus(status: CoreStatus): void {
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
