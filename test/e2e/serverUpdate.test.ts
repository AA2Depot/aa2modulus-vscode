import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateDocument, fixtureUri, loadExtension, recordNotices, replace, waitFor } from './helper';

const RELEASES_API = 'https://api.github.com/repos/AA2Depot/AA2Modulus/releases';
const MANIFEST = 'aa2modulus-manifest.json';
const NEWER = 'v99.0.0';

/**
 * A synthetic GitHub with one supported release far newer than any real
 * server, carrying this host's asset name. Every other URL fails, so nothing
 * leaves the machine. Counts the release listings.
 */
class FakeGitHub {
  listings = 0;

  readonly fetch: typeof fetch = async input => {
    const target = String(input);
    const url = (name: string) => `https://github.com/AA2Depot/AA2Modulus/releases/download/${NEWER}/${name}`;
    if (target.startsWith(RELEASES_API)) {
      this.listings++;
      const asset = process.platform === 'win32' ? 'aa2modulus-windows-x64.zip' : 'aa2modulus-linux-x64.zip';
      return Response.json([{
        tag_name: NEWER, name: NEWER, draft: false, prerelease: true, published_at: '2026-10-01T00:00:00Z',
        html_url: `https://github.com/AA2Depot/AA2Modulus/releases/tag/${NEWER}`,
        assets: [
          { name: asset, size: 1, browser_download_url: url(asset) },
          { name: MANIFEST, size: 1, browser_download_url: url(MANIFEST) }
        ]
      }]);
    }
    if (target === url(MANIFEST)) {
      return Response.json({ schema: 'aa2modulus.release-manifest.v1', version: '99.0.0', contractVersion: 2 });
    }
    return new Response('not found', { status: 404 });
  };
}

// The runner turns the check off for every suite; this one turns it on.
suite('AA2M server update check', () => {
  test('a newer supported release is announced once, and releases are listed once a day', async function () {
    if (process.arch !== 'x64' || !['linux', 'win32'].includes(process.platform)) {
      this.skip();
    }
    const github = new FakeGitHub();
    const restoreFetch = replace(globalThis, 'fetch', github.fetch);
    const info = recordNotices('showInformationMessage');
    try {
      await vscode.workspace.getConfiguration('aa2m')
        .update('checkForServerUpdates', true, vscode.ConfigurationTarget.Global);
      await activateDocument(fixtureUri('empty.aa2m'));
      const announced = () => info.notices.filter(notice => notice.message.includes(`${NEWER} is available`));
      await waitFor(announced, notices => notices.length > 0, 'the update notification');
      assert.deepEqual(announced()[0].actions, ['Download…', 'Release Notes']);
      await loadExtension().exports.restart();
      // Nothing to wait for: the restarted server reuses the stored listing and announces nothing new.
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.equal(announced().length, 1, 'one notification per release');
      assert.equal(github.listings, 1, 'the listing is reused within a day');
    } finally {
      restoreFetch();
      info.restore();
    }
  });
});
