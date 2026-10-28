import {
  describeUnsupportedContract, hasCommand, NO_FEATURES, readServerFeatures, type ServerFeatures
} from './serverFeatures';
import type { ClientDetails } from './status';

export const SERVER_UNAVAILABLE_MESSAGE =
  'AA2M language server is unavailable. Use AA2M: Restart Language Server and check the server settings.';
export const MODULE_COMMANDS_UNSUPPORTED_MESSAGE = 'This AA2M server does not support module commands. '
  + 'Use AA2M: Download Language Server… to get a current release, or configure an updated aa2modulus executable.';

/** One language client session as the controller drives it. */
export interface ManagedClient {
  start(): Promise<void>;
  dispose(): Promise<void>;
  executeCommand<T>(command: string, argument: unknown): Promise<T>;
  supportsCommand(command: string): boolean;
  /** Command line, server info, advertised features and compatibility warnings, as far as known. */
  details(): ClientDetails;
  /** Registers a listener for a connection loss after startup that dispose did not cause. */
  onDidCrash(listener: (reason: string) => void): void;
}

/** How long a server may take to answer `initialize` before the start fails. */
export const STARTUP_TIMEOUT_MS = 15000;

/** vscode-languageclient `State` values; importing the enum would load vscode. */
export const CLIENT_STATE = { stopped: 1, running: 2, starting: 3, startFailed: 4 } as const;

/** The part of a vscode-languageclient `LanguageClient` that `ManagedLanguageClient` uses. */
export interface LanguageClientLifecycle {
  start(): Promise<void>;
  dispose(): Promise<void>;
  isRunning(): boolean;
  readonly diagnostics?: { dispose(): void };
  readonly initializeResult?: { capabilities: unknown; serverInfo?: { name?: unknown; version?: unknown } };
  sendRequest?<T>(method: string, params: unknown): Promise<T>;
  onDidChangeState?(listener: (event: { oldState: number; newState: number }) => void): { dispose(): void };
}

/** Settings and callbacks of a managed client; the compatibility callbacks are informational only. */
export interface ManagedClientOptions {
  /** Called when the library refuses to stop a client whose start failed. */
  onFailedCleanup(error: unknown): void;
  /** How long `initialize` may take; defaults to `STARTUP_TIMEOUT_MS`. */
  startupTimeoutMs?: number;
  /** Command line shown in the server status. */
  command?: string;
  /** Called when the contract version is missing or differs from `SUPPORTED_CONTRACT_VERSION`. */
  onUnsupportedContract?(features: ServerFeatures): void;
}

/**
 * Adapts a vscode-languageclient instance to `ManagedClient`: bounded startup,
 * cleanup after a failed start, crash detection, the advertised features, and
 * capability checks for module commands. An unsupported contract version
 * blocks module commands only; authoring features are plain LSP and keep
 * working.
 */
export class ManagedLanguageClient implements ManagedClient {
  /** `start` failed: a later connection loss is not a crash. */
  private failedStart = false;
  /** The server answered `initialize`. */
  private initialized = false;
  private advertised: ServerFeatures = NO_FEATURES;
  /** `dispose` was called: a later connection loss is not a crash. */
  private disposing = false;
  /** Compatibility problems found after `initialize`, shown in the status. */
  private readonly warnings: string[] = [];
  private readonly crashListeners: ((reason: string) => void)[] = [];
  private readonly stateSubscription: { dispose(): void } | undefined;

  constructor(
    private readonly client: LanguageClientLifecycle,
    private readonly options: ManagedClientOptions
  ) {
    this.stateSubscription = client.onDidChangeState?.(event => {
      const lost = event.oldState === CLIENT_STATE.running && event.newState === CLIENT_STATE.stopped;
      if (!this.disposing && !this.failedStart && lost) {
        this.crashListeners.splice(0).forEach(listener => listener('The server connection closed.'));
      }
    });
  }

  async start(): Promise<void> {
    try {
      await this.initializeWithin(this.options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
      this.initialized = true;
      this.advertised = readServerFeatures(this.client.initializeResult?.capabilities);
      this.reportCompatibility();
    } catch (error) {
      this.failedStart = true;
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposing = true;
    this.stateSubscription?.dispose();
    const inactiveAfterFailure = this.failedStart && !this.initialized && !this.client.isRunning();
    try {
      await this.client.dispose();
    } catch (error) {
      if (!inactiveAfterFailure) {
        throw error;
      }
      // vscode-languageclient 9 to 11 reject stop unless Running. Their Node
      // shutdown terminates the child in finally; dispose pre-initialization
      // diagnostics too.
      this.client.diagnostics?.dispose();
      this.options.onFailedCleanup(error);
    }
  }

  async executeCommand<T>(command: string, argument: unknown): Promise<T> {
    if (!this.initialized || !this.client.isRunning()) {
      throw new Error(SERVER_UNAVAILABLE_MESSAGE);
    }
    if (!this.client.sendRequest || !this.supportsCommand(command)) {
      throw new Error(MODULE_COMMANDS_UNSUPPORTED_MESSAGE);
    }
    return this.client.sendRequest<T>('workspace/executeCommand', { command, arguments: [argument] });
  }

  supportsCommand(command: string): boolean {
    return this.initialized && this.client.isRunning() && hasCommand(this.advertised, command);
  }

  details(): ClientDetails {
    const details: ClientDetails = {};
    if (this.options.command !== undefined) {
      details.command = this.options.command;
    }
    const info = this.initialized ? this.client.initializeResult?.serverInfo : undefined;
    if (typeof info?.name === 'string' && info.name) {
      details.serverName = info.name;
    }
    if (typeof info?.version === 'string' && info.version) {
      details.serverVersion = info.version;
    }
    if (this.initialized) {
      details.features = this.advertised;
    }
    if (this.warnings.length > 0) {
      details.warning = this.warnings.join('; ');
    }
    return details;
  }

  onDidCrash(listener: (reason: string) => void): void {
    this.crashListeners.push(listener);
  }

  /** Starts the client; rejects when `initialize` takes longer than `timeoutMs`. */
  private async initializeWithin(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Server did not initialize within ${timeoutMs / 1000} seconds.`)), timeoutMs);
    });
    try {
      await Promise.race([this.client.start(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Records a warning and calls the option callback for an unsupported contract version; never blocks the start. */
  private reportCompatibility(): void {
    if (!this.advertised.isContractSupported) {
      this.warnings.push(describeUnsupportedContract(this.advertised).warning);
      this.options.onUnsupportedContract?.(this.advertised);
    }
  }
}
