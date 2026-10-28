import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ServerController } from '../server/controller';
import { hasCommand, readyServerLacks } from '../server/serverFeatures';
import { throwIfFailed } from '../server/session';
import type { ServerStatus } from '../server/status';
import type { ServerRuntime } from '../server/vscodeServer';
import { errorMessage } from '../shared/errors';
import { COMMANDS, CONTEXT_KEYS, STATE_KEYS } from '../shared/ids';
import { notify, type NotificationActions, showOutputAction } from '../shared/vscodeNotifications';
import {
  type CompileTargets, type ModuleCommandPorts, ModuleCommands, type ModuleDialogs, type ModuleDocument,
  type ModuleDocuments, type ModuleReporter, type ModuleServer
} from './moduleCommands';
import { SERVER_COMMANDS } from './protocol';
import { uriFileName } from './uris';

/**
 * Registers AA2M: Compile Module and AA2M: Decompile Module. Both need a
 * trusted workspace and start the server on first use. Commands show their
 * own progress once dialogs are done, and their own success message. Menus
 * hide a command while a ready server does not support it.
 */
export function registerModuleCommands(
  context: vscode.ExtensionContext,
  server: ServerRuntime,
  output: vscode.LogOutputChannel
): void {
  const commands = new ModuleCommands(createModuleCommandPorts(server.controller, output, context.workspaceState));

  async function run(title: string, operation: () => Promise<boolean>): Promise<void> {
    try {
      // In an untrusted workspace this only records the state; the command's
      // capability check then rejects with the trust message. A failed start
      // has its own notification and is reported here too.
      throwIfFailed(await server.session.ensureStarted());
      await operation();
    } catch (error) {
      const message = errorMessage(error);
      output.error(title + ': ' + message);
      notify(vscode.window.showErrorMessage, message, showOutputAction(output));
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.compileModule, (uri?: vscode.Uri) =>
      run('AA2M: Compile Module', () => commands.compile(resourceArgument(uri)))),
    vscode.commands.registerCommand(COMMANDS.decompileModule, (uri?: vscode.Uri) =>
      run('AA2M: Decompile Module', () => commands.decompile(resourceArgument(uri)))),
    server.controller.status.onDidChange(updateContext)
  );
  updateContext(server.controller.status.current);
}

/** Hides each module command while a ready server does not support it. */
function updateContext(status: ServerStatus): void {
  const lacks = (command: string) => readyServerLacks(status, features => hasCommand(features, command));
  void vscode.commands.executeCommand(
    'setContext', CONTEXT_KEYS.compileUnsupported, lacks(SERVER_COMMANDS.compileDocument)
  );
  void vscode.commands.executeCommand(
    'setContext', CONTEXT_KEYS.decompileUnsupported, lacks(SERVER_COMMANDS.decompileModule)
  );
}

/** Menus pass the resource URI; keybindings and other callers may pass anything else. */
function resourceArgument(value: unknown): string | undefined {
  return value instanceof vscode.Uri ? value.toString() : undefined;
}

function snapshot(document: vscode.TextDocument): ModuleDocument {
  return {
    uri: document.uri.toString(), version: document.version, languageId: document.languageId,
    isUntitled: document.isUntitled
  };
}

function displayPath(uri: vscode.Uri): string {
  return uri.scheme === 'file' || vscode.workspace.getWorkspaceFolder(uri) ? vscode.workspace.asRelativePath(uri) : uri.toString(true);
}

/** Reveal Compile output: the Explorer for workspace files, otherwise the OS file manager on a local window. */
function revealCommand(uri: vscode.Uri): string | undefined {
  if (vscode.workspace.getWorkspaceFolder(uri)) {
    return 'revealInExplorer';
  }
  return uri.scheme === 'file' && vscode.env.remoteName === undefined ? 'revealFileInOS' : undefined;
}

function createModuleCommandPorts(
  controller: ServerController,
  output: vscode.LogOutputChannel,
  state: vscode.Memento
): ModuleCommandPorts {
  return {
    documents: documentPort(),
    targets: compileTargetPort(state),
    dialogs: dialogPort(),
    server: serverPort(controller),
    reporter: reporterPort(output)
  };
}

function documentPort(): ModuleDocuments {
  return {
    async getDocument(uri) {
      const document = uri
        ? await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
        : vscode.window.activeTextEditor?.document;
      return document && snapshot(document);
    },
    async saveAs(document) {
      const current = await vscode.workspace.openTextDocument(vscode.Uri.parse(document.uri));
      await vscode.window.showTextDocument(current, { preview: false });
      const savedUri = await vscode.workspace.saveAs(current.uri);
      if (!savedUri) {
        return undefined;
      }
      const saved = await vscode.workspace.openTextDocument(savedUri);
      await vscode.window.showTextDocument(saved, { preview: false });
      return snapshot(saved);
    }
  };
}

/** Compile targets per workspace in `workspaceState`. */
function compileTargetPort(state: vscode.Memento): CompileTargets {
  const targets = () => state.get<Record<string, string>>(STATE_KEYS.compileTargets) ?? {};
  return {
    rememberedOutput: uri => Object.hasOwn(targets(), uri) ? targets()[uri] : undefined,
    rememberOutput: (uri, outputUri) =>
      Promise.resolve(state.update(STATE_KEYS.compileTargets, { ...targets(), [uri]: outputUri }))
  };
}

function dialogPort(): ModuleDialogs {
  return {
    async chooseOutput(document, suggested) {
      // Untitled modules are saved first, so the source has a path.
      const source = vscode.Uri.parse(document.uri);
      const uri = await vscode.window.showSaveDialog({
        title: 'Compile AA2M Module', saveLabel: 'Compile',
        defaultUri: suggested ? vscode.Uri.parse(suggested) : vscode.Uri.joinPath(source, '..', path.parse(source.path).name)
      });
      return uri?.toString();
    },
    async chooseInput() {
      const selected = await vscode.window.showOpenDialog({
        title: 'Decompile AA2M Module', openLabel: 'Decompile',
        canSelectFiles: true, canSelectFolders: false, canSelectMany: false
      });
      return selected?.[0]?.toString();
    },
    withProgress: (title, task) =>
      Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)),
    displayPath: uri => displayPath(vscode.Uri.parse(uri))
  };
}

function serverPort(controller: ServerController): ModuleServer {
  return {
    executeCommand: (command, argument) => controller.executeCommand<unknown>(command, argument),
    requireCommands: commands => controller.requireCommands(commands)
  };
}

function reporterPort(output: vscode.LogOutputChannel): ModuleReporter {
  return {
    compiled(sourceUri, outputUri) {
      const source = vscode.Uri.parse(sourceUri);
      const target = vscode.Uri.parse(outputUri);
      const reveal = revealCommand(target);
      output.info(`Compiled ${source.toString(true)} -> ${target.toString(true)}`);
      const actions: NotificationActions = reveal ? { 'Reveal': () => vscode.commands.executeCommand(reveal, target) } : {};
      notify(vscode.window.showInformationMessage, `Compiled ${uriFileName(sourceUri)} → ${displayPath(target)}`, actions);
    },
    showSummary(summary) {
      const actions: NotificationActions = {};
      if (summary.showProblems) {
        actions['Show Problems'] = () => vscode.commands.executeCommand('workbench.actions.view.problems');
      }
      notify(
        summary.severity === 'error' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage,
        summary.message,
        { ...actions, ...showOutputAction(output) }
      );
    }
  };
}
