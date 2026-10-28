import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Executable } from 'vscode-languageclient/node';
import {
  createMessageConnection, type MessageConnection, StreamMessageReader, StreamMessageWriter
} from 'vscode-languageserver-protocol/node';
import { bounded } from '../support/wait';

/** An open document: its URI and the text last sent to the server. */
export interface OpenDocument {
  uri: string;
  text: string;
}

/** One spawned language server and a JSON-RPC connection to it over stdio. */
export class LspSession {
  readonly child: ChildProcess;
  /** Resolves with the exit code and signal once the server process ends. */
  readonly exited: Promise<[number | null, NodeJS.Signals | null]>;
  private readonly connection: MessageConnection;
  private readonly spawnFailure: Promise<never>;
  private stderr = '';

  constructor(executable: Executable) {
    this.child = spawn(executable.command, executable.args ?? [], executable.options ?? {});
    this.child.stderr?.on('data', chunk => {
      this.stderr += chunk.toString();
    });
    this.spawnFailure = new Promise<never>((_, reject) => this.child.once('error', reject));
    this.spawnFailure.catch(() => {}); // surfaced through request(); never unhandled
    this.exited = once(this.child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
    this.exited.catch(() => {}); // a failed spawn is reported by request()
    if (!this.child.stdout || !this.child.stdin) {
      throw new Error('Server process has no stdio pipes.');
    }
    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin)
    );
    // The smoke client advertises `window.showDocument` (decompile opens its output with it).
    this.connection.onRequest('window/showDocument', () => ({ success: true }));
    this.connection.listen();
  }

  get spawnArguments(): string[] {
    return this.child.spawnargs.slice(1);
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    return bounded(
      Promise.race([this.connection.sendRequest(method, params) as Promise<T>, this.spawnFailure]),
      method
    );
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.connection.sendNotification(method, params);
  }

  executeCommand<T = unknown>(command: string, argument: unknown): Promise<T> {
    return this.request<T>('workspace/executeCommand', { command, arguments: [argument] });
  }

  /** `initialize`, with the server's stderr appended to a failure. */
  async initialize<T>(params: unknown): Promise<T> {
    try {
      return await this.request<T>('initialize', params);
    } catch (error) {
      throw new Error(
        `${String(error)}${this.stderr ? `\nServer stderr:\n${this.stderr}` : ''}`, { cause: error });
    }
  }

  async openText(uri: string, languageId: string, text: string): Promise<OpenDocument> {
    await this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    return { uri, text };
  }

  change(uri: string, version: number, text: string): Promise<void> {
    return this.notify('textDocument/didChange', {
      textDocument: { uri, version }, contentChanges: [{ text }]
    });
  }

  /** `shutdown` then `exit`; the server must leave with status 0. */
  async shutdown(label: string): Promise<number | null> {
    await this.request('shutdown', null);
    await this.notify('exit');
    const [code] = await bounded(this.exited, label);
    return code;
  }

  dispose(): void {
    this.connection.dispose();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
    }
  }
}
