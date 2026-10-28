import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerCommandNotSetError } from '../../../src/server/configuration';
import { ServerController } from '../../../src/server/controller';
import type { ManagedClient } from '../../../src/server/managedClient';
import type { ServerState } from '../../../src/server/status';
import { deferred } from '../../support/wait';
import { fakeClient } from './fakes';

/** Records the start, dispose and request calls of numbered fake clients. */
function recordingController(client: (id: number, calls: string[]) => Partial<ManagedClient>) {
  const calls: string[] = [];
  let count = 0;
  const controller = new ServerController(() => true, () => {
    const id = ++count;
    return fakeClient({
      async start() {
        calls.push(`start ${id}`);
      },
      async dispose() {
        calls.push(`dispose ${id}`);
      },
      ...client(id, calls)
    });
  });
  return { controller, calls };
}

function recordStates(controller: ServerController): ServerState[] {
  const states: ServerState[] = [];
  controller.status.onDidChange(status => states.push(status.state));
  return states;
}

test('a restart disposes the previous process before starting the next', async () => {
  const entered = deferred();
  const release = deferred();
  const { controller, calls } = recordingController(id => ({
    async start() {
      calls.push(`start ${id}`);
      if (id === 1) {
        entered.resolve();
        await release.promise;
      }
    }
  }));
  const first = controller.start();
  const second = controller.start();
  await entered.promise;
  assert.deepEqual(calls, ['start 1']);
  release.resolve();
  await Promise.all([first, second]);
  await controller.shutdown();
  assert.deepEqual(calls, ['start 1', 'dispose 1', 'start 2', 'dispose 2']);
});

test('a failed start is cleaned up and a later start can succeed', async () => {
  const { controller, calls } = recordingController(id => ({
    async start() {
      calls.push(`start ${id}`);
      if (id === 1) {
        throw new Error('missing executable');
      }
    }
  }));
  await assert.rejects(controller.start(), /missing executable/);
  await controller.start();
  await controller.shutdown();
  assert.deepEqual(calls, ['start 1', 'dispose 1', 'start 2', 'dispose 2']);
});

test('an untrusted workspace creates no process, and trust is checked at every start', async () => {
  let trusted = false;
  let created = 0;
  let disposed = 0;
  const controller = new ServerController(() => trusted, () => {
    created++;
    return fakeClient({
      async start() {},
      async dispose() {
        disposed++;
      }
    });
  });
  const states = recordStates(controller);
  await controller.start();
  assert.equal(created, 0);
  trusted = true;
  await controller.start();
  trusted = false;
  await controller.start();
  assert.deepEqual(states, ['untrusted', 'starting', 'ready', 'untrusted']);
  assert.deepEqual([created, disposed], [1, 1]);
  await controller.shutdown();
});

test('shutdown while starting disposes that process, ends stopped and suppresses later starts', async () => {
  const entered = deferred();
  const release = deferred();
  let created = 0;
  let disposed = 0;
  const controller = new ServerController(() => true, () => {
    created++;
    return fakeClient({
      async start() {
        entered.resolve();
        await release.promise;
      },
      async dispose() {
        disposed++;
      }
    });
  });
  const states = recordStates(controller);
  const first = controller.start();
  await entered.promise;
  const queued = controller.start();
  const shutdown = controller.shutdown();
  release.resolve();
  await Promise.all([first, queued, shutdown]);
  await controller.start();
  assert.deepEqual(states, ['starting', 'ready', 'stopped']);
  assert.deepEqual([created, disposed], [1, 1]);
});

test('a failed stop prevents another process from being launched', async () => {
  let created = 0;
  let stopFails = true;
  const client = fakeClient({
    async start() {},
    async dispose() {
      if (stopFails) {
        throw new Error('still running');
      }
    }
  });
  const controller = new ServerController(() => true, () => {
    created++;
    return client;
  });
  await controller.start();
  await assert.rejects(controller.start(), /still running/);
  assert.equal(created, 1);
  stopFails = false;
  await controller.shutdown();
});

test('commands wait for startup and finish before a queued restart disposes their process', async () => {
  const release = deferred();
  const entered = deferred();
  const finish = deferred();
  const { controller, calls } = recordingController(id => ({
    async start() {
      calls.push(`start ${id}`);
      if (id === 1) {
        await release.promise;
      }
    },
    async executeCommand<T>(command: string, argument: unknown): Promise<T> {
      calls.push(`request ${id}: ${command} ${JSON.stringify(argument)}`);
      entered.resolve();
      await finish.promise;
      return { compiled: true } as T;
    }
  }));
  const startup = controller.start();
  const request = controller.executeCommand('aa2modulus.compileDocument', { outputUri: 'file:///module' });
  const restart = controller.start();
  release.resolve();
  await entered.promise;
  finish.resolve();
  assert.deepEqual(await request, { compiled: true });
  await Promise.all([startup, restart]);
  await controller.shutdown();
  assert.deepEqual(calls, [
    'start 1', 'request 1: aa2modulus.compileDocument {"outputUri":"file:///module"}', 'dispose 1', 'start 2', 'dispose 2'
  ]);
});

test('commands are refused while untrusted or unavailable, and a failed command blocks nothing', async () => {
  let trusted = false;
  const controller = new ServerController(() => trusted, () => fakeClient({
    async start() {},
    async dispose() {},
    async executeCommand<T>(): Promise<T> {
      throw new Error('compile failed');
    }
  }));
  await assert.rejects(controller.executeCommand('compile', {}), /Trust this workspace/);
  trusted = true;
  await assert.rejects(controller.executeCommand('compile', {}), /unavailable/);
  await controller.start();
  await assert.rejects(controller.executeCommand('compile', {}), /compile failed/);
  await controller.start();
  await controller.shutdown();
  await assert.rejects(controller.executeCommand('compile', {}), /unavailable/);
});

test('a client that cannot be created reports failed; an empty command counts as a missing executable', async () => {
  const failing = (error: Error) => new ServerController(() => true, () => {
    throw error;
  });
  const invalid = failing(new Error('aa2m.server.args must be an array'));
  await assert.rejects(invalid.start(), /must be an array/);
  assert.deepEqual(
    invalid.status.current,
    { state: 'failed', detail: 'aa2m.server.args must be an array', missingExecutable: false }
  );
  const empty = failing(new ServerCommandNotSetError());
  await assert.rejects(empty.start(), ServerCommandNotSetError);
  assert.equal(empty.status.current.missingExecutable, true);
});
