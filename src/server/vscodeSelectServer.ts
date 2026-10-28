import * as vscode from 'vscode';
import { SERVER_SETTINGS } from '../shared/ids';
import { notify } from '../shared/vscodeNotifications';
import type { ServerSession } from './session';

/** AA2M: Select Server Executable: asks for the file and uses it through `useServerExecutable`. */
export async function selectServer(output: vscode.LogOutputChannel, session: ServerSession): Promise<void> {
  const options: vscode.OpenDialogOptions = {
    title: 'Select the aa2modulus executable',
    openLabel: 'Use as AA2M Server',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false
  };
  if (process.platform === 'win32') {
    options.filters = { Executables: ['exe'], 'All files': ['*'] };
  }
  const picked = await vscode.window.showOpenDialog(options);
  const uri = picked?.[0];
  if (!uri) {
    return;
  }
  if (uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Select an executable on the extension host file system.');
    return;
  }
  await useServerExecutable(output, session, uri.fsPath);
}

/**
 * Writes `executable` to `aa2m.server.command` in User settings (Remote
 * settings in a remote window) and warns when a workspace value overrides it.
 */
export async function useServerExecutable(
  output: vscode.LogOutputChannel,
  session: ServerSession,
  executable: string
): Promise<void> {
  const settings = vscode.workspace.getConfiguration(SERVER_SETTINGS.section);
  const inspected = settings.inspect<string>(SERVER_SETTINGS.command);
  // A changed value restarts the server through the configuration listener.
  const unchanged = inspected?.globalValue === executable;
  await settings.update(SERVER_SETTINGS.command, executable, vscode.ConfigurationTarget.Global);
  output.info('aa2m.server.command set to ' + JSON.stringify(executable) + ' in User settings.');
  if (unchanged) {
    void session.restart();
  }
  if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
    notify(
      vscode.window.showWarningMessage,
      'A workspace setting for aa2m.server.command overrides the executable you selected.',
      { 'Open Workspace Settings': () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile') }
    );
  }
}
