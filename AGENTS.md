# Agent guide

This is the VS Code extension for AAUnlimited modules (`.aa2m`) and libraries
(`.aa2mi`). It's a thin client: a TypeScript client, a language configuration
and a grammar that colors comments, strings and numbers. Everything else,
keyword and name colors included, comes from the `aa2modulus lsp-server`
executable over stdio. That server lives in the separate
[toolchain](#toolchain) repository.

The extension has to build, test and package without the toolchain.

## Commands

| Command | Needs | Checks | Run it for |
| --- | --- | --- | --- |
| `npm test` | nothing | compile, unit tests, grammar, language configuration, problem matcher, portability | every change |
| `npm run lint` | nothing | ESLint, see [Enforcement](docs/code-style.md#enforcement) | every change |
| `mise run check` | mise | both of the above | |
| `npm run test:server` | a server | that a server release still has the facts the client reads | server boundary or grammar changes |
| `VSCODE_EXECUTABLE_PATH=<code> npm run test:e2e [-- <suite>...]` | VS Code, a server, a display | the extension in a real editor, one VS Code instance per suite | lifecycle, dependency or editor-facing changes |

- Every test command compiles first, and every compile deletes `out/`. Don't
  run two at once, or while another agent runs one.
- The e2e hosts are portable VS Code builds in the git-ignored
  `.vscode-test/vscode-linux-x64-<version>/VSCode-linux-x64/code`. Use the
  newest one. Run the `engines.vscode` floor as well only when
  `engines.vscode`, `@types/vscode` or vscode-languageclient changes.
  `@types/vscode` is pinned at the floor, so the compiler already rejects
  newer APIs.
- [Toolchain](#toolchain) shows how to give `test:server` and e2e a server.
- Theme colors need a visual check by the user. You can't verify them.
- Report the exact commands you ran and their results. Never say a check
  passed if it didn't run.

## Where to look

| You want to know | Read |
| --- | --- |
| How the folders connect, core versus adapters, import direction, who owns a flow | [docs/architecture.md](docs/architecture.md) |
| How code and tests are written, which test layer owns a behaviour | [docs/code-style.md](docs/code-style.md) |
| What the client sends to and expects from the server, launch and lifecycle rules | [docs/server-contract.md](docs/server-contract.md) |
| User-facing behaviour and settings | [README.md](README.md) |
| Languages, commands, settings, workspace trust, npm scripts | `package.json` |
| Current state, known limits, ranked gaps, past decisions | `agent_data/`, see [Records](#records) |

A few things the file tree doesn't tell you:

- Only `src/extension.ts` and the `src/**/vscode*.ts` adapters import
  `vscode`. New logic goes in vscode-free core modules so unit tests can run
  it with fakes.
- `src/shared/ids.ts` holds every ID that `package.json` declares.
- `tsconfig.build.json` compiles only `src/` for shipping. `tsconfig.json`
  adds the tests.
- `test/unit/` mirrors `src/` and keeps shared fakes in each folder's
  `fakes.ts`. `test/lexical/` checks the shipped static files.
  `test/server/smoke.ts` checks a server against the client contract, and CI
  runs it against the newest toolchain release. `test/e2e/` drives real VS
  Code, and `runTest.ts` lists each suite's server, trust and workspace.
  `test/support/` holds the shared helpers (`waitFor`, the manifest reader,
  the `AA2M_SERVER_*` reader).

## What wins when things disagree

Code and focused tests come first, then the README and `docs/`. If a doc is
wrong, fix it. `agent_data/` is orientation, not authority, so check what it
says against the code before you rely on it.

The server side of the boundary belongs to the toolchain's `docs/lsp.md`
(*Client contract*). If it disagrees with `docs/server-contract.md`, the
toolchain's current code wins and `docs/server-contract.md` is the one to fix.

## Rules

### Always

- Keep the [launch and lifecycle rules](docs/server-contract.md#launch)
  unless the task is about changing them.
- Move contracts together. A change to settings, commands or the server
  boundary updates `package.json`, the README, `docs/server-contract.md` and
  the tests in the same task.
- Update `docs/architecture.md` in the same task when you move a flow, add a
  folder or change an import rule.
- Write new and changed code by [docs/code-style.md](docs/code-style.md),
  including the rules lint can't check. Fix older code only in a refactor
  task. If a rule gets in the way of clean code, raise it with the user
  instead of working around it.
- Touch only what the task needs. Leave unrelated edits and untracked files
  alone, and never restore or clean up work you don't recognise.
- Run `npm test` and `npm run lint` before you finish.

### Only when the user asks

- Install, upgrade or remove packages, or rewrite `package-lock.json`.
- Package a VSIX, publish, commit, push, or create branches, issues or pull
  requests.
- Contact external services.
- Edit the toolchain checkout. Its own `AGENTS.md` applies to those edits.

### Never

- Depend on anything outside this repository at build, test or run time: no
  toolchain packages, sibling checkouts, Python or server builds.
  `test/lexical/portability.test.ts` fails on links that leave the repository
  and on machine-specific absolute paths.
- Re-implement server semantics in the client. Parsing, binding, diagnostics,
  imports and module operations belong to the server. Add the capability in
  the toolchain first, then update `docs/server-contract.md` here.
- Ship data exported from the toolchain (lexicon, catalog, snippets) or
  grammar rules beyond comments, strings and numbers. Keywords, types,
  operators and names come from the server's semantic tokens.
- Write the source language version in docs, comments or plans. Only the
  toolchain's policy file holds it, and it has been reset before.
- Link to `agent_data/` from tracked files. A fresh clone doesn't have it.

## Toolchain

[AA2Depot/AA2Modulus](https://github.com/AA2Depot/AA2Modulus) holds the
language and the server. Tag builds publish `aa2modulus-linux-x64.zip` and
`aa2modulus-windows-x64.zip` on its releases page.

- Don't guess where a local checkout is. Ask the user for its absolute path.
  The commands below call it `$TOOLCHAIN`. Use it in the shell only, never in
  tracked files.
- Before you plan a change that needs the server, read the toolchain's
  `AGENTS.md` and `agent_data/ROADMAP.md`. Plan and log the server side
  there. Here, record only the client side and name the toolchain plan.
- To run checks against a source checkout, from this repository's root:

  ```bash
  AA2M_SERVER_COMMAND="$TOOLCHAIN/.venv/bin/python" \
  AA2M_SERVER_ARGS='["-m","aa2modulus","lsp-server"]' \
  AA2M_SERVER_CWD="$TOOLCHAIN" PYTHONPATH="$TOOLCHAIN" \
  npm run test:server
  ```

  A standalone build (`mise run build` in the toolchain, or a release zip)
  only needs `AA2M_SERVER_COMMAND`. The e2e suite reads the same variables.
- After a toolchain change to `docs/lsp.md` or `aa2modulus/lsp/`, check for
  contract drift. Every toolchain anchor that `docs/server-contract.md` links
  must still exist
  (`grep -o 'AA2Modulus/blob/[^)]*' docs/server-contract.md`), and launch,
  initialization, handshake and command shapes must still hold. Link server
  facts, don't copy them.
- To validate a file with the CLI:
  `"$TOOLCHAIN/.venv/bin/python" -m aa2modulus validate <file> --diagnostic-format short`.
  The other subcommands are `inspect`, `compile`, `decompile` and
  `lsp-server`.

## Records

Agent records live in `agent_data/`, which git ignores. Use it to learn what
earlier agents did, why, and where they stopped. Don't keep agent records
anywhere else.

It uses the same layout as the toolchain's, so the same habits work in both.
On a fresh clone it's missing. Create it like this:

```
agent_data/
  README.md          what this directory is and how to use it
  ROADMAP.md         the single status page: current state, known limits, ranked gaps
  WORK_LOG.md        one entry per task, append-only
  plans/
    README.md        how plans work
    TEMPLATE.md      the template for a new plan
    active/          plans in progress, indexed by active/README.md
  archive/
    README.md        index of finished plans, newest first
    <year>/          finished, cancelled or superseded plans
```

Start with an empty work log and a short roadmap of only what you can confirm
from the code. The plan template starts with a Status / Created / Updated
table, followed by these sections: Goal and scope, Decisions and constraints,
Work, Acceptance criteria, Verification, Risks and follow-ups, Handover,
Decision log and Completion.

### Starting a task

1. Run `git status --short` and diff the files you plan to edit.
2. Read `agent_data/ROADMAP.md`, then `agent_data/plans/active/README.md`. If
   a plan matches your task, pick it up from its Handover section.
3. Read the last few work log entries (`tail -n 40 agent_data/WORK_LOG.md`).
   Never read the log or the archive whole. `grep` them when you need the
   reason behind an earlier decision.
4. Read only the files your task touches.

### While you work and when you stop

- Every task gets a plan in `agent_data/plans/active/`, made from the template
  before you start. `agent_data/plans/README.md` has the details. A routine
  small edit only needs a work log entry. Routine means a few lines in one or
  two files, with no design choice and nothing to hand over.
- Keep the plan's Handover section current whenever you stop. Another agent
  should be able to pick the task up from it alone.
- Add one work log entry per task at the end of `agent_data/WORK_LOG.md`, 15
  lines or fewer, linking the plan. Never edit earlier entries.

  ```
  ## YYYY-MM-DD — <short title>
  - Outcome:
  - Files:
  - Checks: <exact commands and results>; not run: <...>
  - Decisions:
  - Follow-ups:
  ```

- When a plan ends, record its outcome, move it to
  `agent_data/archive/<year>/`, add it to `agent_data/archive/README.md` and
  remove its active row.
- `agent_data/ROADMAP.md` is the only status page. Update it when a
  capability, limit or gap changes. Don't repeat status in the README or
  `docs/`.
- Finish with a short summary: what changed, which checks ran and what's
  still limited.

## Sub-agents

Give each sub-agent its own files, with no overlap. The orchestrating agent
owns the plan, the roadmap, the work log, `package.json` and its lock file,
and the final checks. It verifies each sub-agent's claims before accepting
them. Read-only audits can run in parallel and write their reports outside
the repository. Don't delegate routine reading.
