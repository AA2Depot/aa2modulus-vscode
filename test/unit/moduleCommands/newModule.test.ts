import assert from 'node:assert/strict';
import { test } from 'node:test';
import { starterUnavailableMessage } from '../../../src/moduleCommands/newModule';
import { CURRENT_FEATURES } from '../server/fakes';

test('New Module explains a ready server without starters and stays quiet otherwise', () => {
  const lacking = { ...CURRENT_FEATURES, completionSnippets: false };
  assert.match(starterUnavailableMessage({ state: 'ready', features: lacking }) ?? '', /offers no module starter/);
  assert.equal(starterUnavailableMessage({ state: 'ready', features: CURRENT_FEATURES }), undefined);
  for (const state of ['starting', 'failed', 'untrusted', 'crashed'] as const) {
    assert.equal(starterUnavailableMessage({ state, features: lacking }), undefined, state);
  }
});
