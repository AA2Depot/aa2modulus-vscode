import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateExtension, insertStarter, rankedCompletions, replace, waitFor } from './helper';

suite('AA2M authoring', () => {
  test('New Module opens an empty module whose first suggestion is the server starter', async () => {
    const configuration = vscode.workspace.getConfiguration('editor');
    await configuration.update('insertSpaces', true, vscode.ConfigurationTarget.Global);
    await configuration.update('tabSize', 2, vscode.ConfigurationTarget.Global);
    const suggested: string[] = [];
    const executeCommand = vscode.commands.executeCommand;
    const restore = replace(vscode.commands, 'executeCommand', ((command: string, ...args: unknown[]) => {
      suggested.push(command);
      return executeCommand(command, ...args);
    }) as typeof executeCommand);
    try {
      await activateExtension();
      await executeCommand('aa2m.newModule');
      const editor = vscode.window.activeTextEditor;
      assert.ok(editor);
      assert.equal(editor.document.languageId, 'aa2m');
      assert.equal(editor.document.isUntitled, true);
      assert.ok(suggested.includes('editor.action.triggerSuggest'), 'New Module opens the suggestions');
      const starter = await insertStarter(editor);
      assert.equal(starter.command, undefined, 'keyword snippets get no parameter hints');
      assert.match(editor.document.getText(), /\n {2}\S/, 'tab indentation becomes the editor indentation');
      assert.doesNotMatch(editor.document.getText(), /\t/);
    } finally {
      restore();
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  test('call snippets the server offers get parameter hints', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'aa2m', content: '' });
    const editor = await vscode.window.showTextDocument(document);
    try {
      await activateExtension();
      await insertStarter(editor);
      // Ask everywhere in the starter until some position offers a call snippet.
      const calls = (await Promise.all(document.getText().split('\n').map((line, index) =>
        rankedCompletions(document, new vscode.Position(index, line.length)).catch(() => []))))
        .flat()
        .filter(item => [vscode.CompletionItemKind.Function, vscode.CompletionItemKind.Method].includes(item.kind!)
          && item.insertText instanceof vscode.SnippetString && /\$\{?[1-9]/.test(item.insertText.value));
      assert.ok(calls.length > 0, 'the server offers call snippets with placeholders');
      assert.ok(
        calls.every(item => item.command?.command === 'editor.action.triggerParameterHints'),
        'every call snippet opens parameter hints'
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });

  test('an untitled library reaches the server', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'aa2mi', content: '' });
    const editor = await vscode.window.showTextDocument(document);
    try {
      await activateExtension();
      await insertStarter(editor);
      await waitFor(
        () => vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri),
        value => (value?.length ?? 0) > 0,
        'symbols of the untitled library'
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  });
});
