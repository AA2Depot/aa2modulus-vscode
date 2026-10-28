import * as vscode from 'vscode';
import type { ServerRuntime } from '../server/vscodeServer';
import { COMMANDS, LANGUAGES } from '../shared/ids';
import { notify } from '../shared/vscodeNotifications';
import { starterUnavailableMessage } from './newModule';

/**
 * Registers AA2M: New Module, which opens an empty unsaved module, waits for
 * the server start that the document triggers and asks for suggestions: in
 * an empty document the server ranks its module starter first. A ready server
 * without starters gets a message instead.
 */
export function registerNewModule(context: vscode.ExtensionContext, server: ServerRuntime): void {
  context.subscriptions.push(vscode.commands.registerCommand(COMMANDS.newModule, () => newModule(server)));
}

async function newModule(server: ServerRuntime): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ language: LANGUAGES.module });
  await vscode.window.showTextDocument(document);
  // A failed start is reported by the session; the document stays open either way.
  await server.session.ensureStarted();
  const message = starterUnavailableMessage(server.controller.status.current);
  if (message !== undefined) {
    void notify(vscode.window.showInformationMessage, message);
    return;
  }
  await vscode.commands.executeCommand('editor.action.triggerSuggest');
}
