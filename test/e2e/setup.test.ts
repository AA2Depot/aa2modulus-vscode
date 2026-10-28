import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { extensionRoot } from '../support/paths';
import { fixtureUri, loadExtension, recordNotices, replace, waitFor } from './helper';

const RELEASES_API = 'https://api.github.com/repos/AA2Depot/AA2Modulus/releases';
const MANIFEST = 'aa2modulus-manifest.json';

/** The release asset and executable for this host, as the toolchain names them. */
function hostAsset(): { asset: string; executable: string } | undefined {
  if (process.arch !== 'x64') {
    return undefined;
  }
  if (process.platform === 'linux') {
    return { asset: 'aa2modulus-linux-x64.zip', executable: 'aa2modulus' };
  }
  return process.platform === 'win32' ? { asset: 'aa2modulus-windows-x64.zip', executable: 'aa2modulus.exe' } : undefined;
}

/**
 * A synthetic GitHub: three releases of the host asset (the test release zip),
 * one per manifest kind. v3 states a supported contract, v2 has no manifest,
 * v1 states contract 1. Every other URL fails, so nothing leaves the machine.
 */
function fakeGitHub(asset: string): typeof fetch {
  const zip = fs.readFileSync(path.join(extensionRoot, 'test', 'fixtures', 'releases', asset));
  const url = (tag: string, name: string) => `https://github.com/AA2Depot/AA2Modulus/releases/download/${tag}/${name}`;
  const release = (tag: string, contract: number | undefined) => ({
    tag_name: tag, name: tag, draft: false, prerelease: false, published_at: `2026-10-0${tag.slice(1, 2)}T00:00:00Z`,
    assets: [
      { name: asset, size: zip.length, browser_download_url: url(tag, asset) },
      ...(contract === undefined ? [] : [{ name: MANIFEST, size: 1, browser_download_url: url(tag, MANIFEST) }])
    ]
  });
  const contracts: Record<string, number> = { v3: 2, v1: 1 };
  return async input => {
    const target = String(input);
    if (target.startsWith(RELEASES_API)) {
      return Response.json([release('v3', 2), release('v2', undefined), release('v1', 1)]);
    }
    const [tag, name] = target.split('/').slice(-2);
    if (name === MANIFEST && tag in contracts) {
      return Response.json({ schema: 'aa2modulus.release-manifest.v1', version: tag, contractVersion: contracts[tag] });
    }
    if (name === asset) {
      return new Response(zip, { headers: { 'content-length': String(zip.length) } });
    }
    return new Response('not found', { status: 404 });
  };
}

suite('AA2M server setup', () => {
  test('first use without a server offers setup, and Download Server installs a supported release', async function () {
    const host = hostAsset();
    if (!host) {
      this.skip();
    }
    const offered: vscode.QuickPickItem[] = [];
    const restoreFetch = replace(globalThis, 'fetch', fakeGitHub(host.asset));
    const restorePick = replace(vscode.window, 'showQuickPick', (async (items: readonly vscode.QuickPickItem[]) => {
      offered.push(...items);
      return items[0];
    }) as unknown as typeof vscode.window.showQuickPick);
    const info = recordNotices('showInformationMessage', notice =>
      notice.actions.includes('Download Server…') ? 'Download Server…' : undefined);
    // The test release holds a placeholder executable, so starting it fails.
    const errors = recordNotices('showErrorMessage');
    try {
      await loadExtension().activate();
      await vscode.workspace.openTextDocument(fixtureUri('empty.aa2m'));
      await waitFor(() => info.notices, notices => notices.some(notice => notice.message.includes('is installed')),
        'the installed notification');
      assert.ok(info.notices[0].message.startsWith('No aa2modulus language server is set up yet.'));
      assert.deepEqual(offered.map(item => [item.label, item.description]), [
        ['v3', ''], ['v2', 'Compatibility unknown']
      ], 'the contract-1 release is not offered');
      const command = vscode.workspace.getConfiguration('aa2m.server').inspect<string>('command')?.globalValue;
      assert.ok(command !== undefined && command.endsWith(path.join('server', 'v3', host.executable)), String(command));
      assert.ok(fs.existsSync(command), 'the executable is unpacked');
    } finally {
      restoreFetch();
      restorePick();
      info.restore();
      errors.restore();
    }
  });
});
