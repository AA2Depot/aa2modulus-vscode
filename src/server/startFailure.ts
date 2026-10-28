import { errorMessage } from '../shared/errors';
import { DEFAULT_SERVER_COMMAND, ServerCommandNotSetError } from './configuration';
import type { StartOutcome } from './session';
import type { ServerStatus } from './status';

/** Spawn failures meaning "not found" or "not executable", and an empty `aa2m.server.command`. */
export function isMissingExecutable(error: unknown): boolean {
  if (error instanceof ServerCommandNotSetError) {
    return true;
  }
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === 'ENOENT' || code === 'EACCES') {
    return true;
  }
  // vscode-languageclient 9 to 11 reject a failed spawn with a string such as
  // "Launching server using command x failed. Error: spawn x ENOENT".
  return /\bspawn\b.*\b(ENOENT|EACCES)\b/.test(errorMessage(error));
}

/**
 * The error notification for a failed start. `notFound` offers Download and
 * Select; the setup notification replaces it when that one is shown.
 * `startError` points at the server settings.
 */
export type StartFailureNotice =
  | { kind: 'notFound'; message: string }
  | { kind: 'startError'; message: string };

export function startFailureNotice(status: ServerStatus, error: unknown): StartFailureNotice {
  if (!status.missingExecutable) {
    return {
      kind: 'startError',
      message: 'AA2M language server could not start. Check aa2m.server.command and aa2m.server.args. '
        + errorMessage(error)
    };
  }
  let problem: string;
  if (error instanceof ServerCommandNotSetError) {
    problem = 'No AA2M language server is set up: aa2m.server.command is empty. ';
  } else {
    const command = status.command ?? DEFAULT_SERVER_COMMAND;
    problem = `AA2M language server executable ${JSON.stringify(command)} was not found or is not executable. `;
  }
  return { kind: 'notFound', message: problem + 'Download a release or select the aa2modulus executable to start it.' };
}

/**
 * Whether activation should offer server setup once the first start settled.
 * A failed start offers it through its own notice, so only a start that did
 * not fail and left no ready server (never started, or untrusted) needs it.
 */
export function needsSetupOfferAfterStart(outcome: StartOutcome, status: ServerStatus): boolean {
  return !outcome.failed && status.state !== 'ready';
}
