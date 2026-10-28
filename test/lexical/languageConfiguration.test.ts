// language-configuration.json: VS Code evaluates these patterns with
// JavaScript regular expressions, so the tests do too.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson } from '../support/manifest';

interface OnEnterRule {
  beforeText: string;
  afterText?: string;
  action: Record<string, unknown>;
}

interface LanguageConfiguration {
  wordPattern: string;
  comments: { lineComment: string };
  onEnterRules: OnEnterRule[];
  folding: { markers: { start: string; end: string } };
}

const configuration = readJson<LanguageConfiguration>('language-configuration.json');

test('line comments use //', () => {
  assert.equal(configuration.comments.lineComment, '//');
});

test('a qualified name is one editor word, also while it is typed', () => {
  const word = (text: string) => new RegExp(configuration.wordPattern).exec(text)?.[0];
  assert.equal(word('Globals.PlayerCharacter'), 'Globals.PlayerCharacter');
  assert.equal(word('Globals.P'), 'Globals.P', 'completion filters on the namespace and the typed member prefix');
});

test('Enter continues block comments and nothing else', () => {
  const onEnter = (before: string, after = ''): Record<string, unknown> | null => {
    const rule = configuration.onEnterRules.find(entry => new RegExp(entry.beforeText).test(before)
      && (!entry.afterText || new RegExp(entry.afterText).test(after)));
    return rule?.action ?? null;
  };
  assert.deepEqual(onEnter('/*', '*/'), { indent: 'indentOutdent', appendText: ' * ' });
  assert.deepEqual(onEnter('  /* note'), { indent: 'none', appendText: ' * ' });
  assert.deepEqual(onEnter('   * more'), { indent: 'none', appendText: '* ' });
  assert.deepEqual(onEnter('   */'), { indent: 'none', removeText: 1 });
  assert.equal(onEnter('/* closed */'), null, 'a closed comment does not continue');
  assert.equal(onEnter('// line comment'), null);
  assert.equal(onEnter('let x: int = a * b;'), null, 'multiplication is not a comment line');
});

test('#region comments at the start of a line fold', () => {
  const start = new RegExp(configuration.folding.markers.start);
  const end = new RegExp(configuration.folding.markers.end);
  assert.ok(start.test('  // #region Setup'));
  assert.ok(start.test('//region'));
  assert.ok(end.test('  // #endregion'));
  assert.ok(!start.test('// regional note'), 'region must be a whole word');
  assert.ok(!start.test('let x = 1; // #region'), 'markers start the line');
});
