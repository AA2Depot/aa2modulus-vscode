// Browse Built-ins over the server's `workspace/symbol` results: the server
// lists built-ins located at their `aa2m-builtin:` pages after any authored
// symbols, and serves the pages itself.
import { readyServerLacks } from '../server/serverFeatures';
import type { ServerStatus } from '../server/status';

/** URI scheme of the server's read-only built-in pages, `aa2m-builtin:/<anchor>.md`. */
export const BUILTIN_SCHEME = 'aa2m-builtin';

/** The part of a workspace symbol the picker shows. */
export interface WorkspaceSymbolLike {
  name: string;
  containerName?: string;
  uri: string;
}

/** One Browse Built-ins entry: the built-in's name, its native name, and its page. */
export interface BuiltinPickItem {
  label: string;
  description: string;
  uri: string;
}

/** The built-ins among `symbols`, in the server's order. */
export function builtinPickItems(symbols: readonly WorkspaceSymbolLike[]): BuiltinPickItem[] {
  return symbols
    .filter(symbol => symbol.uri.startsWith(`${BUILTIN_SCHEME}:`))
    .map(symbol => ({ label: symbol.name, description: symbol.containerName ?? '', uri: symbol.uri }));
}

/**
 * Why Browse Built-ins cannot run after the start that `status` describes, or
 * undefined when the server serves built-in pages.
 */
export function browseUnavailableMessage(status: ServerStatus): string | undefined {
  if (status.state === 'untrusted') {
    return 'Trust this workspace to browse AA2M built-ins: the language server serves them.';
  }
  if (status.state !== 'ready') {
    return 'AA2M built-ins come from the language server, which is not running. '
      + 'Use AA2M: Restart Language Server and check the server settings.';
  }
  if (readyServerLacks(status, features => features.builtinCatalog)) {
    return 'This AA2M server does not serve built-in documentation. '
      + 'Use AA2M: Download Language Server… to get a current release.';
  }
  return undefined;
}
