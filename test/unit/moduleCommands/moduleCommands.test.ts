import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred } from '../../support/wait';
import { FakeModuleEditor, moduleDocument, NO_FINDINGS } from './fakes';

const COMPILE = 'aa2modulus.compileDocument';
const DECOMPILE = 'aa2modulus.decompileModule';

test('compile sends the version the editor holds when the dialog closes, saved or not', async () => {
  const editor = new FakeModuleEditor();
  editor.chooseOutput = async () => {
    editor.open.set(editor.root.uri, { ...editor.root, version: 5 });
    return 'file:///binary';
  };
  assert.equal(await editor.commands.compile(), true);
  assert.deepEqual(editor.requests, [{
    command: COMPILE,
    argument: { textDocument: { uri: editor.root.uri, version: 5 }, outputUri: 'file:///binary' }
  }]);
  assert.deepEqual(editor.steps, ['ensure'], 'a file-backed module is not saved');
});

test('Save As of an untitled module happens before the output dialog, and the request uses the saved URI', async () => {
  const editor = new FakeModuleEditor(moduleDocument('untitled:Untitled-1'));
  editor.saveAsResult = { ...moduleDocument('file:///saved module.aa2m'), version: 4 };
  assert.equal(await editor.commands.compile(), true);
  assert.deepEqual(
    (editor.requests[0].argument as { textDocument: unknown }).textDocument,
    { uri: 'file:///saved module.aa2m', version: 4 }
  );
  assert.deepEqual(editor.outputDocuments, ['file:///saved module.aa2m']);
  assert.deepEqual(editor.steps, ['ensure', 'saveAs:untitled:Untitled-1', 'output']);
  assert.deepEqual([...editor.remembered], [['file:///saved module.aa2m', editor.outputChoice]]);
});

test('Save As to anything but a file-backed module is refused', async () => {
  const editor = new FakeModuleEditor(moduleDocument('untitled:Untitled-1'));
  editor.saveAsResult = moduleDocument('file:///saved.aa2mi');
  await assert.rejects(editor.commands.compile(), /Save the source as an \.aa2m module/);
  assert.deepEqual(editor.requests, []);
});

test('servers without the command are detected before dialogs', async () => {
  const editor = new FakeModuleEditor();
  editor.requireCommands = async () => {
    throw new Error('update the server');
  };
  await assert.rejects(editor.commands.compile(), /update the server/);
  await assert.rejects(editor.commands.decompile(), /update the server/);
  assert.deepEqual(editor.steps, []);
  assert.deepEqual(editor.requests, []);
});

test('compile asks for a module when there is no document or the document is a library', async () => {
  const none = new FakeModuleEditor();
  none.getDocument = async () => undefined;
  await assert.rejects(none.commands.compile(), /^Error: Open an AA2M module document to compile it\.$/);
  const library = new FakeModuleEditor(moduleDocument('file:///library.aa2mi'));
  await assert.rejects(library.commands.compile(), /Libraries cannot be compiled/);
  assert.deepEqual([...none.steps, ...library.steps], ['ensure', 'ensure'], 'no save and no dialog');
  assert.deepEqual([...none.requests, ...library.requests], []);
});

test('canceling Save As or the output dialog sends no compile request', async () => {
  const canceledOutput = new FakeModuleEditor();
  canceledOutput.outputChoice = undefined;
  assert.equal(await canceledOutput.commands.compile(), false);
  assert.deepEqual(canceledOutput.progressTitles, []);

  const canceledSave = new FakeModuleEditor(moduleDocument('untitled:Untitled-1'));
  canceledSave.saveAsResult = undefined;
  assert.equal(await canceledSave.commands.compile(), false);
  assert.equal(canceledSave.steps.includes('output'), false);
  assert.deepEqual([...canceledOutput.requests, ...canceledSave.requests], []);
});

test('compile findings become one summary, and the compiled flag is the result', async () => {
  const editor = new FakeModuleEditor();
  editor.compileResult = { compiled: false, errors: 2, warnings: 1, unlocated: [] };
  assert.equal(await editor.commands.compile(), false);
  assert.deepEqual(editor.summaries.map(summary => summary.message), [
    'AA2M compile reported 2 errors. See the Problems panel and the language server output for details.'
  ]);
  assert.deepEqual(editor.announced, []);
});

test('a malformed compile result is an error, not a success', async () => {
  const editor = new FakeModuleEditor();
  editor.compileResult = { diagnostics: [] };
  await assert.rejects(editor.commands.compile(), /unexpected compile result/);
  assert.deepEqual(editor.remembered, new Map());
});

test('a successful compile remembers its target and the next compile starts the dialog there', async () => {
  const editor = new FakeModuleEditor();
  editor.outputChoice = 'file:///game/Source';
  assert.equal(await editor.commands.compile(), true);
  assert.equal(await editor.commands.compile(), true);
  assert.deepEqual(editor.outputSuggestions, [undefined, 'file:///game/Source'], 'every compile opens the dialog');
  assert.equal(editor.remembered.get(editor.root.uri), 'file:///game/Source');
  assert.deepEqual(editor.announced, [
    'file:///source.aa2m -> file:///game/Source', 'file:///source.aa2m -> file:///game/Source'
  ]);
  assert.deepEqual(editor.progressTitles, ['Compiling source.aa2m → game/Source', 'Compiling source.aa2m → game/Source']);
  assert.deepEqual(editor.summaries, [], 'a clean compile shows no findings summary');
});

test('choosing another path replaces the remembered target', async () => {
  const editor = new FakeModuleEditor();
  editor.remembered.set(editor.root.uri, 'file:///old/Source');
  editor.outputChoice = 'file:///new/Source';
  assert.equal(await editor.commands.compile(), true);
  assert.deepEqual(editor.outputSuggestions, ['file:///old/Source']);
  assert.equal(editor.remembered.get(editor.root.uri), 'file:///new/Source');
  assert.equal((editor.requests.at(-1)?.argument as { outputUri: string }).outputUri, 'file:///new/Source');
});

test('failed, canceled and thrown compiles keep the remembered target', async () => {
  const outcomes: [string, (editor: FakeModuleEditor) => void][] = [
    ['failed', editor => {
      editor.compileResult = { compiled: false, ...NO_FINDINGS };
    }],
    ['canceled', editor => {
      editor.outputChoice = undefined;
    }],
    ['thrown', editor => {
      editor.commandError = new Error('ContentModified');
    }]
  ];
  for (const [name, arrange] of outcomes) {
    const editor = new FakeModuleEditor();
    editor.remembered.set(editor.root.uri, 'file:///old');
    arrange(editor);
    if (name === 'thrown') {
      await assert.rejects(editor.commands.compile(), /ContentModified/);
    } else {
      assert.equal(await editor.commands.compile(), false, name);
    }
    assert.deepEqual([...editor.remembered], [[editor.root.uri, 'file:///old']], name);
    assert.deepEqual(editor.announced, [], name);
  }
});

test('decompile asks for a binary and summarizes its findings; the server opens the source', async () => {
  const editor = new FakeModuleEditor();
  editor.decompileResult = { outputUri: 'file:///extensionless binary.aa2m', errors: 0, warnings: 1, unlocated: [] };
  assert.equal(await editor.commands.decompile(), true);
  assert.deepEqual(editor.requests, [{ command: DECOMPILE, argument: { inputUri: 'file:///extensionless binary' } }]);
  assert.deepEqual(editor.summaries.map(summary => summary.severity), ['warning']);
});

test('decompile of a given URI skips the input dialog', async () => {
  const editor = new FakeModuleEditor();
  assert.equal(await editor.commands.decompile('file:///mods/Tutor'), true);
  assert.equal(editor.steps.includes('input'), false);
  assert.deepEqual(editor.requests, [{ command: DECOMPILE, argument: { inputUri: 'file:///mods/Tutor' } }]);
  assert.deepEqual(editor.progressTitles, ['Decompiling mods/Tutor']);
});

test('a canceled, failed or malformed decompile reports no findings', async () => {
  const canceled = new FakeModuleEditor();
  canceled.inputChoice = undefined;
  assert.equal(await canceled.commands.decompile(), false);
  assert.deepEqual(canceled.requests, []);
  const failed = new FakeModuleEditor();
  failed.commandError = new Error('Cannot decode module');
  await assert.rejects(failed.commands.decompile(), /Cannot decode module/);
  const malformed = new FakeModuleEditor();
  malformed.decompileResult = { source: 'module "M" {}', diagnostics: [] };
  await assert.rejects(malformed.commands.decompile(), /unexpected decompile result/);
  assert.deepEqual([...failed.summaries, ...malformed.summaries], []);
});

test('one module command runs at a time, and a canceled dialog releases it', async () => {
  const editor = new FakeModuleEditor();
  const dialogOpen = deferred();
  const dialogResult = deferred<string | undefined>();
  editor.chooseOutput = () => {
    dialogOpen.resolve();
    return dialogResult.promise;
  };
  const compile = editor.commands.compile();
  await dialogOpen.promise;
  await assert.rejects(editor.commands.decompile(), /already running/);
  dialogResult.resolve(undefined);
  assert.equal(await compile, false);
  assert.equal(await editor.commands.decompile(), true);
});
