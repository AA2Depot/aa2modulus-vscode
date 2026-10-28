import type { ServerFeatures } from './serverFeatures';

export type ServerState = 'untrusted' | 'starting' | 'ready' | 'stopped' | 'failed' | 'crashed';

/** What a managed client knows about itself; every field is optional. */
export interface ClientDetails {
  /** Configured command line, as launched. */
  command?: string;
  /** `initializeResult.serverInfo`, after initialization. */
  serverName?: string;
  serverVersion?: string;
  /** What the server advertised, after initialization. */
  features?: ServerFeatures;
  /** Non-blocking compatibility problem found after initialization. */
  warning?: string;
}

export interface ServerStatus extends ClientDetails {
  state: ServerState;
  /** Failure or crash reason. */
  detail?: string;
  /** The startup failure was a missing or non-executable command. */
  missingExecutable?: boolean;
}

export class ServerStatusModel {
  private status: ServerStatus = { state: 'stopped' };
  private readonly listeners = new Set<(status: ServerStatus, previous: ServerStatus) => void>();

  get current(): ServerStatus {
    return this.status;
  }

  set(status: ServerStatus): void {
    const previous = this.status;
    this.status = status;
    for (const listener of [...this.listeners]) {
      listener(status, previous);
    }
  }

  onDidChange(listener: (status: ServerStatus, previous: ServerStatus) => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }
}

/** `serverInfo` name and version for display, or an empty string before initialization. */
export function serverLabel(details: ClientDetails): string {
  return [details.serverName, details.serverVersion].filter(Boolean).join(' ');
}
