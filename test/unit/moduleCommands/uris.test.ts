import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uriFileName } from '../../../src/moduleCommands/uris';

test('the file name of a URI is its decoded last segment', () => {
  assert.equal(uriFileName('file:///c%3A/My%20Mods/Tutor.aa2m'), 'Tutor.aa2m');
  assert.equal(uriFileName('file:///mods/folder/'), 'folder');
  assert.equal(uriFileName('file:///mods/x?query#fragment'), 'x');
  assert.equal(uriFileName('file:///bad%E0'), 'bad%E0');
});
