const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ARCH_NAMES = new Map([
  [0, "386"],
  [1, "amd64"],
  [2, "arm"],
  [3, "arm64"],
]);

module.exports = async function beforePack(context) {
  const goarch = ARCH_NAMES.get(context.arch);
  if (!goarch) throw new Error(`Unsupported Aster target architecture: ${context.arch}`);

  const goos = context.electronPlatformName === "win32" ? "windows" : context.electronPlatformName;
  const archName = goarch === "amd64" ? "x64" : goarch === "386" ? "ia32" : goarch;
  const coreRoot = path.resolve(context.packager.projectDir, "../../core");
  const targetDir = path.join(coreRoot, "bin", archName);
  const target = path.join(targetDir, goos === "windows" ? "aster-core.exe" : "aster-core");

  fs.mkdirSync(targetDir, { recursive: true });
  execFileSync("go", ["build", "-trimpath", "-o", target, "./cmd/aster-core"], {
    cwd: coreRoot,
    env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
    stdio: "inherit",
  });
};
