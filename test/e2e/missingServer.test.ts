import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { fixtureUri, loadExtension, recordNotices, waitFor } from './helper';

suite('AA2M with a missing server', () => {
  test('activation alone starts nothing; after a failed start Browse Built-ins names the missing server', async () => {
    const { notices, restore } = recordNotices('showErrorMessage');
    try {
      const extension = loadExtension();
      await extension.activate();
      assert.equal(extension.exports.status().state, 'stopped', 'activation alone does not start the server');
      // Opening an AA2M document starts the (missing) server.
      await vscode.workspace.openTextDocument(fixtureUri('empty.aa2m'));
      const status = await waitFor(() => extension.exports.status(), value => value.state === 'failed');
      assert.equal(status.missingExecutable, true);
      assert.ok(notices.some(notice => notice.message.includes('was not found or is not executable')));
      await vscode.commands.executeCommand('aa2m.browseBuiltins');
      assert.ok(
        notices.some(notice => notice.message.includes('built-ins come from the language server')),
        'Browse Built-ins names the missing server'
      );
      assert.equal(extension.exports.status().state, 'failed');
    } finally {
      restore();
    }
  });
});
