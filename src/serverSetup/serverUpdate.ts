// Whether a newer supported aa2modulus release exists than the running
// server. This compares `serverInfo.version` with release tags for a notice
// only; compatibility still comes from the advertised capabilities.
import type { ServerRelease } from './releases';

/** A release version, `major.minor.patch`. */
export type ReleaseVersion = readonly [number, number, number];

/** How long the result of one release listing is reused. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The outcome of the last release listing, kept in `globalState` between sessions. */
export interface UpdateCheckRecord {
  /** When the releases were listed, in milliseconds since the epoch. */
  checkedAt: number;
  /** The newest supported release then; undefined when there was none. */
  tag?: string;
  pageUrl?: string;
}

/**
 * Reads `0.2.1` or `v0.2.1`. Anything else, such as a development build's
 * `0.2.2.dev3`, is undefined: such a server is not compared with releases.
 */
export function parseReleaseVersion(text: string | undefined): ReleaseVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text?.trim() ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compareVersions(a: ReleaseVersion, b: ReleaseVersion): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The supported release with the highest tag version; releases with other tags are ignored. */
export function newestSupportedRelease(releases: readonly ServerRelease[]): ServerRelease | undefined {
  let newest: { release: ServerRelease; version: ReleaseVersion } | undefined;
  for (const release of releases) {
    const version = parseReleaseVersion(release.tag);
    if (release.compatibility === 'supported' && version && (!newest || compareVersions(version, newest.version) > 0)) {
      newest = { release, version };
    }
  }
  return newest?.release;
}

/** The record of a check made at `now` that found `release`. */
export function recordCheck(now: number, release: ServerRelease | undefined): UpdateCheckRecord {
  const record: UpdateCheckRecord = { checkedAt: now };
  if (release) {
    record.tag = release.tag;
  }
  if (release?.pageUrl) {
    record.pageUrl = release.pageUrl;
  }
  return record;
}

/** Validates a stored record; anything malformed is undefined, so a new check runs. */
export function readUpdateCheckRecord(value: unknown): UpdateCheckRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { checkedAt, tag, pageUrl } = value as Record<string, unknown>;
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) {
    return undefined;
  }
  const record: UpdateCheckRecord = { checkedAt };
  if (typeof tag === 'string') {
    record.tag = tag;
  }
  if (typeof pageUrl === 'string' && pageUrl.startsWith('https://')) {
    record.pageUrl = pageUrl;
  }
  return record;
}

/** No record, or one older than `UPDATE_CHECK_INTERVAL_MS` (or from the future): list the releases again. */
export function isCheckDue(record: UpdateCheckRecord | undefined, now: number): boolean {
  return record === undefined || now - record.checkedAt >= UPDATE_CHECK_INTERVAL_MS || record.checkedAt > now;
}

/** The release to offer: the recorded one when it is newer than `serverVersion`. */
export function availableUpdate(
  serverVersion: string | undefined,
  record: UpdateCheckRecord | undefined
): UpdateCheckRecord | undefined {
  const running = parseReleaseVersion(serverVersion);
  const newest = parseReleaseVersion(record?.tag);
  return running && newest && compareVersions(newest, running) > 0 ? record : undefined;
}
