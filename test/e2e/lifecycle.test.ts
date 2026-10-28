import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ServerConfiguration } from '../../src/server/configuration';
import { serverConfigurationFromEnvironment } from '../support/serverEnvironment';
import { fixtureUri, loadExtension, replace, waitFor } from './helper';

interface Notice {
  message: string;
  actions: string[];
}

/** Environment the launcher reads (see serverLauncher.ts). */
const LAUNCHER_ENVIRONMENT = ['AA2M_SERVER_COMMAND', 'AA2M_SERVER_ARGS', 'AA2M_SERVER_CWD', 'AA2M_SERVER_PID_FILE'];

/**
 * The server runs behind serverLauncher.js, which records its process id so a
 * test can kill exactly that process. The launcher runs on the runner's Node
 * and starts the configured server, so selecting an executable cannot recurse.
 */
suite('AA2M server lifecycle in VS Code', () => {
  const configuration = vscode.workspace.getConfiguration('aa2m.server');
  const extension = loadExtension();
  const workspaceSettings = fixtureUri('.vscode/settings.json');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aa2m-lifecycle-'));
  const pidFile = path.join(temporary, 'server.pid');
  const launcher = path.join(__dirname, 'serverLauncher.js');
  const notices: Notice[] = [];
  const savedEnvironment = Object.fromEntries(LAUNCHER_ENVIRONMENT.map(name => [name, process.env[name]]));
  let crashAction: ((action: string | undefined) => void) | undefined;
  let originalSettings: Uint8Array | undefined;
  let originalCommand: string | undefined;
  let base: ServerConfiguration;
  let testNode: string;
  let restoreNotices = () => {};

  function serverPid(): number {
    assert.ok(fs.existsSync(pidFile), 'the launcher recorded the server process id');
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0, 'the launcher recorded a valid process id');
    return pid;
  }

  /** Writes `aa2m.server.*` workspace settings, replacing earlier ones, and waits until VS Code reads them. */
  async function writeServerSettings(settings: Record<string, unknown>): Promise<void> {
    const content = originalSettings
      ? JSON.parse(Buffer.from(originalSettings).toString('utf8')) as Record<string, unknown>
      : {};
    for (const name of ['command', 'args', 'cwd']) {
      delete content['aa2m.server.' + name];
    }
    for (const [name, value] of Object.entries(settings)) {
      content['aa2m.server.' + name] = value;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceSettings, '..'));
    await vscode.workspace.fs.writeFile(workspaceSettings, Buffer.from(JSON.stringify(content)));
    await waitFor(() => vscode.workspace.getConfiguration('aa2m.server'), current =>
      Object.entries(settings).every(([name, value]) => JSON.stringify(current.get(name)) === JSON.stringify(value)));
  }

  /** Records error notifications; the crash notice stays open until a test picks an action. */
  function recordErrorNotices(): () => void {
    return replace(vscode.window, 'showErrorMessage', ((message: string, ...actions: string[]) => {
      notices.push({ message, actions });
      if (message.includes('stopped unexpectedly')) {
        return new Promise<string | undefined>(resolve => {
          crashAction = resolve;
        });
      }
      return Promise.resolve(undefined);
    }) as unknown as typeof vscode.window.showErrorMessage);
  }

  async function saveOriginals(): Promise<void> {
    originalCommand = configuration.inspect<string>('command')?.globalValue;
    try {
      originalSettings = await vscode.workspace.fs.readFile(workspaceSettings);
    } catch {
      // The runner keeps server settings in User settings; the workspace may have none.
    }
  }

  /** Tells the launcher which server to run, then points `aa2m.server.command` at the launcher. */
  async function useLauncher(): Promise<void> {
    base = serverConfigurationFromEnvironment({
      command: configuration.get('command'),
      args: configuration.get('args'),
      cwd: configuration.get('cwd')
    });
    process.env.AA2M_SERVER_COMMAND = base.command;
    process.env.AA2M_SERVER_ARGS = JSON.stringify(base.args);
    process.env.AA2M_SERVER_CWD = base.cwd ?? '';
    process.env.AA2M_SERVER_PID_FILE = pidFile;
    await writeServerSettings({ command: testNode, args: [launcher], cwd: '' });
    await configuration.update('command', testNode, vscode.ConfigurationTarget.Global);
    await writeServerSettings({ args: [launcher], cwd: '' });
    await waitFor(() => vscode.workspace.getConfiguration('aa2m.server').get('command'), command => command === testNode);
    await extension.exports.restart();
  }

  async function restoreServer(): Promise<void> {
    // Restore command and args together: neither executable accepts the
    // other one's arguments during an intermediate settings update.
    await writeServerSettings({ command: base.command, args: base.args, cwd: base.cwd ?? '' });
    await configuration.update('command', originalCommand, vscode.ConfigurationTarget.Global);
    if (originalSettings) {
      await vscode.workspace.fs.writeFile(workspaceSettings, originalSettings);
    } else {
      await vscode.workspace.fs.delete(workspaceSettings);
    }
    await waitFor(() => vscode.workspace.getConfiguration('aa2m.server').get('command'), command => command === base.command);
    await extension.exports.restart();
  }

  function restoreEnvironment(): void {
    for (const [name, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  suiteSetup(async () => {
    await extension.activate();
    testNode = process.env.AA2M_TEST_NODE
      ?? execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', timeout: 5000 }).trim();
    await saveOriginals();
    restoreNotices = recordErrorNotices();
    await useLauncher();
  });

  suiteTeardown(async () => {
    try {
      await restoreServer();
    } finally {
      restoreNotices();
      restoreEnvironment();
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('AA2M: Restart Language Server starts a new server process', async () => {
    const previousPid = serverPid();
    await vscode.commands.executeCommand('aa2m.restartServer');
    await waitFor(() => extension.exports.status(), status => status.state === 'ready' && serverPid() !== previousPid);
  });

  test('a missing executable is reported, and Select Executable writes User settings', async () => {
    await configuration.update('command', path.join(temporary, 'does-not-exist'), vscode.ConfigurationTarget.Global);
    const notFound = await waitFor(() => extension.exports.status(), status => status.state === 'failed');
    assert.equal(notFound.missingExecutable, true);
    assert.ok(notices.some(notice => notice.message.includes('was not found or is not executable')));

    const restoreDialog = replace(vscode.window, 'showOpenDialog', async () => [vscode.Uri.file(testNode)]);
    try {
      await vscode.commands.executeCommand('aa2m.selectServer');
      await waitFor(() => extension.exports.status(), status => status.state === 'ready');
      await extension.exports.whenSettled();
      assert.equal(configuration.inspect<string>('command')?.globalValue, testNode);
      assert.equal(extension.exports.status().state, 'ready');
    } finally {
      restoreDialog();
    }
  });

  test('a server crash shows one notification, and its Restart action restores readiness', async () => {
    notices.length = 0;
    const previousPid = serverPid();
    process.kill(previousPid, 'SIGTERM');

    await waitFor(() => extension.exports.status(), status => status.state === 'crashed');
    const restart = await waitFor(() => crashAction, action => action !== undefined);
    // A fixed wait, because this proves that no second notification arrives.
    await new Promise(resolve => setTimeout(resolve, 250));
    const crashNotices = notices.filter(notice => notice.message.includes('stopped unexpectedly'));
    assert.equal(crashNotices.length, 1);
    assert.ok(crashNotices[0].actions.includes('Restart'));

    restart?.('Restart');
    await waitFor(() => extension.exports.status(), status => status.state === 'ready' && serverPid() !== previousPid);
    await extension.exports.whenSettled();
    assert.equal(extension.exports.status().state, 'ready');
  });
});
