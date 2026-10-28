import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeRelease, download, type Fetch, fetchReleases, manifestCompatibility, parseReleases, releaseTarget,
  type ServerRelease
} from '../../../src/serverSetup/releases';

const LINUX = 'aa2modulus-linux-x64.zip';
const MANIFEST = 'aa2modulus-manifest.json';
const manifestUrl = (tag: string) => `https://github.com/dl/${tag}/${MANIFEST}`;

/** A release manifest stating `contractVersion`. */
function manifest(contractVersion: unknown) {
  return { schema: 'aa2modulus.release-manifest.v1', version: '9.9.9', contractVersion, platforms: ['linux-x64'] };
}

function githubRelease(tag: string, overrides: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T00:00:00Z',
    html_url: `https://github.com/AA2Depot/AA2Modulus/releases/tag/${tag}`,
    assets: [
      { name: LINUX, size: 2 * 1024 * 1024, browser_download_url: `https://github.com/dl/${tag}/${LINUX}` },
      { name: 'aa2modulus-windows-x64.zip', size: 1, browser_download_url: `https://github.com/dl/${tag}/win.zip` },
      { name: MANIFEST, size: 1, browser_download_url: manifestUrl(tag) }
    ],
    ...overrides
  };
}

test('only Linux and Windows x64 hosts have a release asset', () => {
  assert.deepEqual(releaseTarget('linux', 'x64'), { asset: LINUX, executable: 'aa2modulus' });
  assert.deepEqual(releaseTarget('win32', 'x64'), { asset: 'aa2modulus-windows-x64.zip', executable: 'aa2modulus.exe' });
  assert.equal(releaseTarget('darwin', 'x64'), undefined);
  assert.equal(releaseTarget('linux', 'arm64'), undefined);
});

test('releases keep pre-releases, drop drafts and releases without the asset, newest first', () => {
  const releases = parseReleases([
    githubRelease('v0.1.0', { prerelease: true, published_at: '2026-10-23T00:00:00Z' }),
    githubRelease('v0.2.0-rc.1', { prerelease: true, published_at: '2026-11-01T00:00:00Z', name: ' Release candidate ' }),
    githubRelease('v0.0.9', { published_at: '2026-09-01T00:00:00Z', assets: [] }),
    githubRelease('v0.3.0', { draft: true }),
    githubRelease('../escape'),
    githubRelease('v0.1.1', { assets: [{ name: LINUX, browser_download_url: 'http://insecure/zip' }] }),
    'garbage',
    null
  ], LINUX);
  assert.deepEqual(releases.map(release => [release.tag, release.prerelease, release.name]), [
    ['v0.2.0-rc.1', true, 'Release candidate'],
    ['v0.1.0', true, 'v0.1.0']
  ]);
  assert.equal(releases[1].asset.url, `https://github.com/dl/v0.1.0/${LINUX}`);
  assert.equal(releases[1].manifestUrl, manifestUrl('v0.1.0'));
  assert.equal(releases[1].compatibility, 'unknown', 'parsing alone judges nothing');
  assert.throws(() => parseReleases({ message: 'Not Found' }, LINUX), /unexpected releases response/);
});

test('a GitHub sha256 digest is kept in lowercase; other digests are ignored', () => {
  const hex = 'AB'.repeat(32);
  const [withDigest] = parseReleases([githubRelease('v1.0.0', {
    assets: [{ name: LINUX, size: 1, browser_download_url: 'https://x/zip', digest: 'sha256:' + hex }]
  })], LINUX);
  assert.equal(withDigest.asset.sha256, hex.toLowerCase());
  const [otherDigest] = parseReleases([githubRelease('v1.0.0', {
    assets: [{ name: LINUX, size: 1, browser_download_url: 'https://x/zip', digest: 'md5:00' }]
  })], LINUX);
  assert.equal(otherDigest.asset.sha256, undefined);
});

test('the release picker marks pre-releases, the installed tag and unknown compatibility', () => {
  const base: ServerRelease = {
    tag: 'v0.2.0-rc.1',
    name: 'Release candidate',
    prerelease: true,
    publishedAt: '2026-11-01T10:00:00Z',
    asset: { url: 'https://x', size: 3 * 1024 * 1024 },
    compatibility: 'supported'
  };
  assert.deepEqual(describeRelease(base, 'v0.2.0-rc.1'), {
    label: 'v0.2.0-rc.1',
    description: 'Pre-release · Installed',
    detail: 'Release candidate · Published 2026-11-01 · 3.0 MB'
  });
  assert.deepEqual(describeRelease({ ...base, tag: 'v1.0.0', name: 'v1.0.0', prerelease: false }, undefined), {
    label: 'v1.0.0',
    description: '',
    detail: 'Published 2026-11-01 · 3.0 MB'
  });
  assert.equal(describeRelease({ ...base, prerelease: false, compatibility: 'unknown' }, undefined).description,
    'Compatibility unknown');
});

test('a manifest is judged by its contract version; anything else is unknown', () => {
  assert.equal(manifestCompatibility(manifest(2)), 'supported');
  assert.equal(manifestCompatibility(manifest(3)), 'unsupported', 'a newer contract is a breaking change');
  assert.equal(manifestCompatibility(manifest(1)), 'unsupported');
  for (const body of [manifest('2'), manifest(undefined), { ...manifest(2), schema: 'other' }, null, []]) {
    assert.equal(manifestCompatibility(body), 'unknown', JSON.stringify(body));
  }
});

test('listing drops releases with an unsupported contract and keeps those without a readable manifest', async () => {
  const noManifest = githubRelease('v0.0.5', { assets: [{ name: LINUX, size: 1, browser_download_url: 'https://x/zip' }] });
  const manifests: Record<string, Response | Error> = {
    [manifestUrl('v0.3.0')]: Response.json(manifest(3)),
    [manifestUrl('v0.2.0')]: Response.json(manifest(2)),
    [manifestUrl('v0.1.0')]: Response.json(manifest(1)),
    [manifestUrl('v0.0.9')]: new Response('missing', { status: 404 }),
    [manifestUrl('v0.0.8')]: new Error('network down')
  };
  const serve: Fetch = async url => {
    if (url.startsWith('https://api.github.com/')) {
      return Response.json(['v0.3.0', 'v0.2.0', 'v0.1.0', 'v0.0.9', 'v0.0.8'].map(tag => githubRelease(tag)).concat(noManifest));
    }
    const answer = manifests[url];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  const releases = await fetchReleases(serve, LINUX);
  assert.deepEqual(releases.map(release => [release.tag, release.compatibility]), [
    ['v0.2.0', 'supported'], ['v0.0.9', 'unknown'], ['v0.0.8', 'unknown'], ['v0.0.5', 'unknown']
  ]);
});

test('listing asks the GitHub API and explains rate limits', async () => {
  let requested = '';
  const ok: Fetch = async (url, init) => {
    if (url === manifestUrl('v0.1.0')) {
      return Response.json(manifest(2));
    }
    requested = url;
    assert.equal(new Headers(init?.headers).get('accept'), 'application/vnd.github+json');
    return Response.json([githubRelease('v0.1.0')]);
  };
  assert.equal((await fetchReleases(ok, LINUX)).length, 1);
  assert.match(requested, /^https:\/\/api\.github\.com\/repos\/AA2Depot\/AA2Modulus\/releases/);

  const limited: Fetch = async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  await assert.rejects(fetchReleases(limited, LINUX), /rate limit/);
  const missing: Fetch = async () => new Response('{}', { status: 404, statusText: 'Not Found' });
  await assert.rejects(fetchReleases(missing, LINUX), /HTTP 404 Not Found/);
});

test('downloads report progress and stop at the size limit', async () => {
  const body = Buffer.alloc(1000, 7);
  const serve: Fetch = async () => new Response(body, { headers: { 'content-length': String(body.length) } });
  const progress: [number, number][] = [];
  const data = await download(serve, 'https://x/zip', { onProgress: (received, total) => progress.push([received, total]) });
  assert.deepEqual(data, body);
  assert.deepEqual(progress.at(-1), [1000, 1000]);

  await assert.rejects(download(serve, 'https://x/zip', { maxBytes: 999 }), /larger than 999 bytes/);
  const unsized: Fetch = async () => new Response(new Blob([body]).stream());
  await assert.rejects(download(unsized, 'https://x/zip', { maxBytes: 999 }), /larger than 999 bytes/);
  const failing: Fetch = async () => new Response(null, { status: 502 });
  await assert.rejects(download(failing, 'https://x/zip'), /HTTP 502/);
});

test('an aborted download rejects', async () => {
  const controller = new AbortController();
  const hanging: Fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const pending = download(hanging, 'https://x/zip', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
});
