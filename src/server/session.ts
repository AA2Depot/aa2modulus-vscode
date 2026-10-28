import type { ServerController } from './controller';

/** How the latest start or restart ended. A start skipped in an untrusted workspace did not fail. */
export type StartOutcome = { failed: false } | { failed: true; error: unknown };

/**
 * Decides when the server runs. It starts on first AA2M use (an AA2M document
 * or a server command), never on activation alone: the Markdown preview
 * activates the extension too. Once started, it restarts on request.
 *
 * The session reports every failed start through `reportFailure` and never
 * rejects; callers that need the error read it from the `StartOutcome`.
 */
export class ServerSession {
  private started = false;
  private settled: Promise<StartOutcome> = Promise.resolve({ failed: false });

  constructor(
    private readonly controller: ServerController,
    private readonly reportFailure: (error: unknown) => void
  ) {}

  /** Settles when the latest start or restart has finished. */
  whenSettled(): Promise<StartOutcome> {
    return this.settled;
  }

  /** Starts or restarts the server. */
  restart(): Promise<StartOutcome> {
    this.started = true;
    this.settled = this.controller.start().then(
      (): StartOutcome => ({ failed: false }),
      (error: unknown): StartOutcome => {
        this.reportFailure(error);
        return { failed: true, error };
      }
    );
    return this.settled;
  }

  /** Starts the server unless it was started before. */
  ensureStarted(): Promise<StartOutcome> {
    return this.started ? this.settled : this.restart();
  }

  /** Restarts after a settings change or trust grant, but only once the server is in use. */
  restartIfStarted(): void {
    if (this.started) {
      void this.restart();
    }
  }
}

/** Throws the error of a failed outcome; for callers that report failures themselves. */
export function throwIfFailed(outcome: StartOutcome): void {
  if (outcome.failed) {
    throw outcome.error;
  }
}
