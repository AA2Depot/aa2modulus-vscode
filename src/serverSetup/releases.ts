import { SUPPORTED_CONTRACT_VERSION } from '../server/serverFeatures';

/** The toolchain repository whose GitHub releases carry the server builds. */
export const RELEASE_REPOSITORY = 'AA2Depot/AA2Modulus';
export const RELEASES_PAGE = `https://github.com/${RELEASE_REPOSITORY}/releases`;
const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=30`;
/** The asset that states which client contract and features a release serves. */
const MANIFEST_ASSET = 'aa2modulus-manifest.json';
const MANIFEST_SCHEMA = 'aa2modulus.release-manifest.v1';

/** Which release asset fits a host, and the executable inside it. */
export interface ReleaseTarget {
  asset: string;
  executable: string;
}

/** The toolchain publishes x64 builds for Linux and Windows only. */
export function releaseTarget(platform: string, arch: string): ReleaseTarget | undefined {
  if (arch !== 'x64') {
    return undefined;
  }
  if (platform === 'linux') {
    return { asset: 'aa2modulus-linux-x64.zip', executable: 'aa2modulus' };
  }
  if (platform === 'win32') {
    return { asset: 'aa2modulus-windows-x64.zip', executable: 'aa2modulus.exe' };
  }
  return undefined;
}

/**
 * What a release manifest says about a release: `supported` serves this
 * extension's contract, `unsupported` another one, `unknown` has no readable
 * manifest.
 */
export type ReleaseCompatibility = 'supported' | 'unsupported' | 'unknown';

export interface ServerRelease {
  tag: string;
  name: string;
  prerelease: boolean;
  publishedAt?: string;
  pageUrl?: string;
  asset: {
    url: string;
    size: number;
    /** Lowercase hex SHA-256 of the zip, when GitHub reports one. */
    sha256?: string;
  };
  /** HTTPS URL of the release's `aa2modulus-manifest.json`, when it has one. */
  manifestUrl?: string;
  /** `unknown` until `fetchReleases` reads the manifest. */
  compatibility: ReleaseCompatibility;
}

/** A tag that is safe as one directory name on every platform. */
const SAFE_TAG = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

export function isSafeTag(tag: string): boolean {
  return SAFE_TAG.test(tag) && !tag.endsWith('.');
}

/**
 * The releases from a GitHub "list releases" response that carry `assetName`,
 * newest first. Drafts, malformed entries and tags unusable as directory names
 * are left out.
 */
export function parseReleases(body: unknown, assetName: string): ServerRelease[] {
  if (!Array.isArray(body)) {
    throw new Error('GitHub returned an unexpected releases response.');
  }
  const releases: ServerRelease[] = [];
  for (const entry of body) {
    const release = parseRelease(entry, assetName);
    if (release) {
      releases.push(release);
    }
  }
  return releases.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** One release entry, or undefined when it is a draft, malformed, unsafely tagged or lacks `assetName`. */
function parseRelease(entry: unknown, assetName: string): ServerRelease | undefined {
  if (!isRecord(entry) || entry.draft === true || typeof entry.tag_name !== 'string' || !isSafeTag(entry.tag_name)) {
    return undefined;
  }
  const asset = findAsset(entry.assets, assetName);
  if (!asset) {
    return undefined;
  }
  const release: ServerRelease = {
    tag: entry.tag_name,
    name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : entry.tag_name,
    prerelease: entry.prerelease === true,
    asset: {
      url: asset.browser_download_url,
      size: typeof asset.size === 'number' ? asset.size : 0
    },
    compatibility: 'unknown'
  };
  const manifest = findAsset(entry.assets, MANIFEST_ASSET);
  if (manifest) {
    release.manifestUrl = manifest.browser_download_url;
  }
  if (typeof entry.published_at === 'string') {
    release.publishedAt = entry.published_at;
  }
  if (typeof entry.html_url === 'string') {
    release.pageUrl = entry.html_url;
  }
  const digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest) : null;
  if (digest) {
    release.asset.sha256 = digest[1].toLowerCase();
  }
  return release;
}

/** The asset named `assetName` when it has an HTTPS download URL. */
function findAsset(
  assets: unknown,
  assetName: string
): (Record<string, unknown> & { browser_download_url: string }) | undefined {
  const asset = Array.isArray(assets)
    ? assets.find(candidate => isRecord(candidate) && candidate.name === assetName)
    : undefined;
  if (!isRecord(asset) || typeof asset.browser_download_url !== 'string'
    || !asset.browser_download_url.startsWith('https://')) {
    return undefined;
  }
  return asset as Record<string, unknown> & { browser_download_url: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Quick pick content for one release. */
export interface ReleaseChoice {
  label: string;
  description: string;
  detail: string;
}

export function describeRelease(release: ServerRelease, installedTag: string | undefined): ReleaseChoice {
  const notes: string[] = [];
  if (release.prerelease) {
    notes.push('Pre-release');
  }
  if (release.tag === installedTag) {
    notes.push('Installed');
  }
  if (release.compatibility === 'unknown') {
    notes.push('Compatibility unknown');
  }
  const detail: string[] = [];
  if (release.name !== release.tag) {
    detail.push(release.name);
  }
  if (release.publishedAt) {
    detail.push('Published ' + release.publishedAt.slice(0, 10));
  }
  if (release.asset.size > 0) {
    detail.push((release.asset.size / (1024 * 1024)).toFixed(1) + ' MB');
  }
  return { label: release.tag, description: notes.join(' · '), detail: detail.join(' · ') };
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const API_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'aa2m-vscode'
};

/**
 * Lists the toolchain releases that carry `assetName`, each judged by its
 * manifest. Releases whose manifest names an unsupported contract are left out;
 * releases without a readable manifest stay, marked `unknown`.
 */
export async function fetchReleases(fetch: Fetch, assetName: string, signal?: AbortSignal): Promise<ServerRelease[]> {
  const response = await fetch(RELEASES_API, { headers: API_HEADERS, signal });
  if (!response.ok) {
    throw new Error(describeHttpFailure(response, 'list the aa2modulus releases'));
  }
  const releases = parseReleases(await response.json(), assetName);
  await Promise.all(releases.map(async release => {
    release.compatibility = await fetchCompatibility(fetch, release, signal);
  }));
  return releases.filter(release => release.compatibility !== 'unsupported');
}

/**
 * The compatibility a release manifest states. Anything but a manifest of the
 * known schema with an integer `contractVersion` is `unknown`.
 */
export function manifestCompatibility(body: unknown): ReleaseCompatibility {
  if (!isRecord(body) || body.schema !== MANIFEST_SCHEMA || !Number.isInteger(body.contractVersion)) {
    return 'unknown';
  }
  return body.contractVersion === SUPPORTED_CONTRACT_VERSION ? 'supported' : 'unsupported';
}

/** Reads one release's manifest; a missing or failed manifest only makes the release `unknown`. */
async function fetchCompatibility(
  fetch: Fetch,
  release: ServerRelease,
  signal?: AbortSignal
): Promise<ReleaseCompatibility> {
  if (release.manifestUrl === undefined) {
    return 'unknown';
  }
  try {
    const response = await fetch(release.manifestUrl, { headers: { 'User-Agent': API_HEADERS['User-Agent'] }, signal });
    return response.ok ? manifestCompatibility(await response.json()) : 'unknown';
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    // The zip itself stays verifiable; only the judgement is lost.
    return 'unknown';
  }
}

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Bytes received so far and the expected total (0 when unknown). */
  onProgress?: (received: number, total: number) => void;
  maxBytes?: number;
}

/** Downloads `url` into memory. */
export async function download(fetch: Fetch, url: string, options: DownloadOptions = {}): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  const response = await fetch(url, { headers: { 'User-Agent': API_HEADERS['User-Agent'] }, signal: options.signal });
  if (!response.ok || !response.body) {
    throw new Error(describeHttpFailure(response, 'download ' + url));
  }
  const total = Number(response.headers.get('content-length') ?? 0) || 0;
  if (total > maxBytes) {
    throw new Error(`The download is larger than ${maxBytes} bytes.`);
  }
  const chunks: Buffer[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(`The download is larger than ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
    options.onProgress?.(received, total);
  }
  return Buffer.concat(chunks);
}

function describeHttpFailure(response: Response, action: string): string {
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    return `Could not ${action}: the GitHub API rate limit is reached. Try again later.`;
  }
  return `Could not ${action}: HTTP ${response.status}${response.statusText ? ' ' + response.statusText : ''}.`;
}
