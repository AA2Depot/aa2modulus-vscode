import {
  CLIENT_STATE, type LanguageClientLifecycle, type ManagedClient, type ManagedClientOptions, ManagedLanguageClient
} from '../../../src/server/managedClient';
import { readServerFeatures } from '../../../src/server/serverFeatures';

/** A managed client with only `start` and `dispose` behaviour; everything else is inert unless overridden. */
export function fakeClient(members: Pick<ManagedClient, 'start' | 'dispose'> & Partial<ManagedClient>): ManagedClient {
  return {
    async executeCommand<T>(): Promise<T> {
      throw new Error('This fake client runs no commands.');
    },
    supportsCommand: () => false,
    details: () => ({}),
    onDidCrash() {},
    ...members
  };
}

/** `capabilities.experimental.aa2modulus` of a current server; tests spread it to change one field. */
export const CURRENT_AA2MODULUS = {
  contractVersion: 2,
  builtinCatalog: true,
  completionSnippets: true,
  syntax: { version: 1, fingerprint: 'a'.repeat(64) }
};

/** Capabilities of a current server: supported contract, built-in pages and snippets, no commands. */
export const CURRENT_CAPABILITIES = { experimental: { aa2modulus: CURRENT_AA2MODULUS } };

/** What `readServerFeatures` makes of `CURRENT_CAPABILITIES`. */
export const CURRENT_FEATURES = readServerFeatures(CURRENT_CAPABILITIES);

/** Current capabilities that also advertise `commands`. */
export function capabilitiesWithCommands(...commands: string[]): unknown {
  return { ...CURRENT_CAPABILITIES, executeCommandProvider: { commands } };
}

export interface FakeLanguageClientOptions {
  /** `start` moves to StartFailed and rejects with this value. */
  failStart?: unknown;
  /** `start` never settles, like a server that never answers `initialize`. */
  hangStart?: boolean;
  /** `initializeResult.capabilities` after a successful start; defaults to `CURRENT_CAPABILITIES`. */
  capabilities?: unknown;
  serverInfo?: { name?: unknown; version?: unknown };
  /** What `sendRequest` resolves with. */
  response?: unknown;
  /** `dispose` rejects with this error, like the library refusing to stop a client that is not running. */
  refuseDispose?: Error;
}

/**
 * A vscode-languageclient `LanguageClient` stand-in: it moves through the
 * library's states and reports changes like `onDidChangeState`.
 */
export class FakeLanguageClient implements LanguageClientLifecycle {
  state: number = CLIENT_STATE.stopped;
  initializeResult?: LanguageClientLifecycle['initializeResult'];
  /** While set, `dispose` rejects with it, like the library refusing to stop. */
  disposeError?: Error;
  readonly requests: { method: string; params: unknown }[] = [];
  diagnosticsDisposed = 0;
  readonly diagnostics = {
    dispose: () => {
      this.diagnosticsDisposed++;
    }
  };
  private readonly listeners = new Set<(event: { oldState: number; newState: number }) => void>();

  constructor(private readonly options: FakeLanguageClientOptions = {}) {
    this.disposeError = options.refuseDispose;
  }

  async start(): Promise<void> {
    this.move(CLIENT_STATE.starting);
    if (this.options.hangStart) {
      await new Promise<never>(() => {});
    }
    if (this.options.failStart !== undefined) {
      this.move(CLIENT_STATE.startFailed);
      throw this.options.failStart;
    }
    this.initializeResult = {
      capabilities: this.options.capabilities ?? CURRENT_CAPABILITIES,
      serverInfo: this.options.serverInfo
    };
    this.move(CLIENT_STATE.running);
  }

  async dispose(): Promise<void> {
    if (this.disposeError) {
      throw this.disposeError;
    }
    this.move(CLIENT_STATE.stopped);
  }

  isRunning(): boolean {
    return this.state === CLIENT_STATE.running;
  }

  async sendRequest<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    return this.options.response as T;
  }

  onDidChangeState(listener: (event: { oldState: number; newState: number }) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  /** The server process exits on its own. */
  crash(): void {
    this.move(CLIENT_STATE.stopped);
  }

  private move(newState: number): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.listeners.forEach(listener => listener({ oldState, newState }));
    }
  }
}

/** `ManagedLanguageClient` over `client`, with a no-op cleanup callback unless `options` sets one. */
export function managed(
  client: LanguageClientLifecycle,
  options: Partial<ManagedClientOptions> = {}
): ManagedLanguageClient {
  return new ManagedLanguageClient(client, { onFailedCleanup() {}, ...options });
}
