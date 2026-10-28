import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The extension's root directory: the nearest ancestor of the compiled test
 * that holds this package's manifest. Tests resolve repository files from it.
 */
export const extensionRoot = findExtensionRoot(__dirname);

function findExtensionRoot(start: string): string {
  for (let directory = start; ; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest) && isThisPackage(manifest)) {
      return directory;
    }
    if (dirname(directory) === directory) {
      throw new Error(`No aa2m package.json above ${start}.`);
    }
  }
}

function isThisPackage(manifest: string): boolean {
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
  return name === 'aa2m';
}
