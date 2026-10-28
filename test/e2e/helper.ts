import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AA2MExtensionApi } from '../../src/extension';
import { waitFor } from '../support/wait';

export { waitFor } from '../support/wait';

export const EXTENSION_ID = 'AA2Depot.aa2m';

export function loadExtension(): vscode.Extension<AA2MExtensionApi> {
  const extension = vscode.extensions.getExtension<AA2MExtensionApi>(EXTENSION_ID);
  assert.ok(extension, 'AA2M extension is loaded.');
  return extension;
}

/** Loads, activates and waits for the extension API (starts the server on first AA2M use). */
export async function activateExtension(): Promise<vscode.Extension<AA2MExtensionApi>> {
  const extension = loadExtension();
  await extension.activate();
  await extension.exports.whenSettled();
  return extension;
}

/** A file in the suite's own copy of `test/fixtures/workspace`. */
export function fixtureUri(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'The runner opens a copy of test/fixtures/workspace.');
  return vscode.Uri.file(path.join(folder.uri.fsPath, name));
}

/** Opens and shows `uri`, then waits until the server start it triggers has settled. */
export async function activateDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  await activateExtension();
  return document;
}

/** Writes `text` to `uri`, creating the file. */
export async function writeFile(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
}

export async function deleteIfPresent(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(uri).then(undefined, () => undefined);
}

/** The suggestions VS Code would list at `position`, sorted as the server ranked them. */
export async function rankedCompletions(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.CompletionItem[]> {
  const list = await waitFor(
    () => vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position),
    value => (value?.items.length ?? 0) > 0,
    'suggestions from the server'
  );
  return [...list.items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
}

/**
 * Inserts the server's first-ranked suggestion for the empty document in
 * `editor`, as a user accepting the starter of a new file does. This is how
 * the suites get valid source without knowing the language.
 */
export async function insertStarter(editor: vscode.TextEditor): Promise<vscode.CompletionItem> {
  assert.equal(editor.document.getText().trim(), '', 'the starter goes into an empty document');
  const [starter] = await rankedCompletions(editor.document, new vscode.Position(0, 0));
  assert.ok(starter.insertText instanceof vscode.SnippetString, 'the first suggestion in an empty document is a snippet');
  assert.equal(await editor.insertSnippet(starter.insertText, new vscode.Position(0, 0)), true);
  return starter;
}

/** The `aa2m-builtin:` pages the server lists for an empty query. */
export async function builtinPages(): Promise<vscode.Uri[]> {
  const symbols = await waitFor(
    () => vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', ''),
    value => value?.some(symbol => symbol.location.uri.scheme === 'aa2m-builtin') ?? false,
    'built-in pages in workspace/symbol'
  );
  return symbols.map(symbol => symbol.location.uri).filter(uri => uri.scheme === 'aa2m-builtin');
}

/** A notification the extension showed: its text and buttons. */
export interface Notice {
  message: string;
  actions: string[];
}

type ShowMessage = (message: string, ...actions: string[]) => Thenable<string | undefined>;

/**
 * Records every notification `kind` shows. `answer` picks the button the
 * "user" clicks (undefined closes it). Returns the recorded notices and a
 * function that restores the original.
 */
export function recordNotices(
  kind: 'showErrorMessage' | 'showWarningMessage' | 'showInformationMessage',
  answer: (notice: Notice) => string | undefined = () => undefined
): { notices: Notice[]; restore: () => void } {
  const notices: Notice[] = [];
  const show: ShowMessage = (message, ...actions) => {
    const notice = { message, actions };
    notices.push(notice);
    return Promise.resolve(answer(notice));
  };
  return { notices, restore: replace(vscode.window, kind, show as unknown as typeof vscode.window[typeof kind]) };
}

/**
 * Replaces `target[key]` (a `vscode` API, in e2e tests) and returns a function
 * that restores the original. Call it in `finally`.
 */
export function replace<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}
