// Headless check that a supplied aa2modulus lsp-server executable still meets
// the facts this extension reads (docs/server-contract.md). It speaks plain
// LSP over stdio and holds no AA2M source: the toolchain's own tests own the
// server's behaviour and the language. Required: launch, initialize with a
// supported contract, shutdown, and a lexicon that still matches the static
// grammar. Optional features are checked only when the server advertises
// them. The editor side is covered by test/e2e.
//
// Environment: AA2M_SERVER_COMMAND (required), AA2M_SERVER_ARGS (JSON array),
// AA2M_SERVER_CWD (optional).
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createServerOptions } from '../../src/server/configuration';
import { readServerFeatures } from '../../src/server/serverFeatures';
import { serverConfigurationFromEnvironment } from '../support/serverEnvironment';
import { checkBuiltinPages } from './builtinPages';
import type { SmokeContext } from './context';
import { initializeServer } from './initialize';
import { checkLexicon } from './lexicon';
import { LspSession } from './lspSession';
import { checkModuleCommands } from './moduleCommands';
import { TemporaryWorkspace } from './workspace';

async function main(): Promise<void> {
  const configuration = serverConfigurationFromEnvironment();
  const workspace = await TemporaryWorkspace.create();
  let session: LspSession | undefined;
  try {
    session = new LspSession(createServerOptions(configuration));
    assert.deepEqual(
      session.spawnArguments, configuration.args, 'server must receive exactly the configured arguments'
    );
    const initialized = await initializeServer(session, pathToFileURL(workspace.directory).href);
    const context: SmokeContext = {
      session, workspace, initialized, features: readServerFeatures(initialized.capabilities)
    };
    const checked = [
      await checkBuiltinPages(context), await checkModuleCommands(context), await checkLexicon(configuration)
    ];
    assert.equal(await session.shutdown('server exit'), 0);
    const server = [initialized.serverInfo?.name, initialized.serverInfo?.version].filter(Boolean).join(' ');
    console.log(`Server smoke passed for ${server || 'an unnamed server'}: launch, contract, `
      + `${checked.join(', ')}, shutdown.`);
  } finally {
    session?.dispose();
    await workspace.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
