---
description: Skip the current GRU953-Studio task for now and move on to the next one, without losing it.
argument-hint: (optionally, the task to skip — otherwise the current one)
disable-model-invocation: true
---

Skip the current task and move to the next, following the `command-centre`
skill. Speak plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. Identify the task to skip — the one named in `$ARGUMENTS` if given, else the
   current active task. If skipping it would strand another task that depends on
   it, say so plainly and ask the user to confirm before proceeding.
3. Via `memory-keeper`, set that task's state to `skipped` (recorded, never
   deleted — it resurfaces later), mark it skipped in the build plan
   (`Dev-Memory/PLAN.md`, or the inline list on Tiny Tier) so the plan shows it
   set aside rather than active, then run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/task-ledger.mjs" .
   ```

   to re-render `PROGRESS.md` and get the next eligible task from its `next`
   field — it already excludes the blocked and set-aside states, so nothing here
   needs to restate that rule. Refresh `Dev-Memory/STATUS-BOARD.md`, and append
   a one-line note to `SESSION-LOG.md`.
4. Confirm in one or two sentences: what was skipped (and that it is kept for
   later), and what the studio will work on next.
