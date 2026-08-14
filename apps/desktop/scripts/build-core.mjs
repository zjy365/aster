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
