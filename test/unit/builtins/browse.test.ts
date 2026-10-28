import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browseUnavailableMessage, builtinPickItems } from '../../../src/builtins/browse';
import type { ServerStatus } from '../../../src/server/status';
import { CURRENT_FEATURES } from '../server/fakes';

test('the picker lists only built-in pages, in the server order, with the native name', () => {
  assert.deepEqual(builtinPickItems([
    { name: 'myMacro', uri: 'file:///library.aa2mi' },
    { name: 'Notification', containerName: 'Notification Native', uri: 'aa2m-builtin:/action-1.md' },
    { name: 'ThisCard', uri: 'aa2m-builtin:/expression-int-2.md' },
    { name: 'Draft', uri: 'untitled:Untitled-1' }
  ]), [
    { label: 'Notification', description: 'Notification Native', uri: 'aa2m-builtin:/action-1.md' },
    { label: 'ThisCard', description: '', uri: 'aa2m-builtin:/expression-int-2.md' }
  ]);
});

test('browsing needs a trusted workspace and a ready server that serves built-in pages', () => {
  const ready: ServerStatus = { state: 'ready', features: CURRENT_FEATURES };
  assert.equal(browseUnavailableMessage(ready), undefined);
  assert.match(browseUnavailableMessage({ state: 'untrusted' }) ?? '', /Trust this workspace/);
  for (const state of ['failed', 'crashed', 'stopped', 'starting'] as const) {
    assert.match(browseUnavailableMessage({ state }) ?? '', /not running/, state);
  }
  assert.match(
    browseUnavailableMessage({ ...ready, features: { ...CURRENT_FEATURES, builtinCatalog: false } }) ?? '',
    /does not serve built-in documentation/
  );
});
