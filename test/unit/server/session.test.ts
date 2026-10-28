import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerController } from '../../../src/server/controller';
import { ServerSession, throwIfFailed } from '../../../src/server/session';
import { fakeClient } from './fakes';

function sessionFixture(failStart = false) {
  let starts = 0;
  const failures: unknown[] = [];
  const controller = new ServerController(() => true, () => fakeClient({
    async start() {
      starts++;
      if (failStart) {
        throw new Error('spawn aa2modulus ENOENT');
      }
    },
    async dispose() {}
  }));
  const session = new ServerSession(controller, error => failures.push(error));
  return { session, failures, starts: () => starts };
}

test('nothing starts until first use, and later uses reuse the running server', async () => {
  const value = sessionFixture();
  value.session.restartIfStarted();
  await value.session.whenSettled();
  assert.equal(value.starts(), 0, 'settings changes before first use do not start the server');
  await value.session.ensureStarted();
  await value.session.ensureStarted();
  assert.equal(value.starts(), 1);
});

test('once started, restart requests start the server again', async () => {
  const value = sessionFixture();
  await value.session.ensureStarted();
  value.session.restartIfStarted();
  await value.session.whenSettled();
  await value.session.restart();
  assert.equal(value.starts(), 3);
});

test('a failed start is reported once and returned to the caller', async () => {
  const value = sessionFixture(true);
  const outcome = await value.session.ensureStarted();
  assert.equal(outcome.failed, true);
  assert.match(String(outcome.failed && outcome.error), /ENOENT/);
  assert.deepEqual(await value.session.whenSettled(), outcome);
  assert.equal(value.failures.length, 1);
  assert.throws(() => throwIfFailed(outcome), /ENOENT/);
  assert.doesNotThrow(() => throwIfFailed({ failed: false }));
});
