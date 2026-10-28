import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ServerConfiguration } from '../../src/server/configuration';
import { readJson } from '../support/manifest';

const LEXICON_SCHEMA = 'aa2modulus.editor-lexicon.v1';

/**
 * Every top-level key of the lexicon that this check knows. A new key may be
 * lexical syntax that the grammar has to color, so it fails the check until
 * someone looks at it and adds it here.
 */
const KNOWN_KEYS = [
  'schema', 'languageVersion', 'fingerprint', 'keywords', 'types', 'conversions', 'rawForms', 'rawPayload',
  'literals', 'attributes', 'operators', 'punctuation', 'patterns', 'strings', 'blockStrings', 'comments'
];

/** The escapes that strict JSON decoding accepts, as the grammar's `stringEscapes` rule spells them. */
const JSON_ESCAPES = '\\\\(?:["\\\\/bfnrt]|u[0-9A-Fa-f]{4})';

/** The grammar's number rules wrap each pattern in these lookarounds and leave the sign to the operator. */
const NUMBER_BEFORE = '(?<![A-Za-z0-9_.])';
const NUMBER_AFTER = '(?![A-Za-z0-9_.])';
const SIGN = '[+-]?';

interface Lexicon {
  schema: unknown;
  patterns: { integer: string; float: string; hexInteger: string };
  strings: unknown;
  blockStrings: { delimiter: string; escapes: unknown };
  comments: { line: string; block: [string, string] };
}

interface Rule {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: Rule[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** The rule named `name` anywhere in the module grammar. */
function grammarRule(name: string): Rule {
  const repository = readJson<{ repository: Record<string, Rule> }>('syntaxes/aa2m.tmLanguage.json').repository;
  const rules = (rule: Rule): Rule[] => [rule, ...(rule.patterns ?? []).flatMap(rules)];
  const found = Object.values(repository).flatMap(rules).find(rule => rule.name === name);
  assert.ok(found, `the grammar has a ${name} rule`);
  return found;
}

/**
 * The command line that prints the lexicon: the configured server arguments
 * with `lsp-server` replaced by `editor-data lexicon`. Undefined when the
 * arguments do not end in `lsp-server`.
 */
function lexiconArguments(configuration: ServerConfiguration): string[] | undefined {
  const { args } = configuration;
  return args.at(-1) === 'lsp-server' ? [...args.slice(0, -1), 'editor-data', 'lexicon'] : undefined;
}

function checkNumbers(patterns: Lexicon['patterns']): void {
  const kinds = { hex: patterns.hexInteger, float: patterns.float, integer: patterns.integer };
  for (const [kind, pattern] of Object.entries(kinds)) {
    const unsigned = pattern.startsWith(SIGN) ? pattern.slice(SIGN.length) : pattern;
    assert.equal(
      grammarRule(`constant.numeric.${kind}.aa2m`).match, NUMBER_BEFORE + unsigned + NUMBER_AFTER,
      `the grammar's ${kind} rule matches the lexicon pattern ${pattern}`
    );
  }
}

function checkStringsAndComments(lexicon: Lexicon): void {
  assert.equal(lexicon.strings, 'json', 'quoted strings use JSON escapes');
  assert.equal(lexicon.blockStrings.escapes, 'json', 'block strings use JSON escapes');
  assert.equal(grammarRule('constant.character.escape.aa2m').match, JSON_ESCAPES, 'the grammar marks JSON escapes');
  const delimiter = escapeRegExp(lexicon.blockStrings.delimiter);
  const block = grammarRule('string.quoted.triple.aa2m');
  assert.deepEqual([block.begin, block.end], [delimiter, delimiter], 'the grammar uses the block-string delimiter');
  assert.equal(
    grammarRule('comment.line.double-slash.aa2m').match, escapeRegExp(lexicon.comments.line) + '.*$',
    'the grammar uses the line comment marker'
  );
  const comment = grammarRule('comment.block.aa2m');
  assert.deepEqual(
    [comment.begin, comment.end], lexicon.comments.block.map(escapeRegExp), 'the grammar uses the block comment markers'
  );
}

/**
 * The static grammar repeats the lexer's comments, strings and numbers. This
 * check compares them with `editor-data lexicon` of the executable under test,
 * so a lexical change in a release fails here instead of miscoloring files.
 */
export async function checkLexicon(configuration: ServerConfiguration): Promise<string> {
  const args = lexiconArguments(configuration);
  if (args === undefined) {
    return 'lexicon skipped (the server arguments do not end in lsp-server)';
  }
  const { stdout } = await promisify(execFile)(configuration.command, args, { cwd: configuration.cwd, shell: false });
  const lexicon = JSON.parse(stdout) as Lexicon & Record<string, unknown>;
  assert.equal(lexicon.schema, LEXICON_SCHEMA, 'the lexicon schema is the one this check reads');
  assert.deepEqual(
    Object.keys(lexicon).filter(key => !KNOWN_KEYS.includes(key)), [], 'the lexicon has no key this check does not know'
  );
  checkNumbers(lexicon.patterns);
  checkStringsAndComments(lexicon);
  return 'lexicon';
}
