import type { CommandSummary } from '../../../src/moduleCommands/commandSummary';
import {
  type CompileTargets, type ModuleCommandPorts, ModuleCommands, type ModuleDialogs, type ModuleDocument,
  type ModuleDocuments, type ModuleReporter, type ModuleServer
} from '../../../src/moduleCommands/moduleCommands';
import type { CommandFindings } from '../../../src/moduleCommands/protocol';

/** An open document at version 1; `.aa2mi` URIs are libraries and `untitled:` URIs are untitled. */
export function moduleDocument(uri: string): ModuleDocument {
  return {
    uri,
    version: 1,
    languageId: uri.endsWith('.aa2mi') ? 'aa2mi' : 'aa2m',
    isUntitled: uri.startsWith('untitled:')
  };
}

/** No errors, no warnings. */
export const NO_FINDINGS: CommandFindings = { errors: 0, warnings: 0, unlocated: [] };

/**
 * The editor and server behind all five module-command ports. Fields in the
 * first group configure it; the second group records what the commands did.
 * Tests may replace a single method, such as `saveAs`, on an instance.
 */
export class FakeModuleEditor implements ModuleDocuments, CompileTargets, ModuleDialogs, ModuleServer, ModuleReporter {
  readonly open = new Map<string, ModuleDocument>();
  /** What the output dialog returns; undefined cancels it. */
  outputChoice: string | undefined = 'file:///compiled module';
  /** What the input dialog returns; undefined cancels it. */
  inputChoice: string | undefined = 'file:///extensionless binary';
  /** What Save As returns for an untitled document; undefined cancels it. */
  saveAsResult: ModuleDocument | undefined = moduleDocument('file:///saved module.aa2m');
  /** The `compileDocument` result; the default compiles without findings. */
  compileResult: unknown = { compiled: true, ...NO_FINDINGS };
  /** The `decompileModule` result; the default wrote `<input>.aa2m` without findings. */
  decompileResult: unknown = { outputUri: 'file:///extensionless binary.aa2m', ...NO_FINDINGS };
  /** Thrown by the next server command instead of answering it. */
  commandError?: Error;

  /** `ensure`, `saveAs:<uri>`, `output` and `input`, in order. */
  readonly steps: string[] = [];
  readonly requests: { command: string; argument: unknown }[] = [];
  readonly remembered = new Map<string, string>();
  readonly outputSuggestions: (string | undefined)[] = [];
  readonly outputDocuments: string[] = [];
  readonly progressTitles: string[] = [];
  readonly announced: string[] = [];
  readonly summaries: CommandSummary[] = [];

  readonly commands: ModuleCommands;

  constructor(readonly root: ModuleDocument = moduleDocument('file:///source.aa2m')) {
    this.open.set(root.uri, root);
    this.commands = new ModuleCommands(this.ports());
  }

  ports(): ModuleCommandPorts {
    return { documents: this, targets: this, dialogs: this, server: this, reporter: this };
  }

  /** Server command names requested so far, in order. */
  get commandNames(): string[] {
    return this.requests.map(request => request.command);
  }

  async getDocument(uri?: string): Promise<ModuleDocument | undefined> {
    const document = this.open.get(uri ?? this.root.uri);
    return document && { ...document };
  }

  async saveAs(document: ModuleDocument): Promise<ModuleDocument | undefined> {
    this.steps.push('saveAs:' + document.uri);
    if (this.saveAsResult) {
      this.open.delete(document.uri);
      this.open.set(this.saveAsResult.uri, this.saveAsResult);
    }
    return this.saveAsResult && { ...this.saveAsResult };
  }

  rememberedOutput(sourceUri: string): string | undefined {
    return this.remembered.get(sourceUri);
  }

  async rememberOutput(sourceUri: string, outputUri: string): Promise<void> {
    this.remembered.set(sourceUri, outputUri);
  }

  async chooseOutput(document: ModuleDocument, suggested?: string): Promise<string | undefined> {
    this.steps.push('output');
    this.outputDocuments.push(document.uri);
    this.outputSuggestions.push(suggested);
    return this.outputChoice;
  }

  async chooseInput(): Promise<string | undefined> {
    this.steps.push('input');
    return this.inputChoice;
  }

  withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
    this.progressTitles.push(title);
    return task();
  }

  displayPath(uri: string): string {
    return uri.replace('file:///', '');
  }

  async executeCommand(command: string, argument: unknown): Promise<unknown> {
    this.requests.push({ command, argument });
    if (this.commandError) {
      throw this.commandError;
    }
    return command === 'aa2modulus.compileDocument' ? this.compileResult : this.decompileResult;
  }

  async requireCommands(): Promise<void> {
    this.steps.push('ensure');
  }

  compiled(sourceUri: string, outputUri: string): void {
    this.announced.push(`${sourceUri} -> ${outputUri}`);
  }

  showSummary(summary: CommandSummary): void {
    this.summaries.push(summary);
  }
}
