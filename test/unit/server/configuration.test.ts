import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  createServerOptions, DEFAULT_SERVER_ARGS, DEFAULT_SERVER_COMMAND, isServerCommandSet, readServerConfiguration,
  ServerCommandNotSetError
} from '../../../src/server/configuration';
import { readManifest } from '../../support/manifest';

test('defaults launch a separately installed stdio server', () => {
  assert.deepEqual(readServerConfiguration({}), { command: 'aa2modulus', args: ['lsp-server'] });
});

test('paths with spaces and each argument remain separate without shell parsing', () => {
  const args = ['--name', 'a b', '$(literal)', ''];
  const settings = { command: 'C:\\Program Files\\aa2modulus.exe', args, cwd: resolve('Workspace Folder') };
  const actual = readServerConfiguration(settings);
  assert.deepEqual(actual, settings);
  args.push('later');
  assert.equal(actual.args.length, 4);
});

test('invalid executable, argument and directory settings fail before creating a process', () => {
  for (const command of ['', ' ', 123, 'a\0b']) {
    assert.throws(() => readServerConfiguration({ command }), /aa2m\.server\.command/);
  }
  for (const args of ['lsp-server', [false], ['a\0b']]) {
    assert.throws(() => readServerConfiguration({ args }), /aa2m\.server\.args/);
  }
  for (const cwd of [false, ['dir'], 'a\0b', 'relative/path', ' ']) {
    assert.throws(() => readServerConfiguration({ cwd }), /aa2m\.server\.cwd/);
  }
});

test('a blank command means no server is set up, not a malformed setting', () => {
  for (const command of ['', ' ', '\t']) {
    assert.throws(() => readServerConfiguration({ command }), ServerCommandNotSetError);
    assert.equal(isServerCommandSet(command), false);
  }
  const malformed = (error: unknown) => !(error instanceof ServerCommandNotSetError);
  assert.throws(() => readServerConfiguration({ command: 123 }), malformed);
  assert.equal(isServerCommandSet(undefined), false);
  assert.equal(isServerCommandSet(42), false);
  assert.equal(isServerCommandSet('aa2modulus'), true);
});

test('server options select the default stdio pipes without a transport flag', () => {
  const cwd = resolve('server folder');
  const options = createServerOptions({ command: 'aa2modulus', args: ['lsp-server'], cwd });
  // vscode-languageclient appends --stdio when a stdio transport is set explicitly;
  // the aa2modulus server rejects that argument.
  assert.deepEqual(options, { command: 'aa2modulus', args: ['lsp-server'], options: { shell: false, cwd } });
  assert.equal(Object.hasOwn(options, 'transport'), false);
});

test('the default server settings match the manifest', () => {
  const properties = readManifest().contributes.configuration.properties;
  assert.equal(properties['aa2m.server.command'].default, DEFAULT_SERVER_COMMAND);
  assert.deepEqual(properties['aa2m.server.args'].default, DEFAULT_SERVER_ARGS);
});
