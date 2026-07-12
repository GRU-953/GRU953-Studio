---
description: Start a new GRU953-Studio project from an idea, or resume the existing one from Dev-Memory.
argument-hint: "[your app idea in plain words]"
---

Invoke the `studio` skill (the GRU953-Studio coordinator) and follow its
pipeline exactly.

- If arguments were given, treat them as the user's rough app idea:

  IDEA: $ARGUMENTS

- First check whether the assistant's own memory shows the first-run setup
  is done; if not, run the `first-run` skill before anything else.
- Then check for a `Dev-Memory/` folder in the current working directory.
  If it exists, this is a RESUME: read the task table in
  `Dev-Memory/PROGRESS.md`, the tail of `Dev-Memory/SESSION-LOG.md`, and
  `Dev-Memory/INDEX.md`, then continue per the studio skill's Step 2 — the next task is the first one
  whose Status is "todo" or "doing" and whose dependencies are all "done".
  A task marked "blocked" is never picked as next until a human unblocks
  it. The "▶ RESUME HERE" line is a human-friendly hint; the Status column
  is the source of truth. Do not restart stages or tasks already done.
- If no `Dev-Memory/` folder exists and no idea was given, ask the user in
  one friendly plain-English sentence to describe their app idea (remind
  them they can type it between square brackets).
- Speak plain, simple UK English throughout, exactly as the studio skill
  instructs.
