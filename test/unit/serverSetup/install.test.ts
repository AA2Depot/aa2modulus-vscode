import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
// jszip is `export =`; only this form keeps its constructor without esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import JSZip = require('jszip');
import {
  installedTag, installRelease, parseChecksums, pruneInstalls, sha256, verifyRelease
} from '../../../src/serverSetup/install';
import { extensionRoot } from '../../support/paths';

// Made by the tools the toolchain's release workflow uses: Info-ZIP `zip -j`
// (Linux) and Windows PowerShell `Compress-Archive` (Windows).
const fixture = (name: string) => readFileSync(join(extensionRoot, 'test', 'fixtures', 'releases', name));
const linuxZip = fixture('aa2modulus-linux-x64.zip');
const windowsZip = fixture('aa2modulus-windows-x64.zip');

const scratch = mkdtempSync(join(tmpdir(), 'aa2m-install-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let rootCount = 0;
const freshRoot = () => join(scratch, 'root-' + rootCount++);

async function makeZip(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) {
    zip.file(name, data);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function release(executable: string, content = 'server', extra: Record<string, string> = {}): Promise<Buffer> {
  return makeZip({ [executable]: content, SHA256SUMS: `${sha256(Buffer.from(content))}  ${executable}\n`, ...extra });
}

test('checksum files parse in sha256sum text and binary forms', () => {
  const hash = 'A'.repeat(64);
  const sums = parseChecksums(`${hash}  aa2modulus\r\n${'b'.repeat(64)} *aa2modulus.exe\n\nnot a line\n`);
  assert.deepEqual([...sums], [['aa2modulus', 'a'.repeat(64)], ['aa2modulus.exe', 'b'.repeat(64)]]);
});

test('release zips from Info-ZIP and Compress-Archive verify', async () => {
  const linux = await verifyRelease(linuxZip, 'aa2modulus', sha256(linuxZip));
  assert.deepEqual(linux.files.map(file => file.name).sort(), ['README.txt', 'SHA256SUMS', 'aa2modulus']);
  const windows = await verifyRelease(windowsZip, 'aa2modulus.exe');
  assert.deepEqual(windows.files.map(file => file.name).sort(), ['README.txt', 'SHA256SUMS', 'aa2modulus.exe']);
  assert.equal(linux.executableSha256, windows.executableSha256, 'both fixtures carry the same stand-in');
});

test('a zip that differs from the GitHub digest is refused', async () => {
  await assert.rejects(verifyRelease(linuxZip, 'aa2modulus', '0'.repeat(64)), /SHA-256 digest GitHub reports/);
});

test('an executable that differs from SHA256SUMS is refused', async () => {
  const zip = await makeZip({ aa2modulus: 'tampered', SHA256SUMS: `${sha256(Buffer.from('server'))}  aa2modulus\n` });
  await assert.rejects(verifyRelease(zip, 'aa2modulus'), /does not match its SHA-256/);
});

test('every file SHA256SUMS lists is checked, not only the executable', async () => {
  const zip = await makeZip({
    aa2modulus: 'server',
    'README.txt': 'changed',
    SHA256SUMS: `${sha256(Buffer.from('server'))}  aa2modulus\n${sha256(Buffer.from('original'))}  README.txt\n`
  });
  await assert.rejects(verifyRelease(zip, 'aa2modulus'), /README\.txt in the release zip does not match/);
});

test('a missing SHA256SUMS, executable or checksum line is refused', async () => {
  await assert.rejects(verifyRelease(await makeZip({ aa2modulus: 'server' }), 'aa2modulus'), /no SHA256SUMS/);
  await assert.rejects(verifyRelease(await release('aa2modulus'), 'aa2modulus.exe'), /does not list aa2modulus\.exe/);
  const listedOnly = await makeZip({ SHA256SUMS: `${sha256(Buffer.from('x'))}  aa2modulus\n` });
  await assert.rejects(verifyRelease(listedOnly, 'aa2modulus'), /does not contain aa2modulus/);
});

test('nested, traversing or duplicate names are refused', async () => {
  for (const name of ['../evil', 'bin/aa2modulus', 'dir\\file', 'C:evil']) {
    await assert.rejects(verifyRelease(await release('aa2modulus', 'server', { [name]: 'x' }), 'aa2modulus'),
      /unexpected path/, name);
  }
  await assert.rejects(verifyRelease(await release('aa2modulus', 'server', { 'readme.txt': 'a', 'README.TXT': 'b' }),
    'aa2modulus'), /twice/);
});

test('data that is not a zip is refused', async () => {
  await assert.rejects(verifyRelease(Buffer.from('<html>rate limited</html>'), 'aa2modulus'), /not a zip archive/);
  // Flip a byte in the first entry's compressed data, past its local header.
  const damaged = Buffer.from(linuxZip);
  damaged[30 + damaged.readUInt16LE(26) + damaged.readUInt16LE(28) + 10] ^= 0xff;
  await assert.rejects(verifyRelease(damaged, 'aa2modulus'), /damaged|does not match/);
});

test('install writes the tag directory, marks the executable and leaves no staging directory', async () => {
  const root = freshRoot();
  const verified = await verifyRelease(linuxZip, 'aa2modulus');
  const executable = await installRelease(root, 'v0.1.0', 'aa2modulus', verified, 'linux');
  assert.equal(executable, join(root, 'v0.1.0', 'aa2modulus'));
  assert.equal(sha256(readFileSync(executable)), verified.executableSha256);
  assert.ok(existsSync(join(root, 'v0.1.0', 'SHA256SUMS')));
  if (process.platform !== 'win32') {
    assert.equal(statSync(executable).mode & 0o111, 0o111);
  }
  assert.deepEqual(readdirSync(root), ['v0.1.0']);
  assert.equal(installedTag(root, executable), 'v0.1.0');
});

test('reinstalling a matching release keeps the existing files; a damaged one is replaced', async () => {
  const root = freshRoot();
  const verified = await verifyRelease(linuxZip, 'aa2modulus');
  const executable = await installRelease(root, 'v1.0.0', 'aa2modulus', verified, 'linux');
  writeFileSync(join(root, 'v1.0.0', 'marker'), '');
  await installRelease(root, 'v1.0.0', 'aa2modulus', verified, 'linux');
  assert.ok(existsSync(join(root, 'v1.0.0', 'marker')), 'a matching install is not rewritten');
  writeFileSync(executable, 'damaged');
  await installRelease(root, 'v1.0.0', 'aa2modulus', verified, 'linux');
  assert.equal(sha256(readFileSync(executable)), verified.executableSha256);
  assert.ok(!existsSync(join(root, 'v1.0.0', 'marker')));
});

test('unsafe tags are never used as directories', async () => {
  const verified = await verifyRelease(linuxZip, 'aa2modulus');
  for (const tag of ['..', '../x', 'a/b', 'a\\b', '', '.hidden']) {
    await assert.rejects(installRelease(freshRoot(), tag, 'aa2modulus', verified, 'linux'), /not usable/, tag);
  }
});

test('installedTag recognizes only executables directly inside a tag directory', () => {
  const root = join(scratch, 'server');
  assert.equal(installedTag(root, join(root, 'v0.2.0-rc.1', 'aa2modulus.exe')), 'v0.2.0-rc.1');
  assert.equal(installedTag(root, join(root, 'v0.2.0', 'nested', 'aa2modulus')), undefined);
  assert.equal(installedTag(root, join(scratch, 'elsewhere', 'aa2modulus')), undefined);
  assert.equal(installedTag(root, 'aa2modulus'), undefined);
});

test('pruning removes other installs and staging leftovers and keeps the active tag', async () => {
  const root = freshRoot();
  for (const name of ['v0.1.0', 'v0.2.0', '.staging-v0.3.0-abcd']) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'aa2modulus'), '');
  }
  assert.deepEqual(await pruneInstalls(root, 'v0.2.0'), []);
  assert.deepEqual(readdirSync(root), ['v0.2.0']);
  assert.deepEqual(await pruneInstalls(join(root, 'missing'), 'v0.2.0'), []);
});
