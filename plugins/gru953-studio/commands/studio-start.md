---
description: Start a new GRU953-Studio project from an idea, or resume the existing one from Dev-Memory.
argument-hint: "[your app idea in plain words]"
---

Invoke the `studio` skill (the GRU953-Studio coordinator) and follow its
pipeline exactly.

- If arguments were given, treat them as the user's rough app idea:

  IDEA: $ARGUMENTS

- First, check whether the user has completed first-run onboarding.
  If not, run the `first-run` skill which includes:
  1. Welcome screen (30 seconds)
  2. Guided first-run setup (4 questions via pop-up MCQs)
  3. Guided demo project: build a Tiny "Hello World" CLI and auto-test it.
     It is NOT published: publishing is a separate, explicitly-asked-for step,
     always. (2026-08-27: this line used to say "auto-publish to GitHub" — the
     X14 defect, alive in the shipped entry point long after the reproduction
     for it was written, because that reproduction never read this file.)
  4. Celebration + dashboard tour
  Then move into their actual project.

- Then check for a `Dev-Memory/` folder in the current working directory.
  If it exists, this is a RESUME. Ask the ledger what to do next rather than
  reading the rendered table and working it out:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/hooks/task-ledger.mjs" .
  ```

  Exit 0 means the ledger is valid; its `next` field names the task to pick up,
  already resolved for dependencies and state. Exit 2 means the ledger is valid
  but nothing is runnable — report why (it names the blocked and set-aside rows)
  and stop; do not invent work. Exit 1 means the ledger itself is broken — fix
  that first, because every later step depends on it.

  (2026-08-27: this step used to say "the next task is the first one whose Status
  is todo or doing" — asking you to re-derive, from a GENERATED file, a decision
  the ledger already makes. Two implementations of one rule disagree eventually,
  and one of them was prose. `doing` was also not a state `task-ledger.mjs`
  accepts, so following this literally produced a ledger the next gate refused.)

  Then read `Dev-Memory/FOCUS.md`, `Dev-Memory/OBJECTIVE.md`, the tail of
  `Dev-Memory/SESSION-LOG.md` and `Dev-Memory/INDEX.md` for context (2026-07-26
  correction: this used to list only three of these five files while still citing
  "the studio skill's Step 2" as the authority — Step 2 itself requires all
  five), then continue per the studio skill's Step 2. `Dev-Memory/tasks.json` is
  the source of truth; `PROGRESS.md` and its "▶ RESUME HERE" line are rendered
  from it, for people. Do not restart stages or tasks already done.
- If no `Dev-Memory/` folder exists and no idea was given, ask the user in
  one friendly plain-English sentence to describe their app idea (remind
  them they can type it between square brackets).
- Speak plain, simple UK English throughout, exactly as the studio skill
  instructs.
