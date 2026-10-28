// Identifiers that `package.json` declares or that VS Code stores for the
// extension. Code uses these constants instead of spelling the strings;
// `test/unit/shared/ids.test.ts` ties them to `package.json`.

/** Language IDs (`contributes.languages`). */
export const LANGUAGES = {
  module: 'aa2m',
  library: 'aa2mi'
} as const;

/** Command IDs (`contributes.commands`). */
export const COMMANDS = {
  restartServer: 'aa2m.restartServer',
  selectServer: 'aa2m.selectServer',
  downloadServer: 'aa2m.downloadServer',
  browseBuiltins: 'aa2m.browseBuiltins',
  showOutput: 'aa2m.showOutput',
  compileModule: 'aa2m.compileModule',
  decompileModule: 'aa2m.decompileModule',
  newModule: 'aa2m.newModule'
} as const;

/** The `aa2m.server.*` settings (`contributes.configuration`). */
export const SERVER_SETTINGS = {
  /** Section for `getConfiguration` and `affectsConfiguration`. */
  section: 'aa2m.server',
  /** Keys relative to `section`. */
  command: 'command',
  args: 'args',
  cwd: 'cwd',
  /** Full name of `aa2m.server.command`, for the Settings editor filter. */
  commandSetting: 'aa2m.server.command'
} as const;

/** `aa2m.checkForServerUpdates`, outside `aa2m.server` so changing it does not restart the server. */
export const UPDATE_SETTINGS = {
  /** Section for `getConfiguration`. */
  section: 'aa2m',
  /** Key relative to `section`. */
  checkForServerUpdates: 'checkForServerUpdates',
  /** Full name, for `affectsConfiguration`. */
  checkForServerUpdatesSetting: 'aa2m.checkForServerUpdates'
} as const;

/** `workspaceState` and `globalState` keys. */
export const STATE_KEYS = {
  /** `workspaceState`: source URI -> output URI of the last compile. */
  compileTargets: 'aa2m.compileTargets',
  /** `globalState`: the user chose Don't Show Again on the setup notification. */
  serverSetupPromptDismissed: 'aa2m.serverSetupPromptDismissed',
  /** `globalState`: the last release listing of the update check (`UpdateCheckRecord`). */
  serverUpdateCheck: 'aa2m.serverUpdateCheck',
  /** `globalState`: the release tag the update notification last announced. */
  serverUpdateNotified: 'aa2m.serverUpdateNotified'
} as const;

/**
 * Context keys for `when` clauses. Each is true only while a ready server
 * lacks the feature, so a command stays visible until a server says no.
 */
export const CONTEXT_KEYS = {
  builtinCatalogUnsupported: 'aa2m.builtinCatalogUnsupported',
  compileUnsupported: 'aa2m.compileUnsupported',
  decompileUnsupported: 'aa2m.decompileUnsupported'
} as const;

/** The Get Started walkthrough (`contributes.walkthroughs`) and its server step. */
export const WALKTHROUGH = {
  id: 'gettingStarted',
  serverStep: 'selectServer'
} as const;

/** The AA2M item in the language status area. */
export const SERVER_STATUS_ITEM = 'aa2m.server';
/** The language status item shown while a newer server release exists. */
export const SERVER_UPDATE_STATUS_ITEM = 'aa2m.serverUpdate';
