import * as vscode from 'vscode';
import type { ServerSession } from '../server/session';
import { useServerExecutable } from '../server/vscodeSelectServer';
import { errorMessage } from '../shared/errors';
import { COMMANDS, SERVER_SETTINGS } from '../shared/ids';
import { notify, type NotificationActions, showOutputAction } from '../shared/vscodeNotifications';
import { installedTag, installRelease, pruneInstalls, verifyRelease } from './install';
import {
  describeRelease, download, fetchReleases, RELEASES_PAGE, type ReleaseTarget, releaseTarget, type ServerRelease
} from './releases';

/**
 * AA2M: Download Language Server. Lists the toolchain releases for this host
 * that serve this extension's contract (pre-releases and releases without a
 * manifest marked), downloads the picked zip, verifies it, unpacks it into
 * global storage and uses it as `aa2m.server.command`. Earlier installs are
 * removed afterwards. Returns the command handler; one download runs at a time.
 */
export function createDownloadServerCommand(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  session: ServerSession
): () => Promise<void> {
  let downloading = false;
  return async () => {
    if (downloading) {
      void vscode.window.showInformationMessage('An aa2modulus download is already in progress.');
      return;
    }
    downloading = true;
    try {
      await pickAndInstall(context, output, session);
    } finally {
      downloading = false;
    }
  };
}

async function pickAndInstall(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
  session: ServerSession
): Promise<void> {
  const target = releaseTarget(process.platform, process.arch);
  if (!target) {
    notify(
      vscode.window.showErrorMessage,
      `The toolchain publishes no aa2modulus build for ${process.platform}-${process.arch}. `
        + 'Select an executable you built yourself.',
      { ...selectExecutableAction(), ...openReleasesAction() }
    );
    return;
  }
  const root = vscode.Uri.joinPath(context.globalStorageUri, 'server').fsPath;
  const command = vscode.workspace.getConfiguration(SERVER_SETTINGS.section).get<unknown>(SERVER_SETTINGS.command);
  const current = typeof command === 'string' ? installedTag(root, command) : undefined;

  const release = await pickRelease(target, current, output);
  if (!release) {
    return;
  }
  const executable = await downloadAndInstall(release, target, root, output);
  if (!executable) {
    return;
  }
  output.info(`aa2modulus ${release.tag} installed at ${executable}; `
    + (release.asset.sha256 ? 'zip digest and ' : 'no zip digest from GitHub; ') + 'SHA256SUMS verified.');

  await useServerExecutable(output, session, executable);
  await session.whenSettled();
  const leftovers = await pruneInstalls(root, release.tag);
  if (leftovers.length > 0) {
    output.warn('Could not remove earlier server installs yet (' + leftovers.join(', ') + '); the next download retries.');
  }
  notify(
    vscode.window.showInformationMessage,
    `aa2modulus ${release.tag} is installed and set as the AA2M language server.`,
    showOutputAction(output)
  );
}

/** Lists the releases for `target` and lets the user pick one; undefined when there is none or the user cancels. */
async function pickRelease(
  target: ReleaseTarget,
  currentTag: string | undefined,
  output: vscode.LogOutputChannel
): Promise<ServerRelease | undefined> {
  const releases = await cancellable('Fetching aa2modulus releases…', output, (signal) =>
    fetchReleases(fetch, target.asset, signal));
  if (!releases) {
    return undefined;
  }
  if (releases.length === 0) {
    notify(
      vscode.window.showWarningMessage,
      `No aa2modulus release that this extension supports has a ${target.asset} yet.`,
      { ...openReleasesAction(), ...selectExecutableAction() }
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    releases.map(release => ({ ...describeRelease(release, currentTag), release })),
    {
      title: 'Download the aa2modulus language server',
      placeHolder: 'Choose a release; pre-releases and releases of unknown compatibility are marked',
      matchOnDescription: true,
      matchOnDetail: true
    }
  );
  return picked?.release;
}

/**
 * Downloads, verifies and installs `release` under `root`. Returns the
 * executable, or undefined after a cancel or a reported failure.
 */
function downloadAndInstall(
  release: ServerRelease,
  target: ReleaseTarget,
  root: string,
  output: vscode.LogOutputChannel
): Promise<string | undefined> {
  return cancellable(`Downloading aa2modulus ${release.tag}`, output, async (signal, progress) => {
    let reported = 0;
    const archive = await download(fetch, release.asset.url, {
      signal,
      onProgress: (received, total) => {
        const expected = total || release.asset.size;
        if (expected > 0) {
          const percent = Math.min(100, Math.floor(received * 100 / expected));
          progress.report({ increment: percent - reported, message: megabytes(received) + ' of ' + megabytes(expected) });
          reported = percent;
        }
      }
    });
    progress.report({ message: 'Verifying and unpacking' });
    const verified = await verifyRelease(archive, target.executable, release.asset.sha256);
    return installRelease(root, release.tag, target.executable, verified);
  });
}

/**
 * Runs `task` under a cancellable progress notification. Returns undefined when
 * the user cancels, or after reporting a failure.
 */
async function cancellable<T>(
  title: string,
  output: vscode.LogOutputChannel,
  task: (signal: AbortSignal, progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
): Promise<T | undefined> {
  const controller = new AbortController();
  const label = title.replace(/…$/, '');
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return task(controller.signal, progress);
      }
    );
  } catch (error) {
    if (controller.signal.aborted) {
      output.info(label + ': cancelled.');
      return undefined;
    }
    const message = errorMessage(error);
    output.error(label + ' failed: ' + message);
    notify(
      vscode.window.showErrorMessage,
      'AA2M server download failed. ' + message,
      { ...openReleasesAction(), ...selectExecutableAction(), ...showOutputAction(output) }
    );
    return undefined;
  }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openReleasesAction(): NotificationActions {
  return { 'Open Releases Page': () => vscode.env.openExternal(vscode.Uri.parse(RELEASES_PAGE)) };
}

function selectExecutableAction(): NotificationActions {
  return { 'Select Executable…': () => vscode.commands.executeCommand(COMMANDS.selectServer) };
}
