// syntaxes/: the static grammar colors only lexical forms that need no
// toolchain data. Everything else, keywords included, is the server's
// semantic tokens. The tests tokenize synthetic lines with the TextMate engine
// and Oniguruma that VS Code uses; theme colors need a visual check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as oniguruma from 'vscode-oniguruma';
import { INITIAL, parseRawGrammar, Registry, type IGrammar } from 'vscode-textmate';
import { readJson, readManifest } from '../support/manifest';
import { extensionRoot } from '../support/paths';

interface Rule {
  include?: string;
  patterns?: Rule[];
}

interface Grammar {
  scopeName: string;
  patterns: Rule[];
  repository: Record<string, Rule>;
}

/** A token's text and its innermost scope below the grammar's root scope. */
interface Token {
  text: string;
  scope: string;
}

const grammar = readJson<Grammar>('syntaxes/aa2m.tmLanguage.json');

async function loadGrammar(scopeName: string): Promise<IGrammar> {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const paths = new Map(readManifest().contributes.grammars.map(item => [item.scopeName, item.path]));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
      createOnigString: text => new oniguruma.OnigString(text)
    }),
    loadGrammar: async name => {
      const path = paths.get(name);
      return path === undefined ? null : parseRawGrammar(readFileSync(`${extensionRoot}/${path}`, 'utf8'), path);
    }
  });
  const loaded = await registry.loadGrammar(scopeName);
  assert.ok(loaded, `${scopeName} loads`);
  return loaded;
}

const engine = loadGrammar(grammar.scopeName);

/** Tokenizes `lines` as one document and drops whitespace-only tokens. */
async function tokenize(...lines: string[]): Promise<Token[]> {
  const loaded = await engine;
  const tokens: Token[] = [];
  let state = INITIAL;
  for (const line of lines) {
    const result = loaded.tokenizeLine(line, state);
    for (const token of result.tokens) {
      const text = line.slice(token.startIndex, token.endIndex);
      if (text.trim() !== '') {
        tokens.push({ text, scope: token.scopes.slice(1).join(' ') });
      }
    }
    state = result.ruleStack;
  }
  return tokens;
}

/** The texts of the tokens whose scopes include `scope`. */
async function textsIn(scope: string, ...lines: string[]): Promise<string[]> {
  return (await tokenize(...lines)).filter(token => token.scope.split(' ').includes(scope)).map(token => token.text);
}

test('the grammar holds comments, strings and numbers only', () => {
  assert.deepEqual(Object.keys(grammar.repository).sort(), ['comments', 'numbers', 'stringEscapes', 'strings']);
  assert.deepEqual(grammar.patterns.map(rule => rule.include), ['#comments', '#strings', '#numbers']);
  const library = readJson<Grammar>('syntaxes/aa2mi.tmLanguage.json');
  assert.deepEqual(library.patterns, [{ include: grammar.scopeName }], 'libraries reuse the module grammar');
});

test('every contributed grammar loads', async () => {
  for (const contribution of readManifest().contributes.grammars) {
    assert.equal(readJson<Grammar>(contribution.path).scopeName, contribution.scopeName, contribution.path);
  }
  await assert.doesNotReject(loadGrammar('source.aa2mi'));
});

test('numbers match whole literals, never digits inside names or qualified names', async () => {
  const numbers = (line: string) => tokenize(line).then(tokens =>
    tokens.filter(token => token.scope.startsWith('constant.numeric.')).map(token => token.text));
  assert.deepEqual(await numbers('let x12: float = 0x1F + 1.5 - .5f * 2.0e3 + 7;'), ['0x1F', '1.5', '.5f', '2.0e3', '7']);
  assert.deepEqual(await numbers('Room12.Hall3 + a.b2'), []);
  assert.deepEqual(await numbers('0xFFFFFFFF 0x123456789'), ['0xFFFFFFFF'], 'hex has 1 to 8 digits');
});

test('strings mark JSON escapes and flag others', async () => {
  assert.deepEqual(await textsIn('constant.character.escape.aa2m', '"a\\"b\\u00e9\\n"'), ['\\"', '\\u00e9', '\\n']);
  assert.deepEqual(await textsIn('invalid.illegal.escape.aa2m', '"\\q"'), ['\\q']);
});

test('a quoted string ends at the end of its line', async () => {
  assert.deepEqual(await textsIn('string.quoted.double.aa2m', 'x = "open', 'y = 1;'), ['"', 'open']);
});

test('a block string spans lines and holds quotes, comment markers and escapes', async () => {
  const lines = ['x """', '  a "b" ""\\" // c', '  \\t \\q', '  """ y'];
  assert.deepEqual(await textsIn('string.quoted.triple.aa2m', ...lines), [
    '"""', '  a "b" ""', '\\"', ' // c', '\\t', '\\q', '"""'
  ]);
  assert.deepEqual(await textsIn('invalid.illegal.escape.aa2m', ...lines), ['\\q']);
  assert.deepEqual(await textsIn('comment.line.double-slash.aa2m', ...lines), []);
  assert.deepEqual(
    await textsIn('string.quoted.triple.aa2m', '"""', 'a', 'b = 1;'), ['"""', 'a', 'b = 1;'], 'unclosed runs to the end'
  );
  assert.deepEqual(
    await textsIn('invalid.illegal.escape.aa2m', '"""', 'a \\', '"""'), ['\\'], 'a backslash before the line end is invalid'
  );
});

test('comments: line comments run to the end of the line, block comments span lines', async () => {
  assert.deepEqual(await textsIn('comment.line.double-slash.aa2m', 'x = 1; // note "text" 3'), ['// note "text" 3']);
  assert.deepEqual(await textsIn('comment.block.aa2m', '/* a', 'b */ x'), ['/*', ' a', 'b ', '*/']);
});
