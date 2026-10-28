import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServerCommandNotSetError } from '../../../src/server/configuration';
import { isMissingExecutable, needsSetupOfferAfterStart, startFailureNotice } from '../../../src/server/startFailure';

test('missing executables are recognized by error code, the library spawn message or an empty command', () => {
  const cases: [unknown, boolean][] = [
    [Object.assign(new Error('spawn failed'), { code: 'ENOENT' }), true],
    [Object.assign(new Error('spawn failed'), { code: 'EACCES' }), true],
    ['Launching server using command x failed. Error: spawn x EACCES', true],
    [new ServerCommandNotSetError(), true],
    [new Error('Server did not initialize within 15 seconds.'), false],
    ['ENOENT: no such file, open settings.json', false],
    [undefined, false]
  ];
  for (const [error, expected] of cases) {
    assert.equal(isMissingExecutable(error), expected, String(error));
  }
});

test('a start that failed for another reason points at the server settings', () => {
  const notice = startFailureNotice({ state: 'failed', command: 'aa2modulus lsp-server' }, new Error('bad args'));
  assert.deepEqual(notice, {
    kind: 'startError',
    message: 'AA2M language server could not start. Check aa2m.server.command and aa2m.server.args. bad args'
  });
});

test('a missing executable names the command and offers a download', () => {
  const notice = startFailureNotice(
    { state: 'failed', command: '/opt/aa2modulus lsp-server', missingExecutable: true },
    new Error('spawn ENOENT')
  );
  assert.deepEqual(notice, {
    kind: 'notFound',
    message: 'AA2M language server executable "/opt/aa2modulus lsp-server" was not found or is not executable. '
      + 'Download a release or select the aa2modulus executable to start it.'
  });
  const withoutCommand = startFailureNotice({ state: 'failed', missingExecutable: true }, new Error('spawn ENOENT'));
  assert.match(withoutCommand.message, /executable "aa2modulus" was not found/);
});

test('an empty server command says that no server is set up', () => {
  const notice = startFailureNotice({ state: 'failed', missingExecutable: true }, new ServerCommandNotSetError());
  assert.deepEqual(notice, {
    kind: 'notFound',
    message: 'No AA2M language server is set up: aa2m.server.command is empty. '
      + 'Download a release or select the aa2modulus executable to start it.'
  });
});

test('activation offers setup only after a start that did not fail and left no ready server', () => {
  const ok = { failed: false } as const;
  assert.equal(needsSetupOfferAfterStart(ok, { state: 'stopped' }), true, 'never started');
  assert.equal(needsSetupOfferAfterStart(ok, { state: 'untrusted' }), true);
  assert.equal(needsSetupOfferAfterStart(ok, { state: 'ready' }), false);
  assert.equal(
    needsSetupOfferAfterStart({ failed: true, error: new Error('x') }, { state: 'failed' }),
    false,
    'a failed start offers setup through its own notice'
  );
});
