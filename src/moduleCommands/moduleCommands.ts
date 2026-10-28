import { LANGUAGES } from '../shared/ids';
import { type CommandOrigin, type CommandSummary, summarizeCommandFindings } from './commandSummary';
import { type CommandFindings, readCompileResult, readDecompileResult, SERVER_COMMANDS } from './protocol';
import { uriFileName } from './uris';

/** What the module commands need to know about an open document. */
export interface ModuleDocument {
  uri: string;
  version: number;
  languageId: string;
  isUntitled: boolean;
}

/** Open documents. */
export interface ModuleDocuments {
  /** The document at `uri` (opened when needed), or the active editor's; undefined when there is none. */
  getDocument(uri?: string): Promise<ModuleDocument | undefined>;
  /** Save As for an untitled document; undefined when the user cancels. */
  saveAs(document: ModuleDocument): Promise<ModuleDocument | undefined>;
}

/** The output of each module's last successful compile. */
export interface CompileTargets {
  rememberedOutput(sourceUri: string): string | undefined;
  rememberOutput(sourceUri: string, outputUri: string): Promise<void>;
}

/** Dialogs and progress around a command. */
export interface ModuleDialogs {
  /** Asks for the output path, starting at `suggested` (the remembered target) when given. */
  chooseOutput(document: ModuleDocument, suggested?: string): Promise<string | undefined>;
  chooseInput(): Promise<string | undefined>;
  /** Runs a dialog-free phase of a command under a visible title. */
  withProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
  /** A short user-facing form of a URI: workspace-relative when possible. */
  displayPath(uri: string): string;
}

/** The language server's module commands. */
export interface ModuleServer {
  executeCommand(command: string, argument: unknown): Promise<unknown>;
  /** Rejects unless the server supports every one of `commands`. */
  requireCommands(commands: readonly string[]): Promise<void>;
}

/** Results shown to the user. */
export interface ModuleReporter {
  /** Announces a successful compile. */
  compiled(sourceUri: string, outputUri: string): void;
  /** Shows the notification that sums up a command's errors or warnings. */
  showSummary(summary: CommandSummary): void;
}

/** Editor services the module commands use. The VS Code adapter implements them; unit tests fake them. */
export interface ModuleCommandPorts {
  documents: ModuleDocuments;
  targets: CompileTargets;
  dialogs: ModuleDialogs;
  server: ModuleServer;
  reporter: ModuleReporter;
}

const NO_MODULE_MESSAGE = 'Open an AA2M module document to compile it.';

/**
 * AA2M: Compile Module and AA2M: Decompile Module, independent of the editor.
 * The server compiles the text the editor holds, saved or not, and rejects a
 * compile whose inputs changed meanwhile; decompile writes and opens the
 * recovered source itself. One command runs at a time.
 */
export class ModuleCommands {
  private busy = false;

  constructor(private readonly ports: ModuleCommandPorts) {}

  /** Compiles `uri`, or the active module; false when there was nothing to compile or the user cancelled. */
  compile(uri?: string): Promise<boolean> {
    return this.exclusive(async () => {
      const { dialogs, targets, reporter } = this.ports;
      await this.ports.server.requireCommands([SERVER_COMMANDS.compileDocument]);
      const root = await this.fileBackedModule(uri);
      if (root === undefined) {
        return false;
      }
      // Every compile confirms its output; the dialog starts at the remembered target.
      const outputUri = await dialogs.chooseOutput(root, targets.rememberedOutput(root.uri));
      if (outputUri === undefined) {
        return false;
      }
      const title = `Compiling ${uriFileName(root.uri)} → ${dialogs.displayPath(outputUri)}`;
      const compiled = await dialogs.withProgress(title, () => this.compileCurrent(root.uri, outputUri));
      if (compiled) {
        await targets.rememberOutput(root.uri, outputUri);
        reporter.compiled(root.uri, outputUri);
      }
      return compiled;
    });
  }

  /** Decompiles `uri`, or a binary chosen in a dialog when none is given. */
  decompile(uri?: string): Promise<boolean> {
    return this.exclusive(async () => {
      const { dialogs, server } = this.ports;
      await server.requireCommands([SERVER_COMMANDS.decompileModule]);
      const inputUri = uri ?? await dialogs.chooseInput();
      if (inputUri === undefined) {
        return false;
      }
      const result = readDecompileResult(await dialogs.withProgress(`Decompiling ${dialogs.displayPath(inputUri)}`, () =>
        server.executeCommand(SERVER_COMMANDS.decompileModule, { inputUri })));
      this.report('decompile', result);
      return true;
    });
  }

  /**
   * The module to compile, saved with Save As first when it is untitled, so
   * the output dialog can start next to it. Undefined when the user cancelled.
   */
  private async fileBackedModule(uri: string | undefined): Promise<ModuleDocument | undefined> {
    const root = await this.ports.documents.getDocument(uri);
    if (root === undefined) {
      throw new Error(NO_MODULE_MESSAGE);
    }
    if (root.languageId !== LANGUAGES.module) {
      throw new Error(NO_MODULE_MESSAGE + ' Libraries cannot be compiled on their own.');
    }
    if (!root.isUntitled) {
      return root;
    }
    const saved = await this.ports.documents.saveAs(root);
    if (saved && (saved.isUntitled || saved.languageId !== LANGUAGES.module)) {
      throw new Error('Save the source as an .aa2m module before compiling.');
    }
    return saved;
  }

  /** Compiles the version of `sourceUri` the editor holds now, and reports the findings. */
  private async compileCurrent(sourceUri: string, outputUri: string): Promise<boolean> {
    const current = await this.ports.documents.getDocument(sourceUri);
    if (current === undefined) {
      throw new Error(NO_MODULE_MESSAGE);
    }
    const result = readCompileResult(await this.ports.server.executeCommand(SERVER_COMMANDS.compileDocument, {
      textDocument: { uri: current.uri, version: current.version }, outputUri
    }));
    this.report('compile', result);
    return result.compiled;
  }

  private report(origin: CommandOrigin, findings: CommandFindings): void {
    const summary = summarizeCommandFindings(origin, findings);
    if (summary) {
      this.ports.reporter.showSummary(summary);
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new Error('An AA2M module command is already running.');
    }
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
}
