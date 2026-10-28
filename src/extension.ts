import * as vscode from 'vscode';
import { registerBuiltinDocs } from './builtins/vscodeBuiltinDocs';
import { registerModuleCommands } from './moduleCommands/vscodeModuleCommands';
import { registerNewModule } from './moduleCommands/vscodeNewModule';
import type { ServerController } from './server/controller';
import { throwIfFailed } from './server/session';
import { needsSetupOfferAfterStart } from './server/startFailure';
import type { ServerStatus } from './server/status';
import { registerLanguageServer } from './server/vscodeServer';
import { createDownloadServerCommand } from './serverSetup/vscodeDownloadServer';
import { registerServerUpdateCheck } from './serverSetup/vscodeServerUpdate';
import { createServerSetupPrompt } from './serverSetup/vscodeSetupPrompt';
import { COMMANDS } from './shared/ids';

/** What `activate` returns: used by the e2e tests. */
export interface AA2MExtensionApi {
  /** Settles when the latest start or restart has finished; rejects if it failed. */
  whenSettled(): Promise<void>;
  restart(): Promise<void>;
  status(): ServerStatus;
}

let controller: ServerController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<AA2MExtensionApi> {
  const output = vscode.window.createOutputChannel('AA2M Language Server', { log: true });
  context.subscriptions.push(output);

  const setupPrompt = createServerSetupPrompt(context);
  const server = registerLanguageServer(context, output, () => setupPrompt.offer());
  controller = server.controller;
  registerBuiltinDocs(context, server, output);
  registerModuleCommands(context, server, output);
  registerNewModule(context, server);
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMANDS.downloadServer, createDownloadServerCommand(context, output, server.session)
    )
  );
  registerServerUpdateCheck(context, server, output);
  void server.session.whenSettled().then(outcome => {
    if (needsSetupOfferAfterStart(outcome, server.controller.status.current)) {
      setupPrompt.offer();
    }
  });

  return {
    whenSettled: async () => throwIfFailed(await server.session.whenSettled()),
    restart: async () => throwIfFailed(await server.session.restart()),
    status: () => server.controller.status.current
  };
}

export async function deactivate(): Promise<void> {
  const stopping = controller;
  controller = undefined;
  await stopping?.shutdown();
}

