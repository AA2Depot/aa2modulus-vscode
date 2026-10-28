import * as vscode from 'vscode';
import type { ServerStatus } from '../server/status';
import type { ServerRuntime } from '../server/vscodeServer';
import { errorMessage } from '../shared/errors';
import { COMMANDS, LANGUAGES, SERVER_UPDATE_STATUS_ITEM, STATE_KEYS, UPDATE_SETTINGS } from '../shared/ids';
import { notify, type NotificationActions } from '../shared/vscodeNotifications';
import { fetchReleases, releaseTarget } from './releases';
import {
  availableUpdate, isCheckDue, newestSupportedRelease, parseReleaseVersion, readUpdateCheckRecord, recordCheck,
  type UpdateCheckRecord
} from './serverUpdate';

/**
 * Registers the server update check. Each time a server becomes ready, and
 * when `aa2m.checkForServerUpdates` changes, it compares the server's version
 * with the newest supported release (listed at most once a day). While a newer
 * one exists, a language status item offers Download, and each such release is
 * announced once. Failures are only logged.
 */
export function registerServerUpdateCheck(
  context: vscode.ExtensionContext,
  server: ServerRuntime,
  output: vscode.LogOutputChannel
): void {
  const check = new ServerUpdateCheck(context.globalState, output);
  context.subscriptions.push(
    check,
    server.controller.status.onDidChange((status, previous) => {
      if (status.state === 'ready' && previous.state !== 'ready') {
        void check.run(status);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(UPDATE_SETTINGS.checkForServerUpdatesSetting)) {
        void check.run(server.controller.status.current);
      }
    })
  );
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration(UPDATE_SETTINGS.section)
    .get<unknown>(UPDATE_SETTINGS.checkForServerUpdates) !== false;
}

/** The update status item and notification for the current server; listings in flight are shared. */
class ServerUpdateCheck implements vscode.Disposable {
  private item: vscode.LanguageStatusItem | undefined;
  private listing: Promise<UpdateCheckRecord | undefined> | undefined;

  constructor(
    private readonly state: vscode.Memento,
    private readonly output: vscode.LogOutputChannel
  ) {}

  /** Shows, updates or hides the notice for `status`. Never rejects. */
  async run(status: ServerStatus): Promise<void> {
    const version = status.serverVersion;
    if (status.state !== 'ready' || !isEnabled()) {
      this.show(undefined, version);
      return;
    }
    if (!parseReleaseVersion(version)) {
      this.output.info(`Server update check skipped: ${version ?? 'no version'} is not a release version.`);
      this.show(undefined, version);
      return;
    }
    try {
      const update = availableUpdate(version, await this.latest());
      this.show(update, version);
      if (update?.tag !== undefined && this.state.get<unknown>(STATE_KEYS.serverUpdateNotified) !== update.tag) {
        await this.state.update(STATE_KEYS.serverUpdateNotified, update.tag);
        this.announce(update.tag, update.pageUrl, version);
      }
    } catch (error) {
      this.output.warn('Server update check failed: ' + errorMessage(error));
    }
  }

  dispose(): void {
    this.item?.dispose();
  }

  /** The stored listing while it is fresh, otherwise a new one; the stored one when listing fails. */
  private latest(): Promise<UpdateCheckRecord | undefined> {
    const stored = readUpdateCheckRecord(this.state.get<unknown>(STATE_KEYS.serverUpdateCheck));
    if (!isCheckDue(stored, Date.now())) {
      return Promise.resolve(stored);
    }
    this.listing ??= this.list(stored).finally(() => {
      this.listing = undefined;
    });
    return this.listing;
  }

  private async list(stored: UpdateCheckRecord | undefined): Promise<UpdateCheckRecord | undefined> {
    const target = releaseTarget(process.platform, process.arch);
    if (!target) {
      return undefined;
    }
    try {
      const record = recordCheck(Date.now(), newestSupportedRelease(await fetchReleases(fetch, target.asset)));
      await this.state.update(STATE_KEYS.serverUpdateCheck, record);
      this.output.info(`Server update check: newest supported release ${record.tag ?? 'none'}.`);
      return record;
    } catch (error) {
      this.output.warn('Server update check could not list the releases: ' + errorMessage(error));
      return stored;
    }
  }

  private show(update: UpdateCheckRecord | undefined, version: string | undefined): void {
    if (update?.tag === undefined) {
      this.item?.dispose();
      this.item = undefined;
      return;
    }
    this.item ??= vscode.languages.createLanguageStatusItem(
      SERVER_UPDATE_STATUS_ITEM, [{ language: LANGUAGES.module }, { language: LANGUAGES.library }]
    );
    this.item.name = 'AA2M Server Update';
    this.item.text = `aa2modulus ${update.tag} available`;
    this.item.detail = `The language server is ${version ?? 'unknown'}`;
    this.item.command = { command: COMMANDS.downloadServer, title: 'Download…' };
  }

  private announce(tag: string, pageUrl: string | undefined, version: string | undefined): void {
    const actions: NotificationActions = {
      'Download…': () => vscode.commands.executeCommand(COMMANDS.downloadServer)
    };
    if (pageUrl !== undefined) {
      actions['Release Notes'] = () => vscode.env.openExternal(vscode.Uri.parse(pageUrl));
    }
    void notify(
      vscode.window.showInformationMessage,
      `aa2modulus ${tag} is available; this AA2M language server is ${version ?? 'older'}.`,
      actions
    );
  }
}
