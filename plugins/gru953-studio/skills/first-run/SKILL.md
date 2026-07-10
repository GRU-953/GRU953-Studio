---
name: first-run
description: The one-off "getting to know you" setup that runs once, before a user's very first GRU953-Studio project — never on later projects. Confirmed 2026-07-10 as a separate step rather than folding it into the first project's own interview.
---

# First-run setup

## When this runs

Exactly once per user, before their first real project's Brainstorm stage.
Check in this fixed order, so behaviour never depends on which happens to
run first (2026-07-10 Round 4 fix — the earlier "whichever this surface
supports" wording had no deterministic order and risked first-run either
repeating or being wrongly skipped):

1. Does `~/.gru953-studio/profile.md` exist? If yes, first-run is done —
   skip straight to the project interview.
2. If not, does the assistant's own persistent memory (on surfaces that
   have one) record first-run as done? If yes, also write the file marker
   now (so future sessions on any surface find it at step 1), then skip to
   the project interview.
3. Otherwise, first-run has never happened — run it now.

## What to ask (via `interviewer`, pop-up MCQs, recommended option marked)

Keep this short — three or four questions at most:

1. **What to call them** — a preferred name/handle for GRU953-Studio to use
   in conversation.
2. **Typical project types** — e.g. web apps, mobile apps, desktop tools,
   command-line tools, "not sure yet, decide per project" — this informs
   (but never restricts) the architect's stack-menu defaults later.
3. **GitHub handle confirmation** — confirm via `gh api user --jq '.login'`
   rather than asking blind; only ask the user if the CLI isn't signed in.
4. **Language preference** — UK English by default; Bangla on request, per
   the user's existing README.bn.md convention.

## After first-run

1. Record the answers in a durable memory location (not per-project
   Dev-Memory, since this applies across all future projects) — a small
   `~/.gru953-studio/profile.md`-style file, or the assistant's own memory
   system if the surface provides one.
2. Tell the user, in one or two lines, that this is done and won't be asked
   again, then move straight into their actual project's Brainstorm
   interview — no extra ceremony.
