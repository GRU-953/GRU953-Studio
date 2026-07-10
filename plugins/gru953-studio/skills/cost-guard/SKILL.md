---
name: cost-guard
description: Session usage-limit planning plus the confirmed cheapest-first spending default for GRU953-Studio. Use before starting any stage, whenever a session feels long or heavy, whenever the user mentions "limits", "usage", "cost", "budget", or "ran out", and whenever deciding whether to start one more task or stop cleanly.
---

# Cost guard

## Confirmed spending default (2026-07-10): cheapest-first

Always lean towards the cheaper option and pause to check with the user
before any noticeably expensive step, even if that means more
interruptions. Concretely:

- Prefer a single sequential builder over a parallel Build Swarm unless the
  Tier and task genuinely benefit from parallel work.
- Prefer the architect's default vetted-menu stack over an off-menu choice
  unless there's a clear stated reason.
- Before a stage that could be notably expensive (a large research pass, a
  full Build Swarm, a long full-suite test run), show a plain-English
  estimate and the cheaper alternative, and let the user choose when the
  gap is meaningful.
- Dev-Memory is local-only (2026-07-10 audit correction, confirmed with the
  user): there is no GitHub mirror, so nothing needs batching to one.

## How usage can be judged locally

Claude Code writes each session's transcript as JSONL files (one JSON
record per line) under the user's `.claude` folder — for example
`~/.claude/projects/<project-folder>/<session-id>.jsonl`. A long, heavy
transcript file for the current session is a reasonable local signal that a
lot of the window has been used; exact numbers aren't visible, only this
rough signal.

## Planning rules

1. Before each stage: will it comfortably fit in the remainder of this
   session? If in doubt, split it at a task boundary and do the first part
   only.
2. Keep tasks small — many small tasks beat one large one.
3. Checkpoint at every stage boundary: update PROGRESS.md (with the
   "▶ RESUME HERE" pointer), append SESSION-LOG.md, grow INDEX.md — before
   starting the next stage, never after.
4. Once roughly 80-85% of the session's time window has elapsed since its
   first message, do not start a fresh task — finish or park what's in
   hand. Treat a very heavy transcript the same way.
5. Stop cleanly, never mid-task: finish or safely park the current step,
   write all memory files, then tell the user plainly: "GRU953-Studio has
   saved everything. To continue, open a new session and type /studio — it
   will pick up exactly where it stopped." Then stop.

## Honesty

A plugin cannot itself wait out a usage limit and restart on its own —
Claude Code is not running while the limit is in force. What GRU953-Studio
CAN guarantee is zero lost work: Dev-Memory always holds everything needed
to resume at the exact `▶ RESUME HERE` pointer.
