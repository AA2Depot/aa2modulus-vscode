# Language server contract: the client side

The server owns parsing, imports, diagnostics, analysis and module operations.
Its side of the boundary is in the toolchain's
[`docs/lsp.md`](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md),
under [Client contract](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#client-contract).
This page covers the other side: what the extension sends, which server facts
it relies on and what it does with them. If the two disagree, the toolchain's
current code wins and this page is the one to fix.

## Launch

The extension runs `aa2m.server.command` with `aa2m.server.args` (defaults
`aa2modulus` and `["lsp-server"]`) and the optional `aa2m.server.cwd`. It
launches it:

- directly, with `shell: false` and each argument passed as is;
- on the extension host, so a WSL, SSH or other remote window needs an
  executable and native paths on that remote host;
- over the child's standard input and output, with no `transport` option.
  vscode-languageclient would add `--stdio` otherwise, and the server rejects
  it;
- with `aa2m.server.cwd` set to an absolute directory, or left empty for the
  language client default.

### Lifecycle

- The server starts on first AA2M use: an `.aa2m` or `.aa2mi` document, or a
  server, module or Browse Built-ins command. It never starts on activation
  alone, because the setup commands and the walkthrough activate the
  extension too.
- While `aa2m.server.command` is blank and no server is ready, activation only
  offers setup in a notification. Starting with a blank command fails like a
  missing executable and shows the same notification.
- Once started, the server restarts when an `aa2m.server` setting changes or
  the workspace becomes trusted.
- Initialization gets 15 seconds.
- There's no automatic restart. A connection that closes after
  initialization is reported once, in the status item and in a notification
  with Restart. vscode-languageclient's `error` and `closed` handlers return
  `handled: true`, so the library only logs.
- In an untrusted workspace the server doesn't start, and module commands and
  Browse Built-ins don't run.
- Deactivation sends the normal LSP shutdown and exit.

## Server download

**AA2M: Download Language Server…** relies on these facts about the
toolchain's GitHub releases. Its release workflow builds them, and
[Recipe and outputs](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/standalone.md#recipe-and-outputs)
lists the files.

- Releases of `AA2Depot/AA2Modulus` come from the GitHub REST API
  (`/repos/AA2Depot/AA2Modulus/releases`, first page, no token). Pre-releases
  are offered and marked. Drafts never are.
- Each release has a manifest, `aa2modulus-manifest.json`
  ([Client contract](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#client-contract)).
  A release whose `contractVersion` isn't the supported contract (2,
  `SUPPORTED_CONTRACT_VERSION` in `src/server/serverFeatures.ts`) isn't
  offered. A release without a readable manifest of schema
  `aa2modulus.release-manifest.v1` is offered and marked "Compatibility
  unknown".
- The assets are named `aa2modulus-linux-x64.zip` and
  `aa2modulus-windows-x64.zip`. A release without the asset for the host isn't
  offered.
- The zip is flat (no folders) and holds `aa2modulus` or `aa2modulus.exe`, plus
  a `SHA256SUMS` file in `sha256sum` format that lists it. A nested path, a
  missing executable, a missing line or a mismatch refuses the install. When
  GitHub gives the asset a `digest` (`sha256:`), it has to match the zip.
- Tags work as a single directory name (letters, digits, `.`, `_`, `-`).

The extension unpacks the zip into `<globalStorage>/server/<tag>/`, marks the
executable as executable outside Windows, writes its path to
`aa2m.server.command` and removes the other folders there. `aa2m.server.args`
and `aa2m.server.cwd` stay as they are, and the server launches as usual.

### Update check

While `aa2m.checkForServerUpdates` is on (the default), every time a server
becomes ready the extension compares its `serverInfo.version` with the newest
release whose manifest states the supported contract.

- It lists releases the same way as Download, at most once a day, and keeps
  the result in `globalState`.
- It only compares `X.Y.Z` versions with `vX.Y.Z` tags. Anything else, such as
  a development build, skips the check.
- A newer release shows a language status item with Download and one
  notification per release.
- Listing failures are only logged.

The version only decides this notice. It never decides compatibility.

## Initialization

The extension sends:

- documents with language IDs `aa2m` and `aa2mi`, in the `file` and
  `untitled` schemes;
- no `initializationOptions`;
- the client capabilities vscode-languageclient advertises. These include
  snippet completion, `workspace.textDocumentContent` (so the server can serve
  built-in pages), `window.showDocument` (so decompile can open its output),
  rename `prepareSupport`, versioned `documentChanges`, semantic-token
  `refreshSupport` and dynamic registration of
  `workspace/didChangeWatchedFiles`. The server registers its own source
  watcher, so the extension sets no `synchronize.fileEvents`.

It reads the initialize result once, in `readServerFeatures`
(`src/server/serverFeatures.ts`). A missing or malformed field counts as
unsupported. A missing feature only hides its commands, through the
`aa2m.*Unsupported` context keys that are set while a ready server lacks it.

| Field | What the extension does |
| --- | --- |
| `serverInfo.name`, `serverInfo.version` | Shows them in the status item and the output channel. The version only feeds the [update check](#update-check), never compatibility |
| `capabilities.experimental.aa2modulus.contractVersion` | Supports exactly 2. The server raises it only on a breaking change. Lower, higher or missing gets a status item warning (too old or too new), a log entry and one notification per executable. Module commands are refused and hidden; everything else keeps working |
| `capabilities.experimental.aa2modulus.builtinCatalog` | If not `true`, Browse Built-ins is hidden and explains that the server doesn't serve built-ins |
| `capabilities.experimental.aa2modulus.completionSnippets` | If not `true`, New Module opens the empty document and says the server has no starter, instead of opening suggestions |
| `capabilities.executeCommandProvider.commands` | Checked, along with the contract, before a module command opens a dialog |

## Built-in pages

F12 on a built-in returns `aa2m-builtin:/<anchor>.md`. The server serves those
pages through `workspace/textDocumentContent`, and vscode-languageclient
registers the content provider. The extension serves no pages itself.

- Pages open in the Markdown preview, through a `workbench.editorAssociations`
  default for `aa2m-builtin:/**`. They stay in the `markdown` language even
  when another association claims `*.md`.
- **AA2M: Browse Built-ins** starts the server, sends each query as
  `workspace/symbol` and lists the results whose URI uses the `aa2m-builtin`
  scheme. It keeps the server's order and shows the `containerName` (the
  native name) as the description.
- Both need a running server and a trusted workspace. See
  [Built-in documentation](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#built-in-documentation).

## Authoring features

Diagnostics, completion, hover, signature help, definition, document symbols,
references, highlights, rename, semantic tokens, inlay hints and quick fixes
are forwarded as plain LSP. How they behave is up to the server; see the
toolchain's
[References and rename](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#references-and-rename)
and [Quick fixes](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#quick-fixes).
The client only adds this:

- A Function or Method completion item whose snippet is a call with
  placeholders, and that has no command, gets
  `editor.action.triggerParameterHints`. Keyword snippets can hold calls too,
  but they're left alone.
- **AA2M: New Module** opens an empty untitled module and triggers
  suggestions. The server's starter comes first when the server advertises
  `completionSnippets`.
- The grammar colors only comments, strings (block strings included) and
  numbers. Every other color comes from the server's semantic tokens.
  `test:server` compares these rules with the `editor-data lexicon` of the
  release under test.
- `configurationDefaults` turn on `editor.semanticHighlighting.enabled` for
  both languages. `semanticTokenScopes` map `variable.defaultLibrary.readonly`
  to `constant.language.aa2m` (`ThisCard`, `TriggeringCard`) and `macro` to
  `entity.name.function.aa2m`. Other tokens use VS Code's standard fallback
  scopes.
- VS Code echoes `Diagnostic.data` back in code action requests. The extension
  never reads it.

## Module commands

The request and result shapes of `aa2modulus.compileDocument` and
`aa2modulus.decompileModule` are in the toolchain's
[Command wire format](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#command-wire-format).
`src/moduleCommands/protocol.ts` reads the results. It drops a malformed count
or finding, and treats a result without `compiled` (compile) or `outputUri`
(decompile) as an error. The editor side belongs to the extension:

- Compile checks the advertised commands and the contract, then saves an
  untitled root with Save As. It asks for the output every time, starting at
  the target last used for that module in this workspace, and sends the
  version the editor holds. Nothing else gets saved. A `ContentModified` error
  (an input changed during the compile) shows like any other failure.
- Decompile takes its input from the Explorer or an open dialog. The server
  writes the source next to the binary and opens it with
  `window/showDocument`.
- The server publishes located findings as diagnostics and logs every finding
  to the output channel. The extension shows one notification that counts
  errors (or warnings), with Show Problems when some of them have a location.

## CLI problem matcher

The `$aa2m` problem matcher parses the toolchain CLI's
[short format](https://github.com/AA2Depot/AA2Modulus/blob/main/docs/lsp.md#cli-short-format).
Its owner is `aa2m-cli`, its source `aa2modulus cli`, and it resolves file
locations against the workspace folder. It doesn't match binary-only findings
or `note:` lines. `test/lexical/problemMatcher.test.ts` checks the pattern.
