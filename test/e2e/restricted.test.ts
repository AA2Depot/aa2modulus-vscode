import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { fixtureUri, loadExtension, recordNotices, waitFor } from './helper';

suite('AA2M in Restricted Mode', () => {
  test('no server starts, and module commands and Browse Built-ins ask for trust', async () => {
    assert.equal(vscode.workspace.isTrusted, false, 'the runner opens this suite in Restricted Mode');
    const { notices, restore } = recordNotices('showErrorMessage');
    try {
      const extension = loadExtension();
      await extension.activate();
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixtureUri('empty.aa2m')));
      await waitFor(() => extension.exports.status(), status => status.state === 'untrusted', 'the untrusted state');
      await vscode.commands.executeCommand('aa2m.compileModule');
      await vscode.commands.executeCommand('aa2m.browseBuiltins');
      const messages = notices.map(notice => notice.message);
      assert.ok(messages.includes('Trust this workspace to run AA2M module commands.'), messages.join(' | '));
      assert.ok(messages.some(message => message.startsWith('Trust this workspace to browse AA2M built-ins')));
      assert.equal(extension.exports.status().state, 'untrusted', 'the commands started no server');
    } finally {
      restore();
    }
  });
});
