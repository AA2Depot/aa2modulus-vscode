import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMANDS, CONTEXT_KEYS, LANGUAGES, SERVER_SETTINGS, UPDATE_SETTINGS, WALKTHROUGH } from '../../../src/shared/ids';
import { readManifest } from '../../support/manifest';

const { contributes } = readManifest();

test('language IDs match the contributed languages', () => {
  const declared = contributes.languages.map(language => language.id).sort();
  assert.deepEqual(Object.values(LANGUAGES).sort(), declared);
});

test('command IDs match the contributed commands', () => {
  const declared = contributes.commands.map(command => command.command).sort();
  assert.deepEqual(Object.values(COMMANDS).sort(), declared);
});

test('server setting names exist in the contributed configuration', () => {
  const declared = new Set(Object.keys(contributes.configuration.properties));
  for (const key of [SERVER_SETTINGS.command, SERVER_SETTINGS.args, SERVER_SETTINGS.cwd]) {
    assert.ok(declared.has(`${SERVER_SETTINGS.section}.${key}`), key);
  }
  assert.ok(declared.has(SERVER_SETTINGS.commandSetting));
  const updateSetting = `${UPDATE_SETTINGS.section}.${UPDATE_SETTINGS.checkForServerUpdates}`;
  assert.equal(updateSetting, UPDATE_SETTINGS.checkForServerUpdatesSetting);
  assert.ok(declared.has(updateSetting));
});

test('the walkthrough and its server step exist', () => {
  const walkthrough = contributes.walkthroughs.find(candidate => candidate.id === WALKTHROUGH.id);
  assert.ok(walkthrough);
  assert.ok(walkthrough.steps.some(step => step.id === WALKTHROUGH.serverStep));
});

test('every context key appears in a menu when clause, and every aa2m key there is declared', () => {
  const clauses = Object.values(contributes.menus).flat().map(item => item.when ?? '');
  const used = new Set(clauses.flatMap(clause => clause.match(/aa2m\.[A-Za-z]+/g) ?? []));
  assert.deepEqual([...used].sort(), Object.values(CONTEXT_KEYS).sort());
});
