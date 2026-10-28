import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerFeatures } from '../../../src/server/serverFeatures';
import { capabilitiesWithCommands, CURRENT_AA2MODULUS, FakeLanguageClient, managed } from './fakes';

const COMPILE = 'aa2modulus.compileDocument';
const DECOMPILE = 'aa2modulus.decompileModule';

test('module commands go out as workspace/executeCommand with the structured argument', async () => {
  const library = new FakeLanguageClient({
    capabilities: capabilitiesWithCommands(COMPILE),
    response: { compiled: true, errors: 0, warnings: 0, unlocated: [] }
  });
  const client = managed(library);
  const argument = { textDocument: { uri: 'file:///source.aa2m', version: 7 }, outputUri: 'file:///binary' };
  await assert.rejects(client.executeCommand(COMPILE, argument), /unavailable/, 'nothing is sent before startup');
  await client.start();
  assert.equal(client.supportsCommand(COMPILE), true);
  assert.equal(client.supportsCommand(DECOMPILE), false);
  assert.deepEqual(
    await client.executeCommand(COMPILE, argument), { compiled: true, errors: 0, warnings: 0, unlocated: [] }
  );
  await assert.rejects(client.executeCommand(DECOMPILE, {}), /does not support module commands/);
  assert.deepEqual(library.requests, [
    { method: 'workspace/executeCommand', params: { command: COMPILE, arguments: [argument] } }
  ]);
});

test('servers without the command and closed connections receive no requests', async () => {
  const library = new FakeLanguageClient({ capabilities: capabilitiesWithCommands() });
  const client = managed(library);
  await client.start();
  await assert.rejects(client.executeCommand(COMPILE, {}), /does not support module commands/);
  library.crash();
  await assert.rejects(client.executeCommand(COMPILE, {}), /unavailable/);
  assert.deepEqual(library.requests, []);
});

test('an older or missing contract gates module commands with a warning and still starts', async () => {
  for (const contractVersion of [1, undefined]) {
    const reported: ServerFeatures[] = [];
    const library = new FakeLanguageClient({ capabilities: {
      executeCommandProvider: { commands: [COMPILE] },
      experimental: { aa2modulus: { ...CURRENT_AA2MODULUS, contractVersion } }
    } });
    const client = managed(library, { onUnsupportedContract: features => reported.push(features) });
    await client.start();
    assert.equal(client.supportsCommand(COMPILE), false, `contract ${contractVersion} gates commands`);
    await assert.rejects(client.executeCommand(COMPILE, {}), /does not support module commands/);
    assert.equal(client.details().warning, 'Server too old for module commands');
    assert.deepEqual(reported.map(features => features.contractVersion), [contractVersion]);
    assert.deepEqual(library.requests, []);
  }
});

test('a newer contract gates module commands with its own warning', async () => {
  let reports = 0;
  const client = managed(new FakeLanguageClient({ capabilities: {
    executeCommandProvider: { commands: [COMPILE] },
    experimental: { aa2modulus: { ...CURRENT_AA2MODULUS, contractVersion: 3 } }
  } }), { onUnsupportedContract: () => reports++ });
  await client.start();
  assert.equal(client.supportsCommand(COMPILE), false);
  assert.equal(client.details().warning, 'Server too new for module commands');
  assert.equal(reports, 1);
});

test('details carry the advertised features only after initialization', async () => {
  const client = managed(new FakeLanguageClient({ serverInfo: { name: 'aa2modulus', version: 'dev' } }), { command: 'x' });
  assert.deepEqual(client.details(), { command: 'x' });
  await client.start();
  const details = client.details();
  assert.equal(details.serverVersion, 'dev', 'any version string is shown and decides nothing');
  assert.equal(details.features?.builtinCatalog, true);
});
