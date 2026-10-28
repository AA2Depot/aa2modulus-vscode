import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { activateDocument, builtinPages, fixtureUri, replace, waitFor } from './helper';

type Item = vscode.QuickPickItem & { uri: string };

/**
 * A quick pick stand-in for AA2M: Browse Built-ins. The command, the server's
 * search and the preview stay real; the stand-in plays the user, who types the
 * first listed name and accepts the entry with that name.
 */
class ScriptedPicker {
  items: Item[] = [];
  selectedItems: Item[] = [];
  value = '';
  busy = false;
  placeholder = '';
  matchOnDescription = false;
  /** The entry the user accepted. */
  readonly accepted: Promise<Item>;
  private readonly change = new vscode.EventEmitter<string>();
  private readonly accept = new vscode.EventEmitter<void>();
  private readonly hidden = new vscode.EventEmitter<void>();
  readonly onDidChangeValue = this.change.event;
  readonly onDidAccept = this.accept.event;
  readonly onDidHide = this.hidden.event;
  private resolveAccepted!: (item: Item) => void;

  constructor() {
    this.accepted = new Promise(resolve => {
      this.resolveAccepted = resolve;
    });
  }

  show(): void {
    void this.typeAndAccept();
  }

  hide(): void {
    this.hidden.fire();
  }

  dispose(): void {
    this.change.dispose();
    this.accept.dispose();
    this.hidden.dispose();
  }

  private async typeAndAccept(): Promise<void> {
    const [first] = await waitFor(() => this.items, items => items.length > 0, 'the initial list');
    this.value = first.label;
    this.change.fire(this.value);
    const found = await waitFor(
      () => this.items.find(item => item.uri === first.uri),
      item => item !== undefined && this.value === first.label,
      'the typed name in the results'
    );
    assert.ok(found);
    this.selectedItems = [found];
    this.accept.fire();
    this.resolveAccepted(found);
  }
}

function previewTab(uri: vscode.Uri): vscode.Tab | undefined {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
    tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === uri.toString());
}

suite('AA2M built-in pages', () => {
  suiteSetup(async () => {
    await activateDocument(fixtureUri('empty.aa2m'));
  });

  test('Browse Built-ins searches the server and previews the chosen page', async () => {
    const picker = new ScriptedPicker();
    const previews: vscode.Uri[] = [];
    const executeCommand = vscode.commands.executeCommand;
    const restorePicker = replace(
      vscode.window, 'createQuickPick', (() => picker) as unknown as typeof vscode.window.createQuickPick
    );
    const restoreCommands = replace(vscode.commands, 'executeCommand', ((command: string, ...args: unknown[]) => {
      if (command === 'markdown.showPreview' && args[0] instanceof vscode.Uri) {
        previews.push(args[0]);
      }
      return executeCommand(command, ...args);
    }) as typeof executeCommand);
    try {
      await executeCommand('aa2m.browseBuiltins');
      const accepted = await picker.accepted;
      await waitFor(() => previews, uris => uris.length > 0, 'the preview');
      assert.equal(previews[0].toString(), accepted.uri);
      const page = await vscode.workspace.openTextDocument(previews[0]);
      assert.notEqual(page.getText().trim(), '', 'the server serves the page');
    } finally {
      restorePicker();
      restoreCommands();
    }
  });

  test('a built-in page opens in the rendered Markdown preview', async () => {
    const [page] = await builtinPages();
    await vscode.commands.executeCommand('vscode.open', page);
    const tab = await waitFor(() => previewTab(page), value => value !== undefined, 'the preview tab');
    assert.ok(tab?.input instanceof vscode.TabInputCustom);
    assert.equal(tab.input.viewType, 'vscode.markdown.preview.editor');
  });

  test('built-in pages stay Markdown when another association claims *.md', async () => {
    const files = vscode.workspace.getConfiguration('files');
    await files.update('associations', { '*.md': 'plaintext' }, vscode.ConfigurationTarget.Workspace);
    try {
      // A page no earlier case opened, so its language is detected under the association.
      const pages = await builtinPages();
      const uri = pages.at(-1);
      assert.ok(uri);
      await vscode.workspace.openTextDocument(uri);
      const document = await waitFor(
        () => vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString()),
        value => value?.languageId === 'markdown'
      );
      assert.equal(document?.languageId, 'markdown');
    } finally {
      await files.update('associations', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
