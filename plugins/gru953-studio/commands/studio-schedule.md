---
description: Schedule a GRU953-Studio task to resume later, at a time you choose.
argument-hint: a time or delay, e.g. "tomorrow 9am" or "in 2 hours"
---

Schedule work to resume later, following the `command-centre` skill. Speak
plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. Read the requested time from `$ARGUMENTS`. If it is missing or unclear, ask
   the user for a specific time or delay before doing anything else.
3. Record the intent durably FIRST, so it can never be lost: via
   `memory-keeper`, set the target task's Status to `scheduled` with the chosen
   time noted in `PROGRESS.md`, reflect the scheduled state and time in the
   build plan (`Dev-Memory/PLAN.md`, or the inline list on Tiny Tier), refresh
   `Dev-Memory/STATUS-BOARD.md`, and append a one-line note to `SESSION-LOG.md`.
4. Then arm whatever scheduling capability THIS session offers (a scheduled
   task, a wake-up, or a cron-style trigger the host exposes) to re-enter the
   project at that time and run `/studio-resume`. If the session offers no such
   capability, say so honestly: the time is saved and the studio will resume the
   moment they return at or after it — do not promise an automatic wake-up the
   environment cannot deliver.
5. A scheduled resume runs the normal re-orientation read and never
   auto-publishes. Confirm in one or two sentences: what is scheduled, for when,
   and how it will resume.
