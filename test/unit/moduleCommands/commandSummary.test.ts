import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeCommandFindings } from '../../../src/moduleCommands/commandSummary';
import type { CommandFinding } from '../../../src/moduleCommands/protocol';

const finding = (severity: CommandFinding['severity']): CommandFinding => ({ severity, message: severity });

test('no errors or warnings need no notification, whatever the info findings', () => {
  assert.equal(summarizeCommandFindings('compile', { errors: 0, warnings: 0, unlocated: [finding('info')] }), undefined);
});

test('errors are counted before warnings and point at Problems while some are located', () => {
  assert.deepEqual(summarizeCommandFindings('compile', { errors: 1, warnings: 3, unlocated: [finding('warning')] }), {
    severity: 'error',
    message: 'AA2M compile reported 1 error. See the Problems panel and the language server output for details.',
    showProblems: true
  });
});

test('findings that are all unlocated point at the output only', () => {
  assert.deepEqual(summarizeCommandFindings('decompile', {
    errors: 0, warnings: 2, unlocated: [finding('warning'), finding('warning'), finding('info')]
  }), {
    severity: 'warning',
    message: 'AA2M decompile reported 2 warnings. See the language server output for details.',
    showProblems: false
  });
});
