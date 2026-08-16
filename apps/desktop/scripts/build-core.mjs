import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const coreRoot = path.resolve(desktopRoot, "../../core");
const hostArch = process.arch === "x64" ? "x64" : "arm64";
const targetDir = path.join(coreRoot, "bin", hostArch);
const target = path.join(targetDir, process.platform === "win32" ? "aster-core.exe" : "aster-core");
fs.mkdirSync(targetDir, { recursive: true });
execFileSync("go", ["build", "-trimpath", "-o", target, "./cmd/aster-core"], {
  cwd: coreRoot,
  env: { ...process.env, CGO_ENABLED: "0" },
  stdio: "inherit",
});

// Tauri's externalBin convention: binaries/aster-core-<target-triple>[.exe].
// CARGO_BUILD_TARGET overrides the triple for cross builds in CI.
const RUST_TRIPLES = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};
const triple = process.env.CARGO_BUILD_TARGET || RUST_TRIPLES[`${process.platform}-${process.arch}`];
if (triple) {
  const binariesDir = path.join(desktopRoot, "src-tauri", "binaries");
  fs.mkdirSync(binariesDir, { recursive: true });
  const sidecarName = `aster-core-${triple}${triple.includes("windows") ? ".exe" : ""}`;
  fs.copyFileSync(target, path.join(binariesDir, sidecarName));
}
