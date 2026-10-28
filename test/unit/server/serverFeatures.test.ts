import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeUnsupportedContract, hasCommand, NO_FEATURES, readServerFeatures, readyServerLacks, SUPPORTED_CONTRACT_VERSION
} from '../../../src/server/serverFeatures';
import { readText } from '../../support/manifest';
import { capabilitiesWithCommands, CURRENT_AA2MODULUS, CURRENT_CAPABILITIES } from './fakes';

const withAa2modulus = (fields: Record<string, unknown>) => ({ experimental: { aa2modulus: fields } });

test('a current server advertises its contract, flags, syntax and commands', () => {
  assert.deepEqual(readServerFeatures(capabilitiesWithCommands('aa2modulus.compileDocument')), {
    contractVersion: 2,
    isContractSupported: true,
    builtinCatalog: true,
    completionSnippets: true,
    commands: ['aa2modulus.compileDocument']
  });
});

test('only the supported contract version is supported: higher, lower or malformed is not', () => {
  const supported = (contractVersion: unknown) =>
    readServerFeatures(withAa2modulus({ ...CURRENT_AA2MODULUS, contractVersion })).isContractSupported;
  assert.equal(supported(SUPPORTED_CONTRACT_VERSION), true);
  for (const value of [SUPPORTED_CONTRACT_VERSION + 1, SUPPORTED_CONTRACT_VERSION - 1, 0, -2, 2.5, '2', null, undefined]) {
    assert.equal(supported(value), false, JSON.stringify(value));
  }
  assert.equal(readServerFeatures(withAa2modulus({ contractVersion: '2' })).contractVersion, undefined);
});

test('a flag enables its feature only when it is exactly true', () => {
  for (const value of [false, 'true', 1, undefined]) {
    const flags = { builtinCatalog: value, completionSnippets: value };
    const features = readServerFeatures(withAa2modulus({ ...CURRENT_AA2MODULUS, ...flags }));
    assert.deepEqual([features.builtinCatalog, features.completionSnippets], [false, false], JSON.stringify(value));
  }
});

test('missing or malformed capabilities mean nothing is supported', () => {
  for (const capabilities of [undefined, null, 'x', {}, { experimental: { aa2modulus: 7 } }]) {
    assert.deepEqual(readServerFeatures(capabilities), NO_FEATURES, JSON.stringify(capabilities));
  }
  assert.deepEqual(
    readServerFeatures({ executeCommandProvider: { commands: ['a', 3, null] } }).commands, ['a'],
    'only string commands are kept'
  );
});

test('an unsupported contract is explained as a newer server or an older one', () => {
  const warning = (contractVersion?: number) =>
    describeUnsupportedContract({ ...NO_FEATURES, contractVersion }).warning;
  assert.deepEqual(
    [warning(SUPPORTED_CONTRACT_VERSION + 1), warning(SUPPORTED_CONTRACT_VERSION - 1), warning(undefined)],
    ['Server too new for module commands', 'Server too old for module commands', 'Server too old for module commands']
  );
  assert.match(describeUnsupportedContract({ ...NO_FEATURES, contractVersion: 3 }).message, /Update the AA2M extension/);
});

test('a command needs the advertisement and a supported contract', () => {
  const current = readServerFeatures(capabilitiesWithCommands('run'));
  assert.equal(hasCommand(current, 'run'), true);
  assert.equal(hasCommand(current, 'other'), false);
  assert.equal(hasCommand({ ...current, isContractSupported: false }, 'run'), false);
});

test('only a ready server can lack a feature', () => {
  const features = readServerFeatures(CURRENT_CAPABILITIES);
  const lacksPages = (state: string, withFeatures = { ...features, builtinCatalog: false }) =>
    readyServerLacks({ state, features: withFeatures }, item => item.builtinCatalog);
  assert.equal(lacksPages('ready'), true);
  assert.equal(lacksPages('ready', features), false);
  for (const state of ['starting', 'failed', 'stopped', 'crashed', 'untrusted']) {
    assert.equal(lacksPages(state), false, state);
  }
  assert.equal(readyServerLacks({ state: 'ready' }, item => item.builtinCatalog), false);
});

test('the server contract document states the supported contract version', () => {
  assert.ok(
    readText('docs/server-contract.md').includes(`supported contract (${SUPPORTED_CONTRACT_VERSION},`),
    'docs/server-contract.md quotes SUPPORTED_CONTRACT_VERSION'
  );
});
