# Architecture

This page covers what the TypeScript in `src/` is made of, which way its
imports run and which module owns each flow you see in the editor. For how
code inside a file reads, see [Code style](code-style.md). The wire boundary
is in the [server contract](server-contract.md), and user-facing behaviour is
in the [README](../README.md).

## Shape

The extension is a thin client and ships no data from the toolchain. Keyword
and name colors (semantic tokens), completion, snippets, built-in
documentation and module operations all come from the server.

`package.json` declares the language configuration (comments, brackets) and a
grammar that colors only comments, strings and numbers, so a file has some
color before the server answers. The TypeScript is split by job:

| Folder | Job |
| --- | --- |
| `src/server/` | Run the external language server: settings, start and restart, status, failures, the features it advertises |
| `src/serverSetup/` | Get a server: download a release, check for updates, offer setup when none is configured |
| `src/moduleCommands/` | Compile and decompile through server commands, and New Module |
| `src/builtins/` | Browse Built-ins over the server's built-in pages |
| `src/shared/` | Helpers any folder can use. `ids.ts` holds the IDs `package.json` declares |

## Core modules and adapters

Every folder has two kinds of files:

- Core modules never import `vscode`. Logic, decisions, state machines and
  validation live here, and unit tests run them with fakes.
- Adapters (`vscode*.ts`) connect the core to the editor. They register
  commands and listeners, read settings, and show the dialogs and
  notifications the core decided on. Any decision left in an adapter should be
  trivial.

`src/extension.ts` is the composition root. It creates every long-lived
object, wires them together and returns the extension API. ESLint enforces
the `vscode` import boundary.

## Import direction

```
                 extension.ts
           /          |          \
   serverSetup   moduleCommands   builtins
           \          |          /
                    server
                      |
                    shared
```

| Folder | May import from |
| --- | --- |
| `shared` | nothing in `src/` |
| `server` | `shared` |
| `builtins` | `shared`, `server` |
| `serverSetup` | `shared`, `server` |
| `moduleCommands` | `shared`, `server` |
| `extension.ts` | everything |

- The table covers core modules and adapters alike. Folders never import each
  other in a cycle.
- When a lower folder needs something from a higher one, it declares a port
  (an interface or a callback). The higher folder implements it and
  `extension.ts` connects the two. For example, `registerLanguageServer` takes
  an `OfferSetup` callback, and `extension.ts` passes it the setup prompt's
  `offer`.
- ESLint enforces the table through `ALLOWED_IMPORTS` in `eslint.config.mjs`.

## Runtime objects

`activate` builds these, in this order:

1. The *AA2M Language Server* output channel.
2. The setup prompt (`createServerSetupPrompt`).
3. The server runtime (`registerLanguageServer`). That's a `ServerController`
   that owns the current client, a `ServerSession` that decides when to start
   it, the status item, the server commands and the start and restart
   triggers.
4. Built-in documentation (`registerBuiltinDocs`): Browse Built-ins and the
   `markdown` language for `aa2m-builtin:` pages. The content provider for
   those pages belongs to vscode-languageclient.
5. Module commands (`registerModuleCommands`): a `ModuleCommands` instance
   over five editor ports (`ModuleCommandPorts`: documents, compile targets,
   dialogs, server, reporter).
6. New Module, Download Language Server (`createDownloadServerCommand`), the
   server update check (`registerServerUpdateCheck`), and the setup offer
   after the first start settles.
7. The returned API: `whenSettled`, `restart` and `status`, which the e2e
   tests use. `whenSettled` and `restart` reject when the start failed.

`deactivate` shuts the controller down.

## Flows and owners

Each flow starts with what triggers it, then the modules it passes through in
order. The owner is where you start when you change the flow.

### Server start

Triggered when an AA2M document opens or a command needs the server.

1. `ServerSession.ensureStarted` (`session.ts`) decides whether to start.
2. `ServerController.start` (`controller.ts`) queues the start. Start,
   restart, shutdown and commands all share that one queue.
3. The client factory in `vscodeLanguageClient.ts` reads the settings and
   builds the `LanguageClient` with its middleware.
4. `ManagedLanguageClient` (`managedClient.ts`) applies the timeout, reads the
   advertised features with `readServerFeatures` (`serverFeatures.ts`) and
   checks the contract.
5. `ServerStatusModel` (`status.ts`) records the status, `describeStatus`
   (`statusPresentation.ts`) turns it into text, and the status item in
   `vscodeServer.ts` shows it.

The session resolves with a `StartOutcome` and never rejects. Owner:
`session.ts` for when, `controller.ts` for ordering.

### Restart triggers

A change to an `aa2m.server.*` setting, a trust grant or AA2M: Restart
Language Server calls `ServerSession.restartIfStarted` or `restart`. Owner:
`vscodeServer.ts`.

### Crash

1. The client goes from running to stopped, and `ManagedLanguageClient`
   notices.
2. The `onDidCrash` listener in `controller.ts` sets the status to `crashed`.
3. `reportTransition` in `vscodeServer.ts` shows one notification.

Owner: `managedClient.ts` for detection, `vscodeServer.ts` for the notice.

### Failed start and setup offer

1. The start fails, and `ServerSession` calls its failure callback,
   `reportStartFailure` (`vscodeServer.ts`).
2. `startFailureNotice` (`startFailure.ts`) picks the notice: a start error,
   or "not found". `isMissingExecutable` (`startFailure.ts`) and
   `ServerCommandNotSetError` (`configuration.ts`) classify the failure.
3. When the setup prompt shows (`vscodeSetupPrompt.ts`, with its rules in
   `setupPrompt.ts`), it replaces the "not found" notice.

Separately, `extension.ts` offers setup when `needsSetupOfferAfterStart`
(`startFailure.ts`) says the first start ended without a ready server and
without failing. Owner: `startFailure.ts` for the decision, `vscodeServer.ts`
for showing it.

### Select Server Executable

`selectServer` (`vscodeSelectServer.ts`) opens a file dialog, and
`useServerExecutable` writes the pick to `aa2m.server.command`. The settings
trigger then restarts the server.

### Download Language Server

1. The handler from `createDownloadServerCommand` (`vscodeDownloadServer.ts`)
   runs `pickRelease`.
2. `fetchReleases` (`releases.ts`) lists the releases, reads each release
   manifest (`manifestCompatibility`) and drops unsupported ones.
   `describeRelease` labels them for the quick pick.
3. `downloadAndInstall` runs `download`, `verifyRelease` and `installRelease`
   (`install.ts`).
4. `useServerExecutable` points the setting at the new executable, and
   `pruneInstalls` removes the other downloads.

Owner: `vscodeDownloadServer.ts`. The verification rules live in
`install.ts`.

### Server update check

Triggered when the status becomes `ready` or `aa2m.checkForServerUpdates`
changes.

1. `ServerUpdateCheck.run` (`vscodeServerUpdate.ts`) takes the stored listing,
   or calls `fetchReleases` (`releases.ts`) for a fresh one.
2. `newestSupportedRelease` and `availableUpdate` (`serverUpdate.ts`) decide
   whether there's an update.
3. The update status item shows it, with one notification per release.

Owner: `serverUpdate.ts` for the decision, `vscodeServerUpdate.ts` for showing
it.

### Compile Module

1. `run` in `vscodeModuleCommands.ts` starts the server and reports errors.
2. `ModuleCommands.compile` (`moduleCommands.ts`) handles Save As for an
   untitled module and the output dialog, then calls `compileCurrent` with the
   version the editor holds.
3. The ports built in `vscodeModuleCommands.ts` call
   `ServerController.executeCommand`.
4. `readCompileResult` (`protocol.ts`) reads the result, and
   `summarizeCommandFindings` (`commandSummary.ts`) turns it into one
   notification. The server publishes located findings itself.

Owner: `moduleCommands.ts`.

### Decompile Module

Same path as Compile, through `ModuleCommands.decompile` and
`readDecompileResult`. The server writes the source and opens it.

### Command visibility

On a status change, `updateContext` in `vscodeModuleCommands.ts` and
`vscodeBuiltinDocs.ts` asks `readyServerLacks` (`serverFeatures.ts`) and sets
the `aa2m.*Unsupported` context keys that the `package.json` menus test.

### Built-ins

1. Browse Built-ins in `vscodeBuiltinDocs.ts` starts the server.
2. `browseUnavailableMessage` (`browse.ts`) stops it early, with a reason,
   when the workspace is untrusted, the server isn't ready or it doesn't serve
   built-ins.
3. `vscode.executeWorkspaceSymbolProvider` runs the query, and
   `builtinPickItems` (`browse.ts`) builds the quick pick.
4. `markdown.showPreview` opens the page, which vscode-languageclient fetches
   from the server.

## Changing this page

Update this page in the same change that moves a flow, adds a folder or
changes an import rule.
