import * as vscode from 'vscode';
import { isServerCommandSet } from '../server/configuration';
import { COMMANDS, SERVER_SETTINGS, STATE_KEYS, WALKTHROUGH } from '../shared/ids';
import { notify } from '../shared/vscodeNotifications';
import { shouldOfferSetup } from './setupPrompt';

/** Opens the Get Started walkthrough at its server step. */
export function openServerWalkthrough(context: vscode.ExtensionContext): Thenable<unknown> {
  const category = `${context.extension.id}#${WALKTHROUGH.id}`;
  return vscode.commands.executeCommand('workbench.action.openWalkthrough', { category, step: WALKTHROUGH.serverStep }, false);
}

/** Offers server setup in one notification while no server command is configured. */
export interface ServerSetupPrompt {
  /**
   * Shows the setup notification unless a command is configured or the user
   * chose Don't Show Again. Returns whether the notification is
   * on screen (just shown or still open), so a caller can skip its own message.
   */
  offer(): boolean;
}

export function createServerSetupPrompt(context: vscode.ExtensionContext): ServerSetupPrompt {
  let showing = false;
  return {
    offer() {
      const inspected = vscode.workspace.getConfiguration(SERVER_SETTINGS.section)
        .inspect<unknown>(SERVER_SETTINGS.command);
      const offer = shouldOfferSetup({
        dismissed: context.globalState.get<boolean>(STATE_KEYS.serverSetupPromptDismissed) === true,
        commandConfigured: [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue]
          .some(isServerCommandSet)
      });
      if (!offer) {
        return false;
      }
      if (!showing) {
        showing = true;
        const closed = () => {
          showing = false;
        };
        notify(
          vscode.window.showInformationMessage,
          'No aa2modulus language server is set up yet. Download a release, or select an executable you already have.',
          {
            'Download Server…': () => vscode.commands.executeCommand(COMMANDS.downloadServer),
            'Set Up Server…': () => openServerWalkthrough(context),
            'Don\'t Show Again': () => context.globalState.update(STATE_KEYS.serverSetupPromptDismissed, true)
          }
        ).then(closed, closed);
      }
      return true;
    }
  };
}
