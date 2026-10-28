import assert from 'node:assert/strict';
import type { CompletionItem, CompletionList } from 'vscode-languageserver-protocol';
import { readCompileResult, readDecompileResult, SERVER_COMMANDS } from '../../src/moduleCommands/protocol';
import { hasCommand } from '../../src/server/serverFeatures';
import type { SmokeContext } from './context';
import { expandSnippet } from './snippet';
import { TemporaryWorkspace } from './workspace';

const SNIPPET_FORMAT = 2;

/**
 * When the server advertises the module commands: their results have the
 * shapes `src/moduleCommands/protocol.ts` reads. The source is the server's
 * own starter for an empty module, so this check holds no AA2M code.
 */
export async function checkModuleCommands(context: SmokeContext): Promise<string> {
  const { session, workspace, features } = context;
  if (!hasCommand(features, SERVER_COMMANDS.compileDocument)) {
    return 'module commands skipped (not advertised)';
  }
  const source = await starterModule(context);
  if (source === undefined) {
    return 'module commands skipped (no starter to compile; completionSnippets not advertised)';
  }
  const compiled = readCompileResult(await session.executeCommand(SERVER_COMMANDS.compileDocument, {
    textDocument: { uri: source, version: 2 }, outputUri: workspace.uri('binary')
  }));
  if (!compiled.compiled || !hasCommand(features, SERVER_COMMANDS.decompileModule)) {
    return 'compile result shape (decompile skipped)';
  }
  const recovered = readDecompileResult(await session.executeCommand(
    SERVER_COMMANDS.decompileModule, { inputUri: workspace.uri('binary') }
  ));
  assert.ok(await TemporaryWorkspace.exists(recovered.outputUri), 'decompile wrote the file it reports');
  return 'compile and decompile result shapes';
}

/**
 * Opens an empty module, accepts the first-ranked snippet the server offers
 * there and returns the document URI at version 2; undefined without one.
 */
async function starterModule({ session, workspace, features }: SmokeContext): Promise<string | undefined> {
  if (!features.completionSnippets) {
    return undefined;
  }
  const uri = workspace.uri('starter.aa2m');
  await session.openText(uri, 'aa2m', '');
  const result = await session.request<CompletionList | CompletionItem[] | null>('textDocument/completion', {
    textDocument: { uri }, position: { line: 0, character: 0 }
  });
  const items = (Array.isArray(result) ? result : result?.items ?? [])
    .filter(item => item.insertTextFormat === SNIPPET_FORMAT)
    .sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
  const [starter] = items;
  if (starter === undefined) {
    return undefined;
  }
  const edit = starter.textEdit;
  const text = expandSnippet(edit && 'newText' in edit ? edit.newText : starter.insertText ?? '');
  await session.change(uri, 2, text);
  return uri;
}
