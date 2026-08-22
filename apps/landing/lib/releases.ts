export type Release = {
  /** Stable key for React reconciliation; "os" alone collides for two macOS cards. */
  id: string;
  os: "macOS" | "Windows" | "Linux";
  /** Architecture label shown under the OS name, e.g. "Apple Silicon · .dmg". */
  meta: string;
  href: string;
  primary?: boolean;
};

/**
 * Populated when the first GitHub release ships (see spec §6.4). While this
 * array is empty the download section renders the honest "unreleased" card.
 *
 * Update this file after each release: bump the version in the asset URLs and
 * keep one entry per platform/arch combination that the release ships.
 */
export const releases: Release[] = [
  {
    id: "macos-arm64",
    os: "macOS",
    meta: "Apple Silicon · v1.0.0 · .dmg",
    href: "https://github.com/zjy365/aster/releases/download/v1.0.0/Aster_1.0.0_arm64.dmg",
    primary: true,
  },
  {
    id: "macos-x64",
    os: "macOS",
    meta: "Intel · v1.0.0 · .dmg",
    href: "https://github.com/zjy365/aster/releases/download/v1.0.0/Aster_1.0.0_x64.dmg",
  },
  {
    id: "windows",
    os: "Windows",
    meta: "x64 · v1.0.0 · .msi",
    href: "https://github.com/zjy365/aster/releases/download/v1.0.0/Aster_1.0.0_x64_en-US.msi",
  },
  {
    id: "linux",
    os: "Linux",
    meta: "x64 · v1.0.0 · AppImage",
    href: "https://github.com/zjy365/aster/releases/download/v1.0.0/Aster_1.0.0_amd64.AppImage",
  },
];
