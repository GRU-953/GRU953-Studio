# GRU953-Studio for VS Code

A thin bridge that adds a **Universal Agentic Studio: Status** command to
VS Code (and any VS Code-compatible editor, such as Cursor or Windsurf),
so you can check a GRU953-Studio project's progress without leaving the
editor.

## What it does

Running the command opens (or reuses) an integrated terminal and runs:

```
npx @gru953/studio-cli status
```

which reports whether the current folder is a GRU953-Studio project and,
if so, the real task counts from its `Dev-Memory/PROGRESS.md`.

This extension has no other behaviour — it does not read, write, or index
your files itself. See the main [GRU953-Studio README](../../README.md)
for what the studio itself does.

## Licence

See [LICENSE](LICENSE) — PolyForm Noncommercial License 1.0.0, the same
licence as the rest of GRU953-Studio.
