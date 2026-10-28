// What AA2M: New Module tells the user after the server start it triggers.
import { readyServerLacks } from '../server/serverFeatures';
import type { ServerStatus } from '../server/status';

/**
 * The message for a ready server that offers no module starter or keyword
 * snippets (`completionSnippets` not advertised), or undefined when the
 * server offers them or is not ready.
 */
export function starterUnavailableMessage(status: ServerStatus): string | undefined {
  if (!readyServerLacks(status, features => features.completionSnippets)) {
    return undefined;
  }
  return 'This AA2M server offers no module starter or keyword snippets. '
    + 'Use AA2M: Download Language Server… to get a current release.';
}
