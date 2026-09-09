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
 * Fetch platform download links from the latest packaged GitHub release at build
 * time (Next.js Server Component / SSG). The GitHub API is only called during
 * `next build` (and optional ISR revalidation); the rendered page is static and
 * makes no runtime API requests, so a static host is fine.
 *
 * Each release ships a fixed set of asset names (see release-tauri.yml). We
 * match those by suffix and map them to Tauri-style platform cards.
 */
const OWNER = "zjy365";
const REPO = "aster";
const GITHUB_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;

const ASSET_PATTERNS: {
  id: string;
  os: Release["os"];
  meta: string;
  match: RegExp;
  primary?: boolean;
}[] = [
  {
    id: "macos-arm64",
    os: "macOS",
    meta: "Apple Silicon · .dmg",
    match: /_arm64\.dmg$/,
    primary: true,
  },
  {
    id: "macos-x64",
    os: "macOS",
    meta: "Intel · .dmg",
    match: /_x64\.dmg$/,
  },
  {
    id: "windows",
    os: "Windows",
    meta: "x64 · .msi",
    match: /_x64_en-US\.msi$|_x64\.msi$/,
  },
  {
    id: "linux",
    os: "Linux",
    meta: "x64 · AppImage",
    match: /_amd64\.AppImage$/,
  },
];

export type ReleasesResult = {
  /** Semver without the leading "v", e.g. "1.0.0". */
  version: string;
  releases: Release[];
};

type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
};

async function fetchReleases<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} for ${url}`);
  }
  return res.json();
}

function platformDownloads(release: GitHubRelease): ReleasesResult {
  const version = release.tag_name.replace(/^v/, "");

  const releases: Release[] = [];
  for (const pattern of ASSET_PATTERNS) {
    const asset = release.assets.find((a) => pattern.match.test(a.name));
    if (!asset) continue;
    releases.push({
      id: pattern.id,
      os: pattern.os,
      meta: `${pattern.meta} · v${version}`,
      href: asset.browser_download_url,
      primary: pattern.primary,
    });
  }
  return { version, releases };
}

export async function getReleases(): Promise<ReleasesResult> {
  const latest = platformDownloads(await fetchReleases<GitHubRelease>(`${GITHUB_API}/latest`));
  if (latest.releases.length > 0) return latest;

  // A published release may have no installers (for example, a failed build).
  // Walk the release history until a stable version has a supported installer.
  for (let page = 1; ; page++) {
    const history = await fetchReleases<GitHubRelease[]>(`${GITHUB_API}?per_page=100&page=${page}`);
    for (const release of history) {
      if (release.draft || release.prerelease) continue;
      const downloads = platformDownloads(release);
      if (downloads.releases.length > 0) return downloads;
    }
    if (history.length < 100) return latest;
  }
}
