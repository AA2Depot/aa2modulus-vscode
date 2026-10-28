import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ProblemPattern, readManifest } from '../support/manifest';

interface Finding {
  file: string;
  line: number;
  column: number;
  severity: string;
  code: string;
  message: string;
}

// The `$aa2m` matcher reads the CLI's `--diagnostic-format short` lines:
// `file:line:col: severity[CODE]: message`. Binary-only (`file@0xOFFSET:`) and
// related `note:` lines are deliberately not matched.
const matcher = readManifest().contributes.problemMatchers.find(item => item.name === 'aa2m');
assert.ok(matcher, 'the manifest contributes the aa2m problem matcher');
assert.ok(!Array.isArray(matcher.pattern), 'the matcher uses a single-line pattern');
const pattern: ProblemPattern = matcher.pattern;
const regexp = new RegExp(pattern.regexp);

function match(line: string): Finding | null {
  const groups = regexp.exec(line);
  return groups && {
    file: groups[pattern.file],
    line: Number(groups[pattern.line]),
    column: Number(groups[pattern.column]),
    severity: groups[pattern.severity],
    code: groups[pattern.code],
    message: groups[pattern.message]
  };
}

function matchOrFail(line: string): Finding {
  const finding = match(line);
  assert.ok(finding, `${line} matches`);
  return finding;
}

test('matcher contract: owner and location resolution', () => {
  assert.equal(matcher.owner, 'aa2m-cli', 'distinct from the language client collection "aa2m"');
  assert.deepEqual(matcher.fileLocation, ['autoDetect', '${workspaceFolder}']);
});

test('matches relative, POSIX, spaced and Windows drive paths', () => {
  assert.deepEqual(matchOrFail("modules/tutor.aa2m:12:5: error[UNDEFINED_VARIABLE]: Unknown variable 'crush'."), {
    file: 'modules/tutor.aa2m',
    line: 12,
    column: 5,
    severity: 'error',
    code: 'UNDEFINED_VARIABLE',
    message: "Unknown variable 'crush'."
  });
  assert.equal(matchOrFail('/srv/mods/My Module.aa2m:1:1: warning[W1]: spaced path').file, '/srv/mods/My Module.aa2m');
  const windows = matchOrFail(
    'D:\\Games\\AA2 Mods\\lib\\shared.aa2mi:340:17: info[INT_OUT_OF_RANGE]: value: 9: too large'
  );
  assert.equal(windows.file, 'D:\\Games\\AA2 Mods\\lib\\shared.aa2mi');
  assert.equal(windows.line, 340);
  assert.equal(windows.column, 17);
  assert.equal(windows.severity, 'info');
  assert.equal(windows.message, 'value: 9: too large');
});

test('ignores binary-only findings, related notes and other output', () => {
  for (const line of [
    'Tutor@0x1A2B: error[TRAILING_BYTES]: Trailing bytes preserved.',
    'lib/shared.aa2mi:4:3: note: declared here',
    'Compiled modules/tutor.aa2m',
    'modules/tutor.aa2m:12: error[X]: missing column'
  ]) {
    assert.equal(match(line), null, line);
  }
});
