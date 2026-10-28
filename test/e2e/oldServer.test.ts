import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateDocument, fixtureUri, loadExtension, recordNotices } from './helper';

// The runner configures fakeOldServer.js: contract 1, both module commands
// advertised, no built-in pages.
suite('AA2M with a server older than the contract', () => {
  test('the server runs with one warning, and module commands are refused', async () => {
    const warnings = recordNotices('showWarningMessage');
    const errors = recordNotices('showErrorMessage');
    try {
      await activateDocument(fixtureUri('empty.aa2m'));
      const extension = loadExtension();
      assert.equal(extension.exports.status().state, 'ready', 'an old contract still starts');
      assert.equal(extension.exports.status().warning, 'Server too old for module commands');
      await extension.exports.restart();
      const tooOld = warnings.notices.filter(notice => notice.message.includes('too old for module commands'));
      assert.equal(tooOld.length, 1, 'one warning per executable, also after a restart');
      await vscode.commands.executeCommand('aa2m.compileModule');
      await vscode.commands.executeCommand('aa2m.decompileModule', fixtureUri('empty.aa2m'));
      const refused = errors.notices.filter(notice => notice.message.includes('does not support module commands'));
      assert.equal(refused.length, 2, 'both commands are refused before any dialog');
    } finally {
      warnings.restore();
      errors.restore();
    }
  });

  test('New Module explains that the server offers no starter', async () => {
    const { notices, restore } = recordNotices('showInformationMessage');
    try {
      await vscode.commands.executeCommand('aa2m.newModule');
      assert.ok(notices.some(notice => notice.message.includes('offers no module starter')));
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } finally {
      restore();
    }
  });

  test('Browse Built-ins explains that the server serves no built-ins', async () => {
    const { notices, restore } = recordNotices('showErrorMessage');
    try {
      await vscode.commands.executeCommand('aa2m.browseBuiltins');
      assert.ok(notices.some(notice => notice.message.includes('does not serve built-in documentation')));
    } finally {
      restore();
    }
  });
});
