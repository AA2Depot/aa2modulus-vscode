// The controller driving a real ManagedLanguageClient over a fake
// vscode-languageclient: status transitions, cleanup and crash detection.
// Controller-only behaviour is in controller.test.ts, the adapter alone in
// managedClient.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerController } from '../../../src/server/controller';
import type { ServerState, ServerStatus } from '../../../src/server/status';
import { describeStatus } from '../../../src/server/statusPresentation';
import { CURRENT_AA2MODULUS, CURRENT_FEATURES, FakeLanguageClient, type FakeLanguageClientOptions, managed } from './fakes';

/** A controller whose every start creates a fake library client; `options(n)` configures the nth (from 1). */
function lifecycle(options: (attempt: number) => FakeLanguageClientOptions = () => ({}), command = 'aa2modulus lsp-server') {
  const clients: FakeLanguageClient[] = [];
  const cleanupFailures: unknown[] = [];
  const controller = new ServerController(() => true, () => {
    const clientOptions = options(clients.length + 1);
    const client = new FakeLanguageClient(clientOptions);
    clients.push(client);
    return managed(client, {
      command,
      startupTimeoutMs: clientOptions.hangStart ? 5 : undefined,
      onFailedCleanup: error => cleanupFailures.push(error)
    });
  });
  const statuses: ServerStatus[] = [];
  const states: ServerState[] = [];
  controller.status.onDidChange(status => {
    statuses.push(status);
    states.push(status.state);
  });
  return { controller, clients, cleanupFailures, statuses, states };
}

test('start reports starting, then ready with the command and server version', async () => {
  const value = lifecycle(() => ({ serverInfo: { name: 'aa2modulus', version: '0.1.0' } }), '/opt/aa2modulus lsp-server');
  await value.controller.start();
  assert.deepEqual(value.states, ['starting', 'ready']);
  assert.deepEqual(value.controller.status.current, {
    state: 'ready', command: '/opt/aa2modulus lsp-server', serverName: 'aa2modulus', serverVersion: '0.1.0',
    features: CURRENT_FEATURES
  });
  await value.controller.shutdown();
  assert.deepEqual(value.states, ['starting', 'ready', 'stopped']);
});

test('a spawn failure reports a missing executable and the next start replaces the client', async () => {
  const failure = 'Launching server using command aa2modulus failed. Error: spawn aa2modulus ENOENT';
  // vscode-languageclient refuses to stop a client whose start failed.
  const refused = new Error('Client is not running');
  const value = lifecycle(attempt => attempt === 1 ? { failStart: failure, refuseDispose: refused } : {});
  await assert.rejects(value.controller.start());
  assert.deepEqual(value.states, ['starting', 'failed']);
  assert.equal(value.controller.status.current.missingExecutable, true);
  assert.equal(value.controller.status.current.detail, failure);
  assert.equal(value.controller.status.current.command, 'aa2modulus lsp-server');
  assert.deepEqual(value.cleanupFailures, [refused], 'the refusal is reported, not thrown');
  assert.equal(value.clients[0].diagnosticsDisposed, 1);
  await value.controller.start();
  assert.equal(value.controller.status.current.state, 'ready');
  await value.controller.shutdown();
});

test('a server that never initializes times out, is cleaned up and releases a queued restart', async () => {
  const value = lifecycle(attempt => attempt === 1
    ? { hangStart: true, refuseDispose: new Error('Client is still starting') }
    : {});
  const first = value.controller.start();
  const second = value.controller.start();
  await assert.rejects(first, /did not initialize/);
  // The queued restart may already have run, so read the recorded failure.
  assert.equal(value.statuses[1].state, 'failed');
  assert.equal(value.statuses[1].missingExecutable, false, 'a timeout is not a missing executable');
  await second;
  assert.equal(value.controller.status.current.state, 'ready');
  assert.equal(value.clients.length, 2);
  assert.equal(value.clients[0].diagnosticsDisposed, 1);
  assert.equal(value.cleanupFailures.length, 1);
  await value.controller.shutdown();
});

test('a running client that fails to stop is not replaced, and the failure is not hidden', async () => {
  const value = lifecycle(() => ({ refuseDispose: new Error('shutdown timed out') }));
  await value.controller.start();
  await assert.rejects(value.controller.start(), /shutdown timed out/);
  assert.equal(value.clients.length, 1, 'no second process');
  assert.deepEqual(value.cleanupFailures, [], 'only a failed start may swallow the refusal');
  value.clients[0].disposeError = undefined;
  await value.controller.shutdown();
});

test('a connection loss after startup reports crashed once, and restart recovers', async () => {
  const value = lifecycle(() => ({ serverInfo: { name: 'aa2modulus', version: '0.1.0' } }));
  await value.controller.start();
  value.clients[0].crash();
  value.clients[0].crash();
  assert.deepEqual(value.states, ['starting', 'ready', 'crashed']);
  assert.equal(value.controller.status.current.serverVersion, '0.1.0', 'crashed keeps the last known server');
  assert.match(value.controller.status.current.detail ?? '', /connection closed/);
  await value.controller.start();
  assert.deepEqual(value.states, ['starting', 'ready', 'crashed', 'starting', 'ready']);
  assert.equal(value.clients.length, 2);
  await value.controller.shutdown();
});

test('restart and shutdown stop the client without a crash report', async () => {
  const value = lifecycle();
  await value.controller.start();
  await value.controller.start();
  await value.controller.shutdown();
  assert.deepEqual(value.states, ['starting', 'ready', 'starting', 'ready', 'stopped']);
});

test('a server with an older contract is ready with a warning', async () => {
  const older = { experimental: { aa2modulus: { ...CURRENT_AA2MODULUS, contractVersion: 1 } } };
  const value = lifecycle(() => ({ capabilities: older }));
  await value.controller.start();
  assert.equal(value.controller.status.current.state, 'ready');
  assert.match(value.controller.status.current.warning ?? '', /too old for module commands/);
  assert.equal(describeStatus(value.controller.status.current).severity, 'warning');
  await value.controller.shutdown();
});
