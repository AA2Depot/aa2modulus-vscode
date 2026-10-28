import type { ServerFeatures } from '../../src/server/serverFeatures';
import type { LspSession } from './lspSession';
import type { TemporaryWorkspace } from './workspace';

/** The `initialize` result, as the checks read it. */
export interface InitializeResult {
  capabilities: Record<string, unknown> & { workspace?: { textDocumentContent?: { schemes?: string[] } } };
  serverInfo?: { name?: string; version?: string };
}

/** What every check receives: the server session, a scratch directory and what the server advertised. */
export interface SmokeContext {
  session: LspSession;
  workspace: TemporaryWorkspace;
  initialized: InitializeResult;
  features: ServerFeatures;
}
