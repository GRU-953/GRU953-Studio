---
description: Give a plain-English progress report on the current GRU953-Studio project.
argument-hint: (no arguments needed)
disable-model-invocation: true
---

Report the current project's progress in plain, simple UK English with no
technical jargon.

1. Look for `Dev-Memory/` in the current working directory. If it does not
   exist, tell the user kindly that no studio project has been started
   here yet, and that they can begin one by typing their idea between
   square brackets or running `/studio-start`.
2. If it exists, ask the ledger for the state rather than reading the rendered
   table and interpreting it:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/task-ledger.mjs" .
   ```

   Its output gives the counts per state and the `next` task. Exit 2 means
   nothing is runnable, which is itself the answer to "what's next". Then read
   `Dev-Memory/PROGRESS.md` for the human-readable table (generated from
   `tasks.json`, which is the source of truth), the last few entries of
   `Dev-Memory/SESSION-LOG.md`, and
   `Dev-Memory/OBJECTIVE.md` (2026-07-12 fix: step 4 below asks for the
   Tier, which only `OBJECTIVE.md` records — the Tier's own log entry can
   scroll out of SESSION-LOG.md's tail on an older project, so it must not
   be the only source read for this).
3. Open with one plain line on **what the app is** (the concept, from
   `OBJECTIVE.md`), then cover exactly four things:
   - **Done** — what is finished, described as things the app can now do.
   - **In progress** — what is being worked on right now, if anything.
   - **Next** — the very next step: the `next` task the ledger reported. If it
     reported none, say plainly what is in the way rather than picking
     something.
   - **Blockers** — anything waiting on the user (a question, a sign-in),
     or "nothing is blocked" if all is clear.
4. Also state the project's current Tier (Tiny/Standard/Complex) in one
   clause, and mention that the full architecture and specifications, plus
   the build plan so far (current phase's tasks; later phases show only
   their one-line summary — 2026-07-26 correction: this used to say "full...
   build plan"), are available at a glance via `/studio-dashboard` (which
   renders them into a single self-contained page).
5. Keep the whole report under ten short sentences. Explain any unavoidable
   technical term in one brief clause. Do not change any files.
