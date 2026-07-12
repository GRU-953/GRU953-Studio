---
description: Give a plain-English progress report on the current GRU953-Studio project.
argument-hint: (no arguments needed)
---

Report the current project's progress in plain, simple UK English with no
technical jargon.

1. Look for `Dev-Memory/` in the current working directory. If it does not
   exist, tell the user kindly that no studio project has been started
   here yet, and that they can begin one by typing their idea between
   square brackets or running `/studio`.
2. If it exists, read `Dev-Memory/PROGRESS.md` (the task table — its Status
   column is the source of truth; the "▶ RESUME HERE" pointer is only a
   hint), the last few entries of `Dev-Memory/SESSION-LOG.md`, and
   `Dev-Memory/OBJECTIVE.md` (2026-07-12 fix: step 4 below asks for the
   Tier, which only `OBJECTIVE.md` records — the Tier's own log entry can
   scroll out of SESSION-LOG.md's tail on an older project, so it must not
   be the only source read for this).
3. Reply with a short, friendly report covering exactly four things:
   - **Done** — what is finished, described as things the app can now do.
   - **In progress** — what is being worked on right now, if anything.
   - **Next** — the very next step, worked out from the Status column (the
     first task that's "todo" or "doing" with all dependencies "done").
     Never a task marked "blocked".
   - **Blockers** — anything waiting on the user (a question, a sign-in),
     or "nothing is blocked" if all is clear.
4. Also state the project's current Tier (Tiny/Standard/Complex) in one
   clause.
5. Keep the whole report under ten short sentences. Explain any unavoidable
   technical term in one brief clause. Do not change any files.
