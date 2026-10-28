import * as vscode from 'vscode';
import { CloseAction, ErrorAction, LanguageClient, type LanguageClientOptions } from 'vscode-languageclient/node';
import { LANGUAGES, SERVER_SETTINGS } from '../shared/ids';
import { notify, openSettingsAction, showOutputAction } from '../shared/vscodeNotifications';
import { addParameterHelp } from './completion';
import { createServerOptions, readServerConfiguration, type ServerConfiguration } from './configuration';
import { type ManagedClient, ManagedLanguageClient } from './managedClient';
import { describeUnsupportedContract, SUPPORTED_CONTRACT_VERSION, type ServerFeatures } from './serverFeatures';

/**
 * The factory the controller calls for every start: it reads the current
 * `aa2m.server.*` settings and builds a fresh LanguageClient. An unsupported
 * contract version is notified once per executable; the output channel logs
 * every one.
 */
export function createClientFactory(output: vscode.LogOutputChannel): () => ManagedClient {
  const warnedExecutables = new Set<string>();

  return () => {
    const configuration = readSettings();
    output.info('Starting ' + configuration.command + ' ' + JSON.stringify(configuration.args));
    const client = new LanguageClient(
      'aa2m', 'AA2M Language Server', createServerOptions(configuration), clientOptions(output)
    );
    return new ManagedLanguageClient(client, {
      onFailedCleanup(error) {
        output.warn('Cleanup after failed startup: ' + String(error));
      },
      command: [configuration.command, ...configuration.args].join(' '),
      onUnsupportedContract(features) {
        warnUnsupportedContract(output, configuration, features, !warnedExecutables.has(configuration.command));
        warnedExecutables.add(configuration.command);
      }
    });
  };
}

/** Logs an unsupported contract version and, when `shouldNotify`, shows one warning. */
function warnUnsupportedContract(
  output: vscode.LogOutputChannel,
  configuration: ServerConfiguration,
  features: ServerFeatures,
  shouldNotify: boolean
): void {
  const { message } = describeUnsupportedContract(features);
  const advertised = features.contractVersion === undefined ? 'no contract version' : `contract ${features.contractVersion}`;
  output.warn(`${message} The server reports ${advertised}; the extension needs ${SUPPORTED_CONTRACT_VERSION}. `
    + `Configured command: ${JSON.stringify(configuration.command)}.`);
  if (shouldNotify) {
    notify(vscode.window.showWarningMessage, message, {
      ...openSettingsAction(SERVER_SETTINGS.commandSetting), ...showOutputAction(output)
    });
  }
}

function readSettings(): ServerConfiguration {
  const settings = vscode.workspace.getConfiguration(SERVER_SETTINGS.section);
  return readServerConfiguration({
    command: settings.get(SERVER_SETTINGS.command),
    args: settings.get(SERVER_SETTINGS.args),
    cwd: settings.get(SERVER_SETTINGS.cwd)
  });
}

function clientOptions(output: vscode.LogOutputChannel): LanguageClientOptions {
  return {
    documentSelector: ['file', 'untitled'].flatMap(scheme =>
      [LANGUAGES.module, LANGUAGES.library].map(language => ({ scheme, language }))),
    outputChannel: output,
    traceOutputChannel: output,
    diagnosticCollectionName: 'aa2m',
    middleware: {
      async provideCompletionItem(document, position, completionContext, token, next) {
        const result = await next(document, position, completionContext, token);
        for (const item of (Array.isArray(result) ? result : result?.items) ?? []) {
          // Keyword snippets can hold calls too (the library starter); only calls get parameter help.
          if (item.kind === vscode.CompletionItemKind.Function || item.kind === vscode.CompletionItemKind.Method) {
            addParameterHelp(item);
          }
        }
        return result;
      }
    },
    // Never restart automatically: a broken executable would loop. The user
    // retries with AA2M: Restart Language Server or by changing settings.
    // The extension reports crashes itself (language status and one
    // notification with Restart), so the library only logs.
    errorHandler: {
      error: () => ({
        action: ErrorAction.Shutdown,
        handled: true,
        message: 'AA2M server connection failed; shutting down the client.'
      }),
      closed: () => ({
        action: CloseAction.DoNotRestart,
        handled: true,
        message: 'AA2M server connection closed. Use AA2M: Restart Language Server to retry.'
      })
    }
  };
}
