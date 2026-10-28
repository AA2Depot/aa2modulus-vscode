import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReleaseCompatibility, ServerRelease } from '../../../src/serverSetup/releases';
import {
  availableUpdate, isCheckDue, newestSupportedRelease, parseReleaseVersion, readUpdateCheckRecord, recordCheck,
  UPDATE_CHECK_INTERVAL_MS
} from '../../../src/serverSetup/serverUpdate';

function release(tag: string, compatibility: ReleaseCompatibility = 'supported'): ServerRelease {
  return {
    tag, name: tag, prerelease: true, pageUrl: `https://example.test/${tag}`,
    asset: { url: 'https://example.test/zip', size: 1 }, compatibility
  };
}

test('only plain release versions are read, with or without a leading v', () => {
  assert.deepEqual(parseReleaseVersion('0.2.1'), [0, 2, 1]);
  assert.deepEqual(parseReleaseVersion('v10.0.12'), [10, 0, 12]);
  for (const text of ['0.2.2.dev3', '0.2', 'dev', '', undefined, '0.2.1-rc1']) {
    assert.equal(parseReleaseVersion(text), undefined, String(text));
  }
});

test('the newest supported release is chosen by version, not by list order', () => {
  const releases = [
    release('v0.2.1'), release('v0.10.0'), release('v0.9.0'), release('v1.0.0', 'unknown'),
    release('v2.0.0', 'unsupported'), release('nightly')
  ];
  assert.equal(newestSupportedRelease(releases)?.tag, 'v0.10.0');
  assert.equal(newestSupportedRelease([release('v1.0.0', 'unknown')]), undefined);
});

test('a release newer than the server is offered; the same, older or unreadable versions are not', () => {
  const record = recordCheck(5, release('v0.3.0'));
  assert.deepEqual(record, { checkedAt: 5, tag: 'v0.3.0', pageUrl: 'https://example.test/v0.3.0' });
  assert.equal(availableUpdate('0.2.1', record), record);
  for (const version of ['0.3.0', '0.4.0', '0.3.0.dev1', undefined]) {
    assert.equal(availableUpdate(version, record), undefined, String(version));
  }
  assert.equal(availableUpdate('0.2.1', recordCheck(5, undefined)), undefined, 'no supported release');
  assert.equal(availableUpdate('0.2.1', undefined), undefined, 'not checked');
});

test('releases are listed again after a day, or when the record is missing or from the future', () => {
  const now = 10 * UPDATE_CHECK_INTERVAL_MS;
  assert.equal(isCheckDue(undefined, now), true);
  assert.equal(isCheckDue({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS + 1 }, now), false);
  assert.equal(isCheckDue({ checkedAt: now - UPDATE_CHECK_INTERVAL_MS }, now), true);
  assert.equal(isCheckDue({ checkedAt: now + 1 }, now), true);
});

test('a stored record is validated; malformed fields are dropped', () => {
  assert.deepEqual(readUpdateCheckRecord({ checkedAt: 1, tag: 'v1.0.0', pageUrl: 'https://x/' }),
    { checkedAt: 1, tag: 'v1.0.0', pageUrl: 'https://x/' });
  assert.deepEqual(readUpdateCheckRecord({ checkedAt: 1, tag: 3, pageUrl: 'http://x/' }), { checkedAt: 1 });
  for (const value of [undefined, null, 'x', {}, { checkedAt: 'now' }, { checkedAt: Number.NaN }]) {
    assert.equal(readUpdateCheckRecord(value), undefined, JSON.stringify(value));
  }
});
