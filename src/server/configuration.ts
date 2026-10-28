import { isAbsolute } from 'node:path';
import type { Executable } from 'vscode-languageclient/node';

export interface ServerConfiguration {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ServerSettings {
  command?: unknown;
  args?: unknown;
  cwd?: unknown;
}

/** Defaults of `aa2m.server.command` and `aa2m.server.args`; `package.json` declares the same values. */
export const DEFAULT_SERVER_COMMAND = 'aa2modulus';
export const DEFAULT_SERVER_ARGS: readonly string[] = ['lsp-server'];

/** `aa2m.server.command` is empty: no server is set up yet. */
export class ServerCommandNotSetError extends Error {
  constructor() {
    super('aa2m.server.command is empty. Download a release or select an aa2modulus executable.');
    this.name = 'ServerCommandNotSetError';
  }
}

/** A settings value that names a server: a string that is not blank. */
export function isServerCommandSet(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function readServerConfiguration(settings: ServerSettings): ServerConfiguration {
  const command = settings.command ?? DEFAULT_SERVER_COMMAND;
  const args = settings.args ?? DEFAULT_SERVER_ARGS;
  const cwd = settings.cwd ?? '';
  if (typeof command === 'string' && command.trim() === '') {
    throw new ServerCommandNotSetError();
  }
  if (typeof command !== 'string' || command.includes('\0')) {
    throw new Error('aa2m.server.command must be a nonempty executable path or command name.');
  }
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('aa2m.server.args must be an array of strings without null characters.');
  }
  if (typeof cwd !== 'string' || cwd.includes('\0') || (cwd !== '' && !isAbsolute(cwd))) {
    throw new Error('aa2m.server.cwd must be an absolute directory path or an empty string.');
  }
  const configuration: ServerConfiguration = { command, args: [...args] };
  if (cwd !== '') {
    configuration.cwd = cwd;
  }
  return configuration;
}

export function createServerOptions(configuration: ServerConfiguration): Executable {
  return {
    command: configuration.command,
    args: [...configuration.args],
    // An Executable defaults to stdio streams. Explicit stdio transport in
    // vscode-languageclient adds --stdio, which this server doesn't accept.
    options: { shell: false, cwd: configuration.cwd }
  };
}
