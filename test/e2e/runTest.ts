// Runs each e2e suite in its own VS Code instance, with its own copy of the
// fixture workspace, user data and extensions directory, so no suite depends
// on what another one left behind. `npm run test:e2e -- <name>...` runs only
// the suites whose file names contain one of the names.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ServerConfiguration } from '../../src/server/configuration';
import { extensionRoot } from '../support/paths';
import { serverConfigurationFromEnvironment } from '../support/serverEnvironment';

/** Which server a suite's settings name. */
type SuiteServer =
  /** The server from AA2M_SERVER_*. */
  | 'release'
  /** A command that does not exist. */
  | 'missing'
  /** No command in any settings scope, and no `aa2modulus` on PATH. */
  | 'unset'
  /** `fakeOldServer.js`: contract 1, module commands, no built-in pages. */
  | 'oldServer';

interface SuiteSetup {
  server: SuiteServer;
  /** False runs the suite in Restricted Mode. */
  trusted: boolean;
}

const SUITES: Record<string, SuiteSetup> = {
  'authoring.test.js': { server: 'release', trusted: true },
  'builtins.test.js': { server: 'release', trusted: true },
  'lifecycle.test.js': { server: 'release', trusted: true },
  'missingServer.test.js': { server: 'missing', trusted: true },
  'moduleCommands.test.js': { server: 'release', trusted: true },
  'oldServer.test.js': { server: 'oldServer', trusted: true },
  'restricted.test.js': { server: 'release', trusted: false },
  'serverUpdate.test.js': { server: 'release', trusted: true },
  'setup.test.js': { server: 'unset', trusted: true }
};

/** `aa2m.server.*` settings for a suite, or none. */
function serverSettings(server: SuiteServer, release: ServerConfiguration, temporary: string): Record<string, unknown> {
  switch (server) {
    case 'release':
      return { 'aa2m.server.command': release.command, 'aa2m.server.args': release.args, 'aa2m.server.cwd': release.cwd ?? '' };
    case 'missing':
      return { 'aa2m.server.command': path.join(temporary, 'missing-aa2m-server'), 'aa2m.server.args': [] };
    case 'oldServer':
      return { 'aa2m.server.command': process.execPath, 'aa2m.server.args': [path.join(__dirname, 'fakeOldServer.js')] };
    case 'unset':
      return {};
  }
}

/**
 * User settings of a suite's instance. Server settings go here, not in the
 * workspace, because Restricted Mode ignores restricted workspace settings.
 */
function userSettings(setup: SuiteSetup, release: ServerConfiguration, temporary: string): Record<string, unknown> {
  const trust = setup.trusted ? {} : {
    'security.workspace.trust.enabled': true,
    'security.workspace.trust.startupPrompt': 'never',
    'security.workspace.trust.banner': 'never'
  };
  return {
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    // No suite may call the real GitHub; serverUpdate.test.ts turns it on with a fake.
    'aa2m.checkForServerUpdates': false,
    ...trust,
    ...serverSettings(setup.server, release, temporary)
  };
}

/**
 * Runs VS Code until the extension tests in it finish; rejects on a nonzero
 * exit. Launched directly, not through @vscode/test-electron, which always
 * adds `--disable-workspace-trust` and so cannot test Restricted Mode.
 */
function launchVSCode(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code exited with ${code ?? signal}.`));
      }
    });
  });
}

async function runSuite(file: string, setup: SuiteSetup, vscodeExecutablePath: string): Promise<void> {
  const release = serverConfigurationFromEnvironment();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aa2m-extension-test-'));
  try {
    const workspacePath = path.join(temporary, 'workspace');
    fs.cpSync(path.join(extensionRoot, 'test', 'fixtures', 'workspace'), workspacePath, { recursive: true });
    const userData = path.join(temporary, 'user-data');
    fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify(userSettings(setup, release, temporary)));
    const emptyPath = path.join(temporary, 'empty-path');
    fs.mkdirSync(emptyPath);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AA2M_TEST_NODE: process.execPath,
      AA2M_TEST_SUITE: file,
      // Without a configured command the extension falls back to `aa2modulus` on PATH.
      PATH: setup.server === 'unset' ? emptyPath : process.env.PATH
    };
    // VS Code terminals can pass on Node-only mode, which would make Electron run as Node.
    delete env.ELECTRON_RUN_AS_NODE;
    await launchVSCode(vscodeExecutablePath, [
      workspacePath,
      '--extensionDevelopmentPath=' + extensionRoot,
      '--extensionTestsPath=' + path.resolve(__dirname, 'index.js'),
      '--user-data-dir=' + userData,
      '--extensions-dir=' + path.join(temporary, 'extensions'),
      '--disable-extensions', '--disable-telemetry', '--disable-updates', '--skip-welcome', '--skip-release-notes',
      '--no-sandbox', '--disable-gpu-sandbox', '--no-cached-data',
      ...(setup.trusted ? ['--disable-workspace-trust'] : [])
    ], env);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
  if (!vscodeExecutablePath) {
    throw new Error('Set VSCODE_EXECUTABLE_PATH to an existing native VS Code executable. This runner never downloads VS Code.');
  }
  fs.accessSync(vscodeExecutablePath, fs.constants.X_OK);
  const filters = process.argv.slice(2);
  const selected = Object.entries(SUITES)
    .filter(([file]) => filters.length === 0 || filters.some(filter => file.includes(filter)));
  if (selected.length === 0) {
    throw new Error(`No e2e suite matches ${filters.join(', ')}.`);
  }
  const failed: string[] = [];
  for (const [file, setup] of selected) {
    console.log(`\n=== ${file}`);
    try {
      await runSuite(file, setup, vscodeExecutablePath);
    } catch (error) {
      console.error(error);
      failed.push(file);
    }
  }
  if (failed.length > 0) {
    throw new Error(`E2E suites failed: ${failed.join(', ')}.`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
