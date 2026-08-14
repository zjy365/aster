import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STARTUP_WINDOW_MS = 6_000;
const SHUTDOWN_GRACE_MS = 2_000;
const MAX_CAPTURED_OUTPUT = 128 * 1024;
const desktopRoot = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(desktopRoot, "release");

await runPackagedSmoke();

async function runPackagedSmoke() {
  const executable = await resolveExecutable();
  const isolatedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "aster-packaged-smoke-"));
  let application;

  try {
    application = launchApplication(executable, isolatedRoot);
    const transcript = captureOutput(application);
    const launchResult = await watchLaunch(application, STARTUP_WINDOW_MS);

    if (launchResult.kind === "interrupted") {
      process.exitCode = launchResult.signal === "SIGINT" ? 130 : 143;
      console.warn(`Packaged Aster smoke check interrupted by ${launchResult.signal}.`);
      return;
    }

    if (launchResult.kind === "spawn-error") {
      throw new Error(
        `Could not launch packaged Aster at ${executable}: ${formatError(launchResult.error)}\n${transcript.read()}`,
      );
    }

    if (launchResult.kind === "early-exit") {
      const exitDescription = launchResult.signal
        ? `signal ${launchResult.signal}`
        : `exit code ${String(launchResult.code)}`;
      throw new Error(
        `Packaged Aster stopped during the ${STARTUP_WINDOW_MS / 1_000}-second startup check (${exitDescription}).\n${transcript.read()}`,
      );
    }

    console.log(
      `Packaged Aster stayed running for ${STARTUP_WINDOW_MS / 1_000} seconds: ${executable}`,
    );
  } finally {
    if (application) {
      await stopApplication(application);
    }
    await removeIsolatedData(isolatedRoot);
  }
}

function launchApplication(executable, isolatedRoot) {
  return spawn(executable, [], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ASTER_DESKTOP_USER_DATA: path.join(isolatedRoot, "desktop-data"),
      ELECTRON_ENABLE_LOGGING: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function watchLaunch(application, durationMs) {
  return new Promise((resolve) => {
    const finish = (result) => {
      clearTimeout(timer);
      application.off("error", onError);
      application.off("exit", onExit);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      resolve(result);
    };
    const onError = (error) => finish({ kind: "spawn-error", error });
    const onExit = (code, signal) => finish({ kind: "early-exit", code, signal });
    const onInterrupt = () => finish({ kind: "interrupted", signal: "SIGINT" });
    const onTerminate = () => finish({ kind: "interrupted", signal: "SIGTERM" });
    const timer = setTimeout(() => finish({ kind: "running" }), durationMs);

    application.once("error", onError);
    application.once("exit", onExit);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
  });
}

function captureOutput(application) {
  let captured = "";
  let discardedPrefix = false;

  const append = (chunk) => {
    captured += chunk.toString();
    if (captured.length > MAX_CAPTURED_OUTPUT) {
      captured = captured.slice(-MAX_CAPTURED_OUTPUT);
      discardedPrefix = true;
    }
  };

  application.stdout.on("data", append);
  application.stderr.on("data", append);

  return {
    read() {
      if (!captured) {
        return "No process output was captured.";
      }
      return discardedPrefix ? `[earlier output omitted]\n${captured}` : captured;
    },
  };
}

async function stopApplication(application) {
  if (hasExited(application) || !Number.isInteger(application.pid)) {
    return;
  }

  if (process.platform === "win32") {
    await stopWindowsProcessTree(application);
  } else {
    signalUnixProcessTree(application, "SIGTERM");
  }

  if (await exitsWithin(application, SHUTDOWN_GRACE_MS)) {
    return;
  }

  if (process.platform === "win32") {
    application.kill("SIGKILL");
  } else {
    signalUnixProcessTree(application, "SIGKILL");
  }

  if (!(await exitsWithin(application, SHUTDOWN_GRACE_MS))) {
    console.warn(`Packaged Aster process ${application.pid} did not report an exit after termination.`);
  }
}

async function stopWindowsProcessTree(application) {
  try {
    const taskkill = spawn("taskkill", ["/pid", String(application.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForCommand(taskkill);
  } catch (error) {
    console.warn(`Could not terminate the packaged Aster process tree: ${formatError(error)}`);
    application.kill();
  }
}

function signalUnixProcessTree(application, signal) {
  try {
    process.kill(-application.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.warn(`Could not send ${signal} to packaged Aster: ${formatError(error)}`);
    }
  }
}

function exitsWithin(application, durationMs) {
  if (hasExited(application)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const finish = (didExit) => {
      clearTimeout(timer);
      application.off("exit", onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), durationMs);

    application.once("exit", onExit);
  });
}

function hasExited(application) {
  return application.exitCode !== null || application.signalCode !== null;
}

function waitForCommand(command) {
  return new Promise((resolve, reject) => {
    command.once("error", reject);
    command.once("exit", (code) => {
      if (code === 0 || code === 128) {
        resolve();
      } else {
        reject(new Error(`taskkill exited with code ${String(code)}`));
      }
    });
  });
}

async function removeIsolatedData(isolatedRoot) {
  const retryDelays = [0, 100, 250, 500, 1_000];
  let lastError;

  for (const delay of retryDelays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fsp.rm(isolatedRoot, { force: true, recursive: true });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  // Chromium may briefly retain profile files after its main process exits,
  // especially on Windows. The launch result is more important than this
  // best-effort cleanup, but make the leftover location visible.
  console.warn(`Could not remove packaged smoke data at ${isolatedRoot}: ${formatError(lastError)}`);
}

async function resolveExecutable() {
  const architecture = selectArchitecture();
  const candidates = executableCandidates(process.platform, architecture);

  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a packaged Aster executable for ${process.platform}/${architecture}. Checked:\n${candidates.join("\n")}`,
  );
}

function selectArchitecture() {
  const requested = process.env.ASTER_PACKAGED_ARCH;
  if (requested === undefined || requested === "") {
    return process.arch === "arm64" ? "arm64" : "x64";
  }
  if (requested === "arm64" || requested === "x64") {
    return requested;
  }
  throw new Error(`ASTER_PACKAGED_ARCH must be "arm64" or "x64", received ${JSON.stringify(requested)}.`);
}

function executableCandidates(platform, architecture) {
  if (platform === "darwin") {
    const bundleExecutable = ["Aster.app", "Contents", "MacOS", "Aster"];
    const outputDirectories = architecture === "arm64"
      ? ["mac-arm64", "mac"]
      : ["mac", "mac-x64"];
    return outputDirectories.map((directory) => path.join(releaseRoot, directory, ...bundleExecutable));
  }

  if (platform === "win32") {
    return [path.join(releaseRoot, "win-unpacked", "Aster.exe")];
  }

  return [
    path.join(releaseRoot, "linux-unpacked", "aster"),
    path.join(releaseRoot, "linux-unpacked", "Aster"),
  ];
}

async function isFile(candidate) {
  try {
    return (await fsp.stat(candidate)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw new Error(`Could not inspect packaged executable candidate ${candidate}: ${formatError(error)}`);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
