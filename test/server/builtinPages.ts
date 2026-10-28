import assert from 'node:assert/strict';
import type { SymbolInformation } from 'vscode-languageserver-protocol';
import { BUILTIN_SCHEME, builtinPickItems } from '../../src/builtins/browse';
import type { SmokeContext } from './context';

/**
 * When the server advertises `builtinCatalog`: it registers the
 * `aa2m-builtin` content scheme (vscode-languageclient's provider depends on
 * it), Browse Built-ins finds pages in `workspace/symbol`, and a page found
 * there has content.
 */
export async function checkBuiltinPages({ session, initialized, features }: SmokeContext): Promise<string> {
  if (!features.builtinCatalog) {
    return 'built-in pages skipped (not advertised)';
  }
  assert.ok(
    initialized.capabilities.workspace?.textDocumentContent?.schemes?.includes(BUILTIN_SCHEME),
    'the server serves the aa2m-builtin scheme'
  );
  const symbols = await session.request<SymbolInformation[]>('workspace/symbol', { query: '' });
  const [first] = builtinPickItems(symbols.map(symbol => ({
    name: symbol.name, containerName: symbol.containerName, uri: symbol.location.uri
  })));
  assert.ok(first, 'workspace/symbol lists built-in pages');
  const page = await session.request<{ text: unknown }>('workspace/textDocumentContent', { uri: first.uri });
  assert.ok(typeof page.text === 'string' && page.text.trim() !== '', `${first.uri} has content`);
  return 'built-in pages';
}
