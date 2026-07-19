---
description: Pause the current GRU953-Studio task so you can safely stop and come back later.
argument-hint: (no arguments needed)
---

Pause the current project's active work, following the `command-centre` skill.
Speak plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. If it exists, find the active task (the `doing` row, or the first eligible
   `todo`). Via `memory-keeper`, set its Status to `paused`, refresh the
   `▶ RESUME HERE` pointer to point back at it, and refresh
   `Dev-Memory/STATUS-BOARD.md`. Append a one-line note to `SESSION-LOG.md`.
   Do not mark anything `done`, and never touch Publish or any push.
3. Confirm in one or two sentences: what was paused, that nothing is lost, and
   that they can pick up exactly here with `/studio-resume` whenever they like —
   even in a brand-new session days later.
