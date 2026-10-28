import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import * as JSZip from 'jszip';
import { errorMessage } from '../shared/errors';
import { isSafeTag } from './releases';

export const CHECKSUM_FILE = 'SHA256SUMS';
const STAGING_PREFIX = '.staging-';

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256sum` output: `<hex>  <name>` or `<hex> *<name>` per line. File name -> lowercase hex. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (match) {
      sums.set(match[2].trim(), match[1].toLowerCase());
    }
  }
  return sums;
}

/** A file name with no directory part, safe to write into the install directory. */
function isPlainFileName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\:\0]/.test(name);
}

/** One file of a release zip. */
export interface ReleaseFile {
  name: string;
  data: Buffer;
}

/** Every file of a zip archive, CRC-32 checked; directory entries are skipped. */
export async function readZip(archive: Buffer): Promise<ReleaseFile[]> {
  const zip = await JSZip.loadAsync(archive, { checkCRC32: true }).catch((error: unknown) => {
    throw new Error('The release zip is damaged or not a zip archive: ' + errorMessage(error));
  });
  const files: ReleaseFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) {
      // jszip normalizes names such as `../x`; check what the archive really says.
      files.push({ name: entry.unsafeOriginalName ?? entry.name, data: await entry.async('nodebuffer') });
    }
  }
  return files;
}

export interface VerifiedRelease {
  files: ReleaseFile[];
  /** Expected SHA-256 of the executable, from `SHA256SUMS`. */
  executableSha256: string;
}

/**
 * Checks a downloaded release zip before anything is written: its own SHA-256
 * when known, a flat layout, and the executable against `SHA256SUMS` inside it.
 * Every other file listed in `SHA256SUMS` is checked too.
 */
export async function verifyRelease(
  archive: Buffer,
  executable: string,
  archiveSha256?: string
): Promise<VerifiedRelease> {
  if (archiveSha256 !== undefined && sha256(archive) !== archiveSha256.toLowerCase()) {
    throw new Error('The downloaded zip does not match the SHA-256 digest GitHub reports for it.');
  }
  const files = await readZip(archive);
  const names = new Set<string>();
  for (const file of files) {
    if (!isPlainFileName(file.name)) {
      throw new Error(`The release zip contains an unexpected path ${JSON.stringify(file.name)}.`);
    }
    if (names.has(file.name.toLowerCase())) {
      throw new Error(`The release zip contains ${JSON.stringify(file.name)} twice.`);
    }
    names.add(file.name.toLowerCase());
  }
  const checksums = files.find(file => file.name === CHECKSUM_FILE);
  if (!checksums) {
    throw new Error(`The release zip has no ${CHECKSUM_FILE} file.`);
  }
  const sums = parseChecksums(checksums.data.toString('utf8'));
  const executableSha256 = sums.get(executable);
  if (!executableSha256) {
    throw new Error(`${CHECKSUM_FILE} in the release zip does not list ${executable}.`);
  }
  if (!files.some(file => file.name === executable)) {
    throw new Error(`The release zip does not contain ${executable}.`);
  }
  for (const file of files) {
    const expected = sums.get(file.name);
    if (expected !== undefined && sha256(file.data) !== expected) {
      throw new Error(`${file.name} in the release zip does not match its SHA-256 in ${CHECKSUM_FILE}.`);
    }
  }
  return { files, executableSha256 };
}

/** Where a release tag is installed under `root`. */
export function installDirectory(root: string, tag: string): string {
  if (!isSafeTag(tag)) {
    throw new Error(`Release tag ${JSON.stringify(tag)} is not usable as a directory name.`);
  }
  return join(root, tag);
}

/**
 * The tag directory under `root` that holds `command`, if `command` is an
 * installed executable there.
 */
export function installedTag(root: string, command: string): string | undefined {
  const path = relative(root, command);
  const parts = path.split(sep);
  return parts.length === 2 && isSafeTag(parts[0]) ? parts[0] : undefined;
}

/**
 * Writes a verified release to `<root>/<tag>/` and returns the executable path.
 * The files go to a staging directory first and are renamed into place, so a
 * failed install never leaves a half-written tag directory. An existing install
 * whose executable already matches is kept as it is (it may be running).
 */
export async function installRelease(
  root: string,
  tag: string,
  executable: string,
  release: VerifiedRelease,
  platform: string = process.platform
): Promise<string> {
  const target = installDirectory(root, tag);
  const installed = join(target, executable);
  if (await fileSha256(installed) === release.executableSha256) {
    return installed;
  }
  await mkdir(root, { recursive: true });
  const staging = join(root, STAGING_PREFIX + tag + '-' + randomBytes(4).toString('hex'));
  try {
    await mkdir(staging);
    for (const file of release.files) {
      await writeFile(join(staging, file.name), file.data);
    }
    if (platform !== 'win32') {
      await chmod(join(staging, executable), 0o755);
    }
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } catch (error) {
    // Best effort: the install error matters more, and pruning retries leftovers.
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return installed;
}

async function fileSha256(path: string): Promise<string | undefined> {
  try {
    return sha256(await readFile(path));
  } catch {
    return undefined;
  }
}

/**
 * Removes every install and leftover staging directory under `root` except
 * `keepTag`. Returns the names it could not remove (on Windows, a running
 * server's directory); they are tried again on the next install.
 */
export async function pruneInstalls(root: string, keepTag: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const failed: string[] = [];
  for (const name of names) {
    if (name === keepTag) {
      continue;
    }
    try {
      await rm(join(root, name), { recursive: true, force: true });
    } catch {
      failed.push(name);
    }
  }
  return failed;
}
