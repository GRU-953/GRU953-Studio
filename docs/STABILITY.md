# What will not change in 7.0.x

GRU953-Studio 7.0.0 is a long-term-support release. This file is the promise that
makes that word mean something: it states exactly what you may rely on, and what you
may not.

Written 2026-08-26, for the 7.0.x line.

## The promise, in one paragraph

**`7.0.x` receives bug fixes and security fixes only.** No new features, no changed
behaviour, nothing removed. If you build something on 7.0.0 and later install 7.0.4,
the studio should behave the same way, except that something which was broken now
works. New features go to a `7.1` line, which you choose to move to rather than
receive by accident.

## What you may rely on

These are the things a fix release will not alter. If one of them has to change, that
is a `7.1` at least — not a patch.

| You may rely on                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                            |
| :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The file names and locations under `Dev-Memory/`**               | `run-brief.json`, `tasks.json`, `dod.json`, `evidence/`, and the generated `OBJECTIVE.md`, `PROGRESS.md` and `QUALITY-GATE.md` stay where they are, with the meanings they have.                                                                                                                                                                                                   |
| **`schemaVersion: 1` for each of those files**                     | A 7.0.x release will never require you to rewrite one. If a field is ever added it will be optional, and its absence will keep meaning what it means today.                                                                                                                                                                                                                        |
| **The exit codes**                                                 | `0` clean, `1` blocked or invalid, `2` "valid, and it needs attention" (`task-ledger.mjs`, `stall-check.mjs`) or "could not measure" (`tools/e2e/headless-build.mjs`). Scripts and scheduled jobs may branch on these.                                                                                                                                                             |
| **The task states**                                                | `todo`, `in-progress`, `done`, `blocked-on-defect`, `blocked-on-human`. No state will be removed or renamed.                                                                                                                                                                                                                                                                       |
| **The gate commands and their names**                              | The commands in `CLAUDE.md` keep working, from the same paths.                                                                                                                                                                                                                                                                                                                     |
| **That nothing is published for you**                              | A run finishes with a committed local project and stops. No 7.0.x release will add automatic pushing, repository creation, or going public.                                                                                                                                                                                                                                        |
| **That no hook contains a network client**                         | None of the 24 hooks calls `fetch`, or imports `http`, `https`, `net` or `dns`. No 7.0.x release will change that, and `docs-consistency.mjs` now checks it on every commit rather than leaving it as a claim in a comment. It is deliberately narrower than "the plugin makes no network call", which this row used to say and which was not true — see the note under the table. |
| **That the plugin ships no external model or service integration** | It reads no API key, holds no credential, and talks to no model provider. 7.0.0 removed the last of them.                                                                                                                                                                                                                                                                          |

| **Zero third-party runtime dependencies** | The plugin ships only Node's standard library. |
| **Apache-2.0** | The licence will not become more restrictive on this line. |

**Where network access does happen, stated plainly.** Three roles — `researcher`,
`ai-developer` and the `ecosystem-finder` skill — are instructed to use **the
host's own web search** when a build turns on a current external fact (a model
name, a library's present API, whether a tool already exists). That is your
session's tool, using your session's access; the plugin supplies no credentials
and receives nothing back that it stores. Separately, the dependency tooling
`hooks/licence-scan.mjs` invokes (`pip-licenses`,
`cargo metadata`, `dart pub deps`) may contact a package registry to resolve a lockfile, exactly as it
would if you ran it yourself.

**A measured security property (2026-08-27).** A hook's `ask` decision is honoured in a headless
run, and **`--permission-mode bypassPermissions` does not bypass it**: the tool call does not
execute, the hook's reason comes back to the model as the failure, and the session continues.
Measured against the CLI directly under three flag sets, with the instrument proven to bite first
— see the note on `escalate()` in `plugins/gru953-studio/hooks/lib.mjs` for the method. This is
stated as a measurement, not a promise: it is behaviour of the Claude Code CLI, which this project
does not control and therefore cannot guarantee across future CLI versions.

## What is explicitly NOT promised

Being honest about the edges is what makes the list above worth anything.

- **The wording of any message.** Error text, block reasons and plain-English
  explanations will be improved. Do not match on them; branch on exit codes.
- **The roster.** Which specialists exist, and their number, may change on a `7.1`.
  A project records its own baseline, so it is told rather than surprised.
- **The internal shape of any hook.** These are programs to run, not modules to
  import. Nothing here is a published API.
- **Anything under `Dev-Memory/evidence/`** beyond its presence and the fact that each
  file records a real command and its real exit code. Extra diagnostic fields may
  appear.
- **The withdrawn hosts.** Cursor, Windsurf, Cline, Roo Code, Aider, GitHub Copilot,
  Devin, Replit, OpenHands and Google Antigravity are not supported, and a 7.0.x
  release will not bring them back. Neither will the Ollama, OpenRouter or Gemini
  integrations.

## Toolchain floor

**Node.js 22 or newer**, declared as `engines` in the published package. That is the
version CI tests. Node 20 reached end of life on 2026-04-30 and is not supported.
Node 26 becomes LTS on 2026-10-28; it will be added to the tested matrix then rather
than assumed to work before it.

A newer Node is expected to work and is not tested on this line. If a future Node
release breaks the studio, that is a bug fix and belongs on 7.0.x.

## How a fix reaches you

Fixes land on `7.0.x` as patch releases. Each carries a changelog entry saying what
was broken, how it was reproduced, and which test now covers it — the discipline the
rest of `CHANGELOG.md` already follows.

Security reports go through [SECURITY.md](../SECURITY.md), which also carries the
supported-versions table.

## When this line ends

No end date is promised, because promising one you cannot keep is worse than not
promising. What is promised: `7.0.x` will not be abandoned silently. When it stops
receiving fixes, that will be stated in `SECURITY.md`'s supported-versions table and
in a final changelog entry, before it happens rather than after.
