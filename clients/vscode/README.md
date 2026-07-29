# GRU953-Studio for VS Code

A thin bridge that adds a **Universal Agentic Studio: Status** command to
VS Code (and any VS Code-compatible editor, such as Cursor or Windsurf),
so you can check a GRU953-Studio project's progress without leaving the
editor.

## What it does

Running the command opens (or reuses) an integrated terminal and runs the
CLI's own `status` command directly, e.g.:

```
node <path-to-repo>/clients/cli/src/index.js status
```

(`<path-to-repo>` is resolved automatically, relative to this extension's own
installed files — there is currently no published `npx`-installable package
to run instead; see `clients/cli/package.json`.) This reports whether the
current folder is a GRU953-Studio project and, if so, the real task counts
from its `Dev-Memory/PROGRESS.md`.

This only works when the extension is running from inside a full
GRU953-Studio checkout (e.g. cloned for development) — a normal, packaged
install of this extension ships no sibling `clients/cli/` folder to run, so
`<path-to-repo>` cannot resolve to anything there. In that case the command
shows a plain error explaining this, rather than running a command that
crashes the terminal.

This extension has no other behaviour — it does not read, write, or index
your files itself. See the main [GRU953-Studio README](../../README.md)
for what the studio itself does.

## Licence

See [LICENSE](LICENSE) — PolyForm Noncommercial License 1.0.0, the same
licence as the rest of GRU953-Studio.
