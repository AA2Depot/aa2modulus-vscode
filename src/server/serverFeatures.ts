/**
 * The `capabilities.experimental.aa2modulus.contractVersion` this extension
 * speaks. The server raises the number only on a breaking wire change, so an
 * older or a newer number is not supported. Change it when the client moves to
 * a new contract.
 */
export const SUPPORTED_CONTRACT_VERSION = 2;

/** What the server's `initialize` result says it supports, validated once. */
export interface ServerFeatures {
  /** `experimental.aa2modulus.contractVersion`; undefined when missing or not a positive integer. */
  contractVersion?: number;
  /** `contractVersion` equals `SUPPORTED_CONTRACT_VERSION`; module commands need it. */
  isContractSupported: boolean;
  /** The server serves `aa2m-builtin:` pages and lists built-ins in `workspace/symbol`. */
  builtinCatalog: boolean;
  /** The server offers keyword snippets and the empty-document starters. */
  completionSnippets: boolean;
  /** `executeCommandProvider.commands`. */
  commands: readonly string[];
}

/** Features of a server that has not answered `initialize`: nothing is supported. */
export const NO_FEATURES: ServerFeatures = {
  isContractSupported: false,
  builtinCatalog: false,
  completionSnippets: false,
  commands: []
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function readCommands(capabilities: Record<string, unknown>): string[] {
  const commands = record(capabilities.executeCommandProvider).commands;
  return Array.isArray(commands) ? commands.filter(command => typeof command === 'string') : [];
}

/**
 * Reads `initializeResult.capabilities`. A missing or malformed field means
 * unsupported; only a flag that is exactly `true` enables its feature.
 */
export function readServerFeatures(capabilities: unknown): ServerFeatures {
  const root = record(capabilities);
  const aa2modulus = record(record(root.experimental).aa2modulus);
  const features: ServerFeatures = {
    isContractSupported: false,
    builtinCatalog: aa2modulus.builtinCatalog === true,
    completionSnippets: aa2modulus.completionSnippets === true,
    commands: readCommands(root)
  };
  const contractVersion = aa2modulus.contractVersion;
  if (typeof contractVersion === 'number' && Number.isInteger(contractVersion) && contractVersion > 0) {
    features.contractVersion = contractVersion;
    features.isContractSupported = contractVersion === SUPPORTED_CONTRACT_VERSION;
  }
  return features;
}

/** The status warning and the notification for a server whose contract this extension does not speak. */
export interface UnsupportedContractNotice {
  warning: string;
  message: string;
}

/**
 * Explains an unsupported contract. A newer server needs a newer extension; a
 * missing or older version means an older server.
 */
export function describeUnsupportedContract(features: ServerFeatures): UnsupportedContractNotice {
  if (features.contractVersion !== undefined && features.contractVersion > SUPPORTED_CONTRACT_VERSION) {
    return {
      warning: 'Server too new for module commands',
      message: 'This AA2M server is newer than this extension supports; Compile Module and Decompile Module are '
        + 'unavailable. Update the AA2M extension, or use AA2M: Download Language Server… to get a matching release.'
    };
  }
  return {
    warning: 'Server too old for module commands',
    message: 'This AA2M server is too old for module commands; Compile Module and Decompile Module are '
      + 'unavailable. Use AA2M: Download Language Server… to get a current release.'
  };
}

/** The server advertises `command` and a contract that module commands support. */
export function hasCommand(features: ServerFeatures, command: string): boolean {
  return features.isContractSupported && features.commands.includes(command);
}

/**
 * Whether a ready server lacks what `has` checks. False while no server is
 * ready, so menus keep a command whose use starts the server.
 */
export function readyServerLacks(
  status: { state: string; features?: ServerFeatures },
  has: (features: ServerFeatures) => boolean
): boolean {
  return status.state === 'ready' && status.features !== undefined && !has(status.features);
}
