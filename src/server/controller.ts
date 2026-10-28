import { errorMessage } from '../shared/errors';
import { type ManagedClient, MODULE_COMMANDS_UNSUPPORTED_MESSAGE, SERVER_UNAVAILABLE_MESSAGE } from './managedClient';
import { isMissingExecutable } from './startFailure';
import { ServerStatusModel } from './status';

export const UNTRUSTED_COMMANDS_MESSAGE = 'Trust this workspace to run AA2M module commands.';

/**
 * Owns the current language client. Start, restart, shutdown and command
 * requests run one at a time on a single queue, so a restart never overlaps a
 * command or another restart. Every transition is published on `status`.
 */
export class ServerController {
  private pending = Promise.resolve();
  private client: ManagedClient | undefined;
  private disposed = false;

  constructor(
    private readonly canStart: () => boolean,
    private readonly createClient: () => ManagedClient,
    readonly status = new ServerStatusModel()
  ) {}

  /** Starts a fresh client, stopping the current one first. Rejects when the start fails. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) {
        return;
      }
      await this.stopClient();
      if (!this.canStart() || this.disposed) {
        this.status.set({ state: this.disposed ? 'stopped' : 'untrusted' });
        return;
      }
      let client: ManagedClient;
      try {
        client = this.createClient();
      } catch (error) {
        this.status.set({ state: 'failed', detail: errorMessage(error), missingExecutable: isMissingExecutable(error) });
        throw error;
      }
      this.client = client;
      this.status.set({ state: 'starting', ...client.details() });
      client.onDidCrash(reason => {
        if (this.client === client && this.status.current.state === 'ready') {
          this.status.set({ ...this.status.current, state: 'crashed', detail: reason });
        }
      });
      try {
        await client.start();
        this.status.set({ state: 'ready', ...client.details() });
      } catch (error) {
        this.status.set({
          state: 'failed',
          ...client.details(),
          detail: errorMessage(error),
          missingExecutable: isMissingExecutable(error)
        });
        try {
          await this.stopClient();
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Server startup and cleanup failed.', { cause: cleanupError });
        }
        throw error;
      }
    });
  }

  shutdown(): Promise<void> {
    this.disposed = true;
    return this.enqueue(async () => {
      await this.stopClient();
      this.status.set({ state: 'stopped' });
    });
  }

  executeCommand<T>(command: string, argument: unknown): Promise<T> {
    return this.enqueue(async () => this.commandClient().executeCommand<T>(command, argument));
  }

  /** Rejects unless the running server advertises every one of `commands`. */
  requireCommands(commands: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      const client = this.commandClient();
      if (commands.some(command => !client.supportsCommand(command))) {
        throw new Error(MODULE_COMMANDS_UNSUPPORTED_MESSAGE);
      }
    });
  }

  private commandClient(): ManagedClient {
    if (!this.canStart()) {
      throw new Error(UNTRUSTED_COMMANDS_MESSAGE);
    }
    if (this.disposed || this.client === undefined) {
      throw new Error(SERVER_UNAVAILABLE_MESSAGE);
    }
    return this.client;
  }

  private async stopClient(): Promise<void> {
    if (this.client !== undefined) {
      await this.client.dispose();
      this.client = undefined;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // The caller gets the failure; the queue goes on with the next operation.
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
}
