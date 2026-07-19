---
description: Stop work now and set the GRU953-Studio project down cleanly, losing nothing.
argument-hint: (no arguments needed)
---

Stop the current project's work cleanly, following the `command-centre` skill.
Speak plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. Via `memory-keeper`, set the active task back to `todo` (never leave a
   half-finished task marked `done`), reflect that in the build plan
   (`Dev-Memory/PLAN.md`, or the inline list on Tiny Tier), checkpoint the
   memory files, refresh the `▶ RESUME HERE` pointer and
   `Dev-Memory/STATUS-BOARD.md`, and append a one-line note to `SESSION-LOG.md`.
   Never touch Publish or any push.
3. Give a short, calm report: what is finished so far, what was in progress
   (now safely set back to not-started), and that everything is saved. Make
   clear the difference from pausing: this ends the work session; they can
   start again any time with `/studio` or `/studio-resume`.
