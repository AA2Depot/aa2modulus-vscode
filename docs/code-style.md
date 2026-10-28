# Code style

How the TypeScript in `src/` and `test/` is written. [Architecture](architecture.md)
says where code goes and which way imports run; this page is about how the
code inside a file reads. ESLint checks the formatting and some of the rules
([Enforcement](#enforcement) lists which), and review checks the rest.
[Tests](#tests) adds the rules that only apply to tests.

## Principles

1. Find behaviour by name. File, type and function names say what they do,
   so "Go to definition" leads you through a flow without guessing.
2. Decide in pure code, act in adapters. Logic that picks a message, a state
   or a next step lives in a vscode-free module and returns a value. The
   `vscode*.ts` adapter carries it out.
3. Plain statements over clever expressions. An `if` you can read at a glance
   beats a dense one-liner.

## Files and names

- Name a file after its main export, in camelCase: `managedClient.ts` defines
  `ManagedClient`. A file named after a type defines that type.
- Adapters that import `vscode` start with `vscode` (`vscodeServer.ts`). The
  lint boundary relies on that prefix.
- Types, interfaces and classes use PascalCase. Functions, methods and
  variables use camelCase. Module-level constants use UPPER_SNAKE_CASE.
- Booleans read as yes or no: `isTrusted`, `hasProblems`, `canStart`,
  `shouldOfferSetup`, or a past participle such as `disposed`.
- Name things by outcome. A method called `whenReady` resolves when the server
  is ready. One that resolves after any outcome is `whenSettled`. `start`
  starts, and `restart` means something ran before.
- One term for one thing, everywhere. A rename covers code, tests, the README
  and `docs/` in the same change.
- Don't abbreviate, except for standard terms (URI, LSP, ID, SHA). Write
  `configuration`, not `cfg`.

## IDs shared with `package.json`

Command IDs, setting keys, `globalState` and `workspaceState` keys and
walkthrough IDs are constants in `src/shared/ids.ts`. No other file spells out
an `'aa2m.…'` string, and a unit test compares the constants with
`package.json`.

```ts
// No
vscode.commands.executeCommand('aa2m.selectServer');
// Yes
vscode.commands.executeCommand(COMMANDS.selectServer);
```

## Modules and types

- Vscode-free code declares the port it needs from the editor, next to the
  code that uses it (`ModuleCommandPorts` belongs to the module command core).
  A type that one module implements for others is declared next to its
  implementation.
- Keep ports narrow, one concern per interface. Split an interface with more
  than about seven members (documents, dialogs, persistence, server,
  reporting).
- Use `interface` for object shapes and `type` for unions and aliases.
- Use `import type` when an import is only used as a type.
- An object with a lifecycle or more than one mutable flag is a class with
  private fields. Don't build those from closures over `let` variables.
- No mutable module-level state outside `src/extension.ts`. Keep state in an
  object that `activate` creates and disposes.
- Mark array parameters `readonly` when the function doesn't change them.

## Functions and control flow

- A function does one job. Keep bodies under about 40 lines. When a loop body
  does several steps, give each step a named helper.
- Return a decision as a value from a pure function, and let the adapter show
  it. The pure function gets a unit test.

  ```ts
  // core (startFailure.ts): which notice a failed start needs
  export function startFailureNotice(status: ServerStatus, error: unknown): StartFailureNotice { … }
  // adapter (vscodeServer.ts): show it
  const notice = startFailureNotice(controller.status.current, error);
  ```

- Use early returns for guard clauses.
- Use a ternary only to pick between two simple values, and never nest them.
  Use `if`, `switch` or a lookup table instead.
- Build optional properties with `if` statements, not conditional spreads:

  ```ts
  // No
  return { ...(name ? { serverName: name } : {}) };
  // Yes
  const details: ClientDetails = {};
  if (name) {
    details.serverName = name;
  }
  return details;
  ```

- Give an unclear expression a name. A dedupe keyed on a `\0`-joined string
  becomes `uniqueBy(items, item => …)`.
- Every `if`, `for` and `while` body is a block on its own lines, even with a
  single statement. No `if (x) { return; }` on one line.
- A `switch` over a union covers every member, so the compiler flags a missing
  case.

## Async code and errors

- Await, return or `void` every promise. When you drop a rejection on
  purpose, say why with a named helper or a comment. No bare
  `.catch(() => undefined)`.
- A function either reports a failure to the user or rethrows it, never both.
  If callers routinely ignore a rejection, offer a variant that doesn't
  reject.
- Throw an `Error` subclass for a condition that code branches on
  (`ServerCommandNotSetError`). Only match on error text for library errors
  that have no code, and name the library versions in a comment.
- Wire data and settings come in as `unknown`. One `parse*` or `read*`
  function validates them, and the code after it works with typed values. Use
  `as` only on validated data or inside one typed accessor.
- Don't use `any`.

## User-facing text

- Write messages as full sentences that end with a period. Name the command
  (AA2M: Restart Language Server) or the setting (`aa2m.server.command`) the
  user needs.
- A message used in one place stays there. A message used by more than one
  module is a constant in the core module that owns the condition.
- Notification buttons use Title Case. A button that opens a dialog or picker
  ends with `…`.
- Output channel lines can carry more detail than notifications: the command
  line, the version, the cause.

## Comments

- Every export has a doc comment that says what it does and what it
  guarantees: ordering, when it rejects, what it never does.
- Inline comments explain why: constraints, invariants, library quirks (with
  the library version). They don't repeat what the next line does.
- Don't write the source language version in comments. The toolchain's
  language policy owns it.
- Keep comments when you edit code, and update them when the behaviour
  changes.

## Formatting

Two-space indentation, no tabs, semicolons, single quotes, 120 columns at
most, LF line endings. When a call or signature doesn't fit, put one argument
or parameter per line.

## Tests

### Which layer tests what

Each behaviour has one owning layer. Another layer only tests it again for
what that layer alone can prove.

| Layer | Owns | Doesn't test |
| --- | --- | --- |
| `test/unit/` | vscode-free client logic, with fakes | the real editor or server |
| `test/lexical/` | static assets: grammar, language configuration, problem matcher, portability | the server |
| `test/server/` | that a server release meets the facts the client reads: launch arguments, a supported contract, shutdown, and the comments, strings and numbers of `editor-data lexicon` against the static grammar. When advertised, also built-in pages in `workspace/symbol` and module command result shapes (by compiling the server's own starter) | server behaviour and the language, which the toolchain's tests own. It holds no AA2M source |
| `test/e2e/` | what only VS Code can prove, done the way a user does it: activation, lifecycle, setup, download and the update notice, Restricted Mode, an old-contract server, commands, dialogs, notifications, the preview, completion middleware | server behaviour and the language. Sources come from the server (its starter), an empty module or `workspace/symbol` |

### Files and names

- A unit test file mirrors its module: `src/server/startFailure.ts` is tested
  in `test/unit/server/startFailure.test.ts`. A test of two modules together
  says so in its file name and first comment (`clientLifecycle.test.ts`).
- A test name is a sentence that states the behaviour: `a failed start is
  reported once and returned to the caller`.

### Fakes and fixtures

- Shared fakes live in a `fakes.ts` next to the tests that use them, or in
  `test/support/` when more than one suite needs them. Don't rebuild a fake
  inline in a test; pass overrides to the shared one.
- A fake that records calls is a class with named public fields for what it
  recorded. A fixture returns that fake, not a bag of arrays.
- Test data is synthetic. Only a test about a shipped file reads it
  (`package.json`, `language-configuration.json`, `syntaxes/`).

### Assertions and waiting

- Use `node:assert/strict`. Compare a whole value with `deepEqual` instead of
  checking its fields one by one. An assertion message says what should hold.
- Wait by polling a condition (`waitFor` in `test/support/wait.ts`). A fixed
  sleep is only allowed to prove that something doesn't happen, with a comment
  that says so.
- An e2e test that replaces a `vscode` API restores it in `finally`.
- Each e2e suite runs in its own VS Code instance (`SUITES` in
  `test/e2e/runTest.ts`). A suite never relies on another one's state.

## Enforcement

`npm run lint` runs ESLint. For `src/` it checks:

- indentation, tabs, semicolons, line length, `curly`, block bodies on their
  own lines (`@stylistic/brace-style`), one statement per line, no trailing
  spaces and no trailing commas;
- the folder import table in [Architecture](architecture.md#import-direction)
  and the `vscode` import boundary (`no-restricted-imports`);
- `'aa2m.…'` ID literals outside `src/shared/ids.ts`, conditional spreads,
  and module-level `let` outside `src/extension.ts` (`no-restricted-syntax`);
- nested ternaries (`no-nested-ternary`);
- one import declaration per module, with type-only imports marked `type`
  (`no-duplicate-imports`, `@typescript-eslint/consistent-type-imports`,
  `@typescript-eslint/no-import-type-side-effects`);
- function length (60 lines at most, not counting blanks and comments) and
  cyclomatic complexity (15 at most). These are ceilings, so aim for the
  targets above;
- unused variables, and the `typescript-eslint` recommended and stylistic
  sets.

Tests get the same checks, with a few exceptions. Module-level `let` is
allowed, since test files keep shared state. `'aa2m.…'` literals are allowed,
since tests check the contract strings. Complexity isn't limited, and the
length ceiling is 80 lines. The e2e suite files skip the length ceiling,
because a mocha `suite` callback holds all of its tests. Only the e2e suite may
import `vscode`.

`.editorconfig` and `.gitattributes` set whitespace and line endings. Review
covers every other rule on this page. When a rule gets a lint check, list it
here.
