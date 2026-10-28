import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { serverConfigurationFromEnvironment } from '../support/serverEnvironment';
import {
  activateDocument, deleteIfPresent, fixtureUri, insertStarter, recordNotices, replace, waitFor, writeFile
} from './helper';

/** Opens a new empty module file and inserts the server's starter, unsaved. */
async function starterModule(name: string): Promise<vscode.TextDocument> {
  const uri = fixtureUri(name);
  await writeFile(uri, '');
  const document = await activateDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  await insertStarter(editor);
  return document;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  return vscode.workspace.fs.stat(uri).then(() => true, () => false);
}

suite('AA2M module commands', () => {
  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('every compile confirms the remembered output and a new choice replaces it', async () => {
    const source = await starterModule('remembered.aa2m');
    await source.save();
    const first = fixtureUri('Compile First');
    const second = fixtureUri('Compile Second');
    const suggestions: (string | undefined)[] = [];
    const restore = replace(vscode.window, 'showSaveDialog', async options => {
      suggestions.push(options?.defaultUri?.toString());
      return suggestions.length === 1 ? first : second;
    });
    try {
      await vscode.commands.executeCommand('aa2m.compileModule', source.uri);
      const bytes = await vscode.workspace.fs.readFile(first);
      await vscode.commands.executeCommand('aa2m.compileModule', source.uri);
      assert.deepEqual(suggestions.slice(1), [first.toString()], 'the second dialog starts at the remembered target');
      assert.deepEqual(await vscode.workspace.fs.readFile(second), bytes);
      await vscode.workspace.fs.delete(second);
      await vscode.commands.executeCommand('aa2m.compileModule', source.uri);
      assert.deepEqual(suggestions.slice(2), [second.toString()], 'the replacement target is remembered');
      assert.deepEqual(await vscode.workspace.fs.readFile(second), bytes);
    } finally {
      restore();
      for (const uri of [first, second]) {
        await deleteIfPresent(uri);
      }
    }
  });

  test('compile uses the unsaved text and saves nothing', async () => {
    // On disk the module is empty, which does not compile; only the editor holds the starter.
    const source = await starterModule('unsaved.aa2m');
    const output = fixtureUri('Unsaved Output');
    const restore = replace(vscode.window, 'showSaveDialog', async () => output);
    try {
      await vscode.commands.executeCommand('aa2m.compileModule', source.uri);
      assert.ok(await exists(output), 'the unsaved starter compiled');
      assert.equal(source.isDirty, true, 'compile does not save');
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(source.uri)).toString(), '', 'the file stays empty');
    } finally {
      restore();
      await deleteIfPresent(output);
    }
  });

  test('a failed compile is summed up in one notification that offers Show Problems', async () => {
    const empty = await activateDocument(fixtureUri('empty.aa2m'));
    const output = fixtureUri('Empty Output');
    const restoreDialog = replace(vscode.window, 'showSaveDialog', async () => output);
    const { notices, restore } = recordNotices('showErrorMessage');
    try {
      await vscode.commands.executeCommand('aa2m.compileModule', empty.uri);
      const summaries = notices.filter(notice => /AA2M compile reported \d+ errors?\./.test(notice.message));
      assert.equal(summaries.length, 1, 'one summary for the compile');
      assert.ok(summaries[0].actions.includes('Show Problems'), 'the located error is in Problems');
      assert.equal(await exists(output), false, 'nothing is written');
    } finally {
      restore();
      restoreDialog();
    }
  });

  test('the contributed $aa2m problem matcher publishes CLI findings', async () => {
    const configuration = serverConfigurationFromEnvironment();
    // The CLI is the server command without its final `lsp-server` argument
    // (a release executable, or the toolchain's interpreter with `-m aa2modulus`).
    assert.equal(configuration.args.at(-1), 'lsp-server', 'the CLI task needs server args ending in lsp-server');
    const uri = fixtureUri('task.aa2m');
    const output = fixtureUri('Task Output');
    // An empty module fails with a located error in any language version.
    await writeFile(uri, '');
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const cliArgs = [
      ...configuration.args.slice(0, -1),
      'compile', uri.fsPath, '-o', output.fsPath, '--diagnostic-format', 'short', '--color', 'never'
    ];
    const task = new vscode.Task(
      { type: 'aa2m-acceptance' }, folder, 'AA2M acceptance CLI', 'aa2m',
      new vscode.ProcessExecution(configuration.command, cliArgs, { cwd: configuration.cwd ?? folder.uri.fsPath }),
      ['$aa2m']
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, close: true };
    let exitCode: number | undefined | null = null;
    const listener = vscode.tasks.onDidEndTaskProcess(event => {
      if (event.execution.task.name === task.name) {
        exitCode = event.exitCode;
      }
    });
    try {
      await vscode.tasks.executeTask(task);
      assert.notEqual(await waitFor(() => exitCode, code => code !== null), 0, 'the empty module makes the CLI fail');
      const diagnostics = await waitFor(
        () => vscode.languages.getDiagnostics(uri),
        items => items.some(item => item.source === 'aa2modulus cli')
      );
      const finding = diagnostics.find(item => item.source === 'aa2modulus cli');
      assert.equal(finding?.severity, vscode.DiagnosticSeverity.Error);
      assert.ok(finding.code, 'the matcher keeps the CLI diagnostic code');
    } finally {
      listener.dispose();
      await deleteIfPresent(uri);
      await deleteIfPresent(output);
    }
  });
});
