import * as vscode from 'vscode';

/** Notification buttons in display order: label -> what the button does. */
export type NotificationActions = Record<string, () => unknown>;

type ShowMessage = (message: string, ...items: string[]) => Thenable<string | undefined>;

/**
 * Shows `message` through `show` (for example `vscode.window.showErrorMessage`)
 * with one button per action, and runs the action the user picks. The result
 * settles when the notification closes; callers may ignore it.
 */
export function notify(show: ShowMessage, message: string, actions: NotificationActions = {}): Thenable<void> {
  return show(message, ...Object.keys(actions)).then(action => {
    if (action !== undefined && Object.hasOwn(actions, action)) {
      void actions[action]();
    }
  });
}

/** "Show Output" reveals `output`. */
export function showOutputAction(output: vscode.OutputChannel): NotificationActions {
  return { 'Show Output': () => output.show() };
}

/** "Open Settings" opens the Settings editor filtered by `query`. */
export function openSettingsAction(query: string): NotificationActions {
  return { 'Open Settings': () => vscode.commands.executeCommand('workbench.action.openSettings', query) };
}
