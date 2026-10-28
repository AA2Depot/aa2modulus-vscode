import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addParameterHelp } from '../../../src/server/completion';

test('accepting a call snippet with argument placeholders triggers parameter help', () => {
  const item = { insertText: { value: 'Notification(${1:"string"});$0' }, command: undefined as { command: string; title: string } | undefined };
  addParameterHelp(item);
  assert.equal(item.command?.command, 'editor.action.triggerParameterHints');
});

test('name-only completions, constants and parameterless calls retain their original command behavior', () => {
  for (const insertText of ['Notification', { value: 'CARD_ADDED' }, { value: 'Parameterless();$0' }]) {
    const item = { insertText, command: undefined };
    addParameterHelp(item);
    assert.equal(item.command, undefined);
  }
  const command = { command: 'custom.command', title: 'Existing command' };
  const item = { insertText: { value: 'Call($1)' }, command };
  addParameterHelp(item);
  assert.equal(item.command, command);
});
