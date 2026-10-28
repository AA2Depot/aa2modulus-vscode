import assert from 'node:assert/strict';
import { readServerFeatures, SUPPORTED_CONTRACT_VERSION } from '../../src/server/serverFeatures';
import type { InitializeResult } from './context';
import type { LspSession } from './lspSession';

/**
 * The client capabilities the extension's features depend on, as
 * vscode-languageclient 11 advertises them (without dynamic registration,
 * which this plain session does not serve): built-in pages need
 * `textDocumentContent`, keyword snippets `snippetSupport`, and decompile
 * opens its output through `showDocument`.
 */
export const CLIENT_CAPABILITIES = {
  textDocument: { completion: { completionItem: { snippetSupport: true } } },
  workspace: { textDocumentContent: { dynamicRegistration: false }, symbol: {} },
  window: { showDocument: { support: true } },
  general: { positionEncodings: ['utf-16'] }
};

/** Initializes the session; the contract version must be one this extension supports. */
export async function initializeServer(session: LspSession, rootUri: string): Promise<InitializeResult> {
  const initialized = await session.initialize<InitializeResult>({
    processId: process.pid,
    rootUri,
    capabilities: CLIENT_CAPABILITIES
  });
  const features = readServerFeatures(initialized.capabilities);
  assert.ok(
    features.isContractSupported,
    `server contract ${String(features.contractVersion)} is ${SUPPORTED_CONTRACT_VERSION}`
  );
  await session.notify('initialized', {});
  return initialized;
}
