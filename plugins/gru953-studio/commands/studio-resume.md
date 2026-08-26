---
description: Resume a paused or scheduled GRU953-Studio task and carry on where you left off.
argument-hint: (no arguments needed)
disable-model-invocation: true
---

Resume the current project's work, following the `command-centre` skill.
Speak plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. First run the `focus-guard` re-orientation ritual — read `FOCUS.md`,
   `OBJECTIVE.md`, `PROGRESS.md`, the tail of `SESSION-LOG.md` and `INDEX.md`,
   and restate the single active goal in one plain line — so you pick the
   thread back up from memory, not guesswork.
3. Find the `paused` (or due `scheduled`) task. Via `memory-keeper`, set its
   state back to `in-progress` in `Dev-Memory/tasks.json`, re-render
   `PROGRESS.md` by running:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/task-ledger.mjs" .
   ```

   then refresh `Dev-Memory/STATUS-BOARD.md` and append a one-line note to
   `SESSION-LOG.md`.

   (2026-08-27: this said `doing`, which `task-ledger.mjs` REFUSES — the
   accepted states are `todo`, `in-progress`, `done`, `blocked-on-defect`,
   `blocked-on-human`, `paused`, `skipped`, `scheduled`. So following this
   command wrote a ledger the next gate blocked on, and the whole pause/resume
   cycle dead-ended at the step meant to undo the pause.)
4. Tell the user in one or two sentences where things stood and what happens
   next, then continue the work. Never auto-publish on resume.
