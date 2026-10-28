import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldOfferSetup } from '../../../src/serverSetup/setupPrompt';

test('setup is offered only while no server command is configured', () => {
  const unset = { dismissed: false, commandConfigured: false };
  assert.equal(shouldOfferSetup(unset), true);
  assert.equal(shouldOfferSetup({ ...unset, commandConfigured: true }), false);
  assert.equal(shouldOfferSetup({ ...unset, dismissed: true }), false, "Don't Show Again holds");
});
