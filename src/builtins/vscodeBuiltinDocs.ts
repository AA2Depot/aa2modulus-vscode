import * as vscode from 'vscode';
import { readyServerLacks } from '../server/serverFeatures';
import type { ServerStatus } from '../server/status';
import type { ServerRuntime } from '../server/vscodeServer';
import { errorMessage } from '../shared/errors';
import { COMMANDS, CONTEXT_KEYS } from '../shared/ids';
import { notify, showOutputAction } from '../shared/vscodeNotifications';
import { BUILTIN_SCHEME, browseUnavailableMessage, builtinPickItems, type BuiltinPickItem } from './browse';

/**
 * Registers AA2M: Browse Built-ins and keeps `aa2m-builtin:` pages in
 * Markdown. The server serves the pages (vscode-languageclient registers the
 * content provider) and lists the built-ins, so browsing starts the server
 * and needs a trusted workspace.
 */
export function registerBuiltinDocs(
  context: vscode.ExtensionContext,
  server: ServerRuntime,
  output: vscode.LogOutputChannel
): void {
  // Other extensions may claim `*.md` (MDC uses filenamePatterns); built-in
  // pages are plain Markdown, so the Markdown preview and editor features apply.
  // Definition previews (Ctrl+hover, peek) open a page briefly and close it
  // before the change lands; that rejection is expected and dropped.
  const openAsMarkdown = (document: vscode.TextDocument): void => {
    if (document.uri.scheme === BUILTIN_SCHEME && document.languageId !== 'markdown') {
      void vscode.languages.setTextDocumentLanguage(document, 'markdown').then(undefined, (error: unknown) => {
        if (!document.isClosed) {
          output.warn(`Could not show ${document.uri.toString()} as Markdown: ${errorMessage(error)}`);
        }
      });
    }
  };
  vscode.workspace.textDocuments.forEach(openAsMarkdown);

  const browse = async (): Promise<void> => {
    try {
      await server.session.ensureStarted();
      const unavailable = browseUnavailableMessage(server.controller.status.current);
      if (unavailable !== undefined) {
        notify(vscode.window.showErrorMessage, unavailable, showOutputAction(output));
        return;
      }
      showBuiltinPicker(output);
    } catch (error) {
      output.error('AA2M: Browse Built-ins: ' + errorMessage(error));
      notify(vscode.window.showErrorMessage, errorMessage(error), showOutputAction(output));
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(openAsMarkdown),
    vscode.commands.registerCommand(COMMANDS.browseBuiltins, browse),
    server.controller.status.onDidChange(updateContext)
  );
  updateContext(server.controller.status.current);
}

/** Hides Browse Built-ins while a ready server lacks built-in pages. */
function updateContext(status: ServerStatus): void {
  const unsupported = readyServerLacks(status, features => features.builtinCatalog);
  void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.builtinCatalogUnsupported, unsupported);
}

async function searchBuiltins(query: string): Promise<BuiltinPickItem[]> {
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[] | undefined>(
    'vscode.executeWorkspaceSymbolProvider', query
  );
  return builtinPickItems((symbols ?? []).map(symbol => ({
    name: symbol.name, containerName: symbol.containerName, uri: symbol.location.uri.toString()
  })));
}

/**
 * Browse Built-ins: a quick pick that asks the server on every change of the
 * query and opens the chosen entry's page in the Markdown preview.
 */
function showBuiltinPicker(output: vscode.LogOutputChannel): void {
  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { uri: string }>();
  picker.placeholder = 'Search built-in actions, events, expressions and constants';
  picker.matchOnDescription = true;
  const update = async (query: string): Promise<void> => {
    picker.busy = true;
    try {
      const items = await searchBuiltins(query);
      // A later query may have answered first; keep only the current one.
      if (picker.value === query) {
        picker.items = items.map(item => ({ ...item, alwaysShow: true }));
      }
    } catch (error) {
      output.error('AA2M: Browse Built-ins search failed: ' + errorMessage(error));
    } finally {
      picker.busy = false;
    }
  };
  picker.onDidChangeValue(query => void update(query));
  picker.onDidAccept(() => {
    const [selected] = picker.selectedItems;
    picker.hide();
    if (selected) {
      void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.parse(selected.uri));
    }
  });
  picker.onDidHide(() => picker.dispose());
  void update('');
  picker.show();
}
