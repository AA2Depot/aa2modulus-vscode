import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionRoot } from './paths';

/** Reads and parses a JSON file given relative to the extension root. */
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(extensionRoot, path), 'utf8')) as T;
}

/** Reads a text file given relative to the extension root. */
export function readText(path: string): string {
  return readFileSync(join(extensionRoot, path), 'utf8');
}

export interface ProblemPattern {
  regexp: string;
  file: number;
  line: number;
  column: number;
  severity: number;
  code: number;
  message: number;
}

export interface ConfigurationProperty {
  default?: unknown;
}

/** The parts of `package.json` that tests read. */
export interface Manifest {
  contributes: {
    languages: { id: string }[];
    commands: { command: string }[];
    configuration: { properties: Record<string, ConfigurationProperty> };
    walkthroughs: { id: string; steps: { id: string }[] }[];
    grammars: { language: string; scopeName: string; path: string }[];
    menus: Record<string, { command: string; when?: string }[]>;
    semanticTokenScopes: { language: string; scopes: Record<string, string[]> }[];
    problemMatchers: {
      name: string;
      owner: string;
      fileLocation: string[];
      pattern: ProblemPattern | ProblemPattern[];
    }[];
  };
}

export function readManifest(): Manifest {
  return readJson<Manifest>('package.json');
}
