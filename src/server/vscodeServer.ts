import * as vscode from 'vscode';
import { errorMessage } from '../shared/errors';
import { COMMANDS, LANGUAGES, SERVER_SETTINGS, SERVER_STATUS_ITEM } from '../shared/ids';
import { notify, openSettingsAction, showOutputAction } from '../shared/vscodeNotifications';
import { ServerController } from './controller';
import { ServerSession } from './session';
import { startFailureNotice } from './startFailure';
import { serverLabel, type ServerStatus, type ServerStatusModel } from './status';
import { describeStatus } from './statusPresentation';
import { createClientFactory } from './vscodeLanguageClient';
import { selectServer } from './vscodeSelectServer';

/** The client side of the language server: the controller that owns the client, and the session that starts it. */
export interface ServerRuntime {
  controller: ServerController;
  session: ServerSession;
}

/**
 * Shows the server setup notification when no server is configured. Returns
 * whether that notification is on screen, so the caller can skip its own.
 */
export type OfferSetup = () => boolean;

/**
 * Sets up the language server: its controller and session, the AA2M language
 * status item, crash and failure notifications, the server commands, and the
 * triggers that start or restart it.
 */
export function registerLanguageServer(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  offerSetup: OfferSetup
): ServerRuntime {
  const controller = new ServerController(() => vscode.workspace.isTrusted, createClientFactory(output));
  const session = new ServerSession(controller, error => reportStartFailure(output, controller, offerSetup, error));

  context.subscriptions.push(
    createStatusItem(controller.status),
    controller.status.onDidChange((status, previous) => reportTransition(output, session, status, previous)),
    vscode.commands.registerCommand(COMMANDS.restartServer, () => session.restart()),
    vscode.commands.registerCommand(COMMANDS.showOutput, () => output.show()),
    vscode.commands.registerCommand(COMMANDS.selectServer, () => selectServer(output, session)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(SERVER_SETTINGS.section)) {
        session.restartIfStarted();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => session.restartIfStarted()),
    vscode.workspace.onDidOpenTextDocument(document => {
      if (isAA2MDocument(document)) {
        void session.ensureStarted();
      }
    })
  );

  if (!vscode.workspace.isTrusted) {
    output.warn('Trust this workspace to start the AA2M language server.');
  }
  if (vscode.workspace.textDocuments.some(isAA2MDocument)) {
    void session.ensureStarted();
  }
  return { controller, session };
}

function isAA2MDocument(document: vscode.TextDocument): boolean {
  return document.languageId === LANGUAGES.module || document.languageId === LANGUAGES.library;
}

/** The AA2M item in the `{}` language status area, kept in sync with the server status. */
function createStatusItem(status: ServerStatusModel): vscode.Disposable {
  const item = vscode.languages.createLanguageStatusItem(
    SERVER_STATUS_ITEM, [{ language: LANGUAGES.module }, { language: LANGUAGES.library }]
  );
  item.name = 'AA2M Language Server';
  const render = (current: ServerStatus): void => {
    const shown = describeStatus(current);
    item.text = shown.text;
    item.detail = shown.detail;
    item.busy = shown.busy;
    item.severity = {
      information: vscode.LanguageStatusSeverity.Information,
      warning: vscode.LanguageStatusSeverity.Warning,
      error: vscode.LanguageStatusSeverity.Error
    }[shown.severity];
    item.command = { command: shown.command.id, title: shown.command.title };
  };
  render(status.current);
  return vscode.Disposable.from(item, status.onDidChange(render));
}

/** Logs a ready server and notifies once when a running server stops unexpectedly. */
function reportTransition(
  output: vscode.LogOutputChannel,
  session: ServerSession,
  status: ServerStatus,
  previous: ServerStatus
): void {
  if (status.state === 'ready') {
    const server = serverLabel(status);
    output.info('Server ready' + (server ? ': ' + server : '') + '.');
  }
  if (status.state === 'crashed' && previous.state !== 'crashed') {
    output.error('Language server stopped unexpectedly: ' + (status.detail ?? 'unknown reason'));
    notify(
      vscode.window.showErrorMessage,
      'AA2M language server stopped unexpectedly. Diagnostics and completion are unavailable until it restarts.',
      { 'Restart': () => session.restart(), ...showOutputAction(output) }
    );
  }
}

/**
 * Explains a failed start: the setup notification when no server is set up,
 * otherwise the notice that `startFailureNotice` picks.
 */
function reportStartFailure(
  output: vscode.LogOutputChannel,
  controller: ServerController,
  offerSetup: OfferSetup,
  error: unknown
): void {
  output.error('Language server failed: ' + errorMessage(error));
  const notice = startFailureNotice(controller.status.current, error);
  if (notice.kind === 'startError') {
    notify(
      vscode.window.showErrorMessage,
      notice.message,
      { ...openSettingsAction(SERVER_SETTINGS.section), ...showOutputAction(output) }
    );
    return;
  }
  // With no server set up, the setup notification says it all.
  if (offerSetup()) {
    return;
  }
  notify(vscode.window.showErrorMessage, notice.message, {
    'Download Server…': () => vscode.commands.executeCommand(COMMANDS.downloadServer),
    'Select Executable…': () => vscode.commands.executeCommand(COMMANDS.selectServer),
    ...openSettingsAction(SERVER_SETTINGS.commandSetting)
  });
}
