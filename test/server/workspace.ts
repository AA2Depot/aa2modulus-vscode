import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** An empty throwaway directory for files the checks write, removed by `dispose()`. */
export class TemporaryWorkspace {
  private constructor(readonly directory: string) {}

  static async create(): Promise<TemporaryWorkspace> {
    const directory = await mkdtemp(join(tmpdir(), 'aa2m-server-smoke-'));
    return new TemporaryWorkspace(directory);
  }

  path(name: string): string {
    return join(this.directory, name);
  }

  uri(name: string): string {
    return pathToFileURL(this.path(name)).href;
  }

  /** Whether a file exists at `uri`, a `file:` URI the server reported. */
  static async exists(uri: string): Promise<boolean> {
    try {
      await stat(new URL(uri));
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
