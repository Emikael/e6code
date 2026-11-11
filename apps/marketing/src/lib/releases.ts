const REPO = "Emikael/e6code";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const NIGHTLY_RELEASES_URL = `${RELEASES_URL}?q=nightly&expanded=true`;

const LATEST_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
// The `latest` endpoint skips prereleases, so nightly needs the list. GitHub
// returns it newest first and nightlies land several times a day, so the first
// nightly tag in a small page is the current build.
const LIST_API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;

export type ReleaseChannel = "stable" | "nightly";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

function cacheKey(channel: ReleaseChannel) {
  return `e6code-${channel}-release`;
}

async function fetchStable(): Promise<Release> {
  return fetch(LATEST_API_URL).then((r) => r.json());
}

async function fetchNightly(): Promise<Release> {
  const list: Release[] = await fetch(LIST_API_URL).then((r) => r.json());
  const nightly = Array.isArray(list)
    ? list.find((release) => release.tag_name?.includes("-nightly."))
    : undefined;
  if (!nightly) throw new Error("No nightly release in the latest page");
  return nightly;
}

export async function fetchLatestRelease(channel: ReleaseChannel = "stable"): Promise<Release> {
  const key = cacheKey(channel);
  const cached = sessionStorage.getItem(key);
  if (cached) return JSON.parse(cached);

  const data = channel === "nightly" ? await fetchNightly() : await fetchStable();

  if (data?.assets) {
    sessionStorage.setItem(key, JSON.stringify(data));
  }

  return data;
}

export interface ReleaseSummary {
  version: string;
  publishedAt: Date;
}

/**
 * The latest stable release, read once when the site is built. Returns null when
 * GitHub cannot be reached so a build without network still succeeds; callers
 * leave the version out in that case.
 */
export async function fetchLatestReleaseAtBuild(): Promise<ReleaseSummary | null> {
  try {
    const response = await fetch(LATEST_API_URL);
    if (!response.ok) return null;
    const release: Partial<Release> = await response.json();
    if (!release.tag_name || !release.published_at) return null;
    return { version: release.tag_name, publishedAt: new Date(release.published_at) };
  } catch {
    return null;
  }
}
