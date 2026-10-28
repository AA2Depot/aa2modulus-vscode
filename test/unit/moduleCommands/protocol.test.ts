import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCompileResult, readDecompileResult } from '../../../src/moduleCommands/protocol';

test('a compile result keeps its counts and well-formed unlocated findings', () => {
  assert.deepEqual(readCompileResult({
    compiled: false,
    outputUri: 'file:///ignored',
    errors: 2,
    warnings: 1,
    unlocated: [
      { severity: 'error', code: 'WRITE', message: 'out:1:1: error[WRITE]: cannot write' },
      { severity: 'fatal', message: 'unknown severity' },
      { severity: 'warning' },
      'garbage'
    ]
  }), {
    compiled: false,
    errors: 2,
    warnings: 1,
    unlocated: [{ severity: 'error', code: 'WRITE', message: 'out:1:1: error[WRITE]: cannot write' }]
  });
});

test('malformed counts and findings fall back to empty values', () => {
  assert.deepEqual(readCompileResult({ compiled: true, errors: -1, warnings: 'two', unlocated: {} }), {
    compiled: true, errors: 0, warnings: 0, unlocated: []
  });
});

test('results without their required field are refused', () => {
  for (const value of [undefined, null, {}, { compiled: 'yes' }]) {
    assert.throws(() => readCompileResult(value), /unexpected compile result/, JSON.stringify(value));
  }
  for (const value of [undefined, {}, { outputUri: '' }, { source: 'module "M" {}' }]) {
    assert.throws(() => readDecompileResult(value), /unexpected decompile result/, JSON.stringify(value));
  }
  assert.deepEqual(readDecompileResult({ outputUri: 'file:///m.aa2m' }), {
    outputUri: 'file:///m.aa2m', errors: 0, warnings: 0, unlocated: []
  });
});
