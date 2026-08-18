export type Release = {
  os: "macOS" | "Windows" | "Linux";
  meta: string; // e.g. "v0.1.0 · Apple Silicon & Intel · .dmg"
  href: string;
  primary?: boolean;
};

/**
 * Populated when the first GitHub release ships (see spec §6.4). While this
 * array is empty the download section renders the honest "unreleased" card.
 */
export const releases: Release[] = [];
