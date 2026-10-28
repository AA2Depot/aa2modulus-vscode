// Wire shapes of the server's module commands (`aa2modulus.compileDocument`,
// `aa2modulus.decompileModule`). Results arrive as `unknown` and are read once
// here: a malformed field falls back to an empty value, except the fields a
// command cannot report without.

/** The server's module command IDs (`workspace/executeCommand`). */
export const SERVER_COMMANDS = {
  compileDocument: 'aa2modulus.compileDocument',
  decompileModule: 'aa2modulus.decompileModule'
} as const;

export type CommandSeverity = 'error' | 'warning' | 'info';

/** A finding without a range (output, write, read and binary-only findings). */
export interface CommandFinding {
  severity: CommandSeverity;
  code?: string;
  message: string;
}

/** Counts of every finding of a command, located or not, and the findings without a range. */
export interface CommandFindings {
  errors: number;
  warnings: number;
  unlocated: CommandFinding[];
}

export interface CompileResult extends CommandFindings {
  compiled: boolean;
}

export interface DecompileResult extends CommandFindings {
  /** The file the server wrote. */
  outputUri: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readFinding(value: unknown): CommandFinding | undefined {
  const finding = record(value);
  const severity = finding.severity;
  if ((severity !== 'error' && severity !== 'warning' && severity !== 'info') || typeof finding.message !== 'string') {
    return undefined;
  }
  const read: CommandFinding = { severity, message: finding.message };
  if (typeof finding.code === 'string') {
    read.code = finding.code;
  }
  return read;
}

function readFindings(result: Record<string, unknown>): CommandFindings {
  const unlocated = Array.isArray(result.unlocated) ? result.unlocated : [];
  return {
    errors: count(result.errors),
    warnings: count(result.warnings),
    unlocated: unlocated.map(readFinding).filter(finding => finding !== undefined)
  };
}

/** Reads an `aa2modulus.compileDocument` result; throws when `compiled` is not a boolean. */
export function readCompileResult(value: unknown): CompileResult {
  const result = record(value);
  if (typeof result.compiled !== 'boolean') {
    throw new Error('The AA2M server returned an unexpected compile result.');
  }
  return { compiled: result.compiled, ...readFindings(result) };
}

/** Reads an `aa2modulus.decompileModule` result; throws when `outputUri` is missing. */
export function readDecompileResult(value: unknown): DecompileResult {
  const result = record(value);
  if (typeof result.outputUri !== 'string' || !result.outputUri) {
    throw new Error('The AA2M server returned an unexpected decompile result.');
  }
  return { outputUri: result.outputUri, ...readFindings(result) };
}
