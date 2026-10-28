import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { extensionRoot as root } from '../support/paths';

// The extension must stay movable as one directory: nothing it ships or documents
// may point outside it or at one machine's files.
// `agent_data/` and the agent settings folders are git-ignored local records that are
// neither shipped nor documented.
const skipped = new Set(['node_modules', 'out', '.vscode-test', '.git', 'agent_data', '.claude', '.codex', '.agents']);
const textExtensions = /\.(md|json|ts|mjs|js|aa2m|aa2mi|toml|txt)$/;

function files(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return skipped.has(entry.name) ? [] : files(path);
    }
    return textExtensions.test(entry.name) ? [path] : [];
  });
}

const inside = (path: string): boolean => {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep);
};

test('Markdown links resolve inside the extension', () => {
  const broken: string[] = [];
  for (const file of files().filter(path => path.endsWith('.md'))) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) {
        continue;
      }
      const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
      if (!inside(path) || !existsSync(path)) {
        broken.push(`${relative(root, file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('authored files contain no machine-specific absolute paths', () => {
  const pattern = /(?:\/home\/[a-z_][\w.-]*\/|\/Users\/[\w.-]+\/|[A-Z]:\\\\Users\\\\)/;
  const offenders = files()
    .filter(file => pattern.test(readFileSync(file, 'utf8')))
    .map(file => relative(root, file));
  assert.deepEqual(offenders, []);
});
