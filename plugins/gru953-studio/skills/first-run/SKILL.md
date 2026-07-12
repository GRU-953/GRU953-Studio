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
3. **GitHub username confirmation** (2026-07-12 fix: was "handle," unexplained
   jargon for a non-technical user — the README itself says "username"/"your
   GitHub account") — confirm via `gh api user --jq '.login'` rather than
   asking blind. If the CLI isn't signed in (a brand-new user very likely
   has no GitHub account yet — the README defers this to publish time),
   don't block first-run on it: offer a recommended "I'll connect this
   later, when I publish" option and record it as not-yet-set, rather than
   asking the user to answer something they may not have yet.
4. **Language preference** — UK English by default; Bangla on request, per
   the user's existing README.bn.md convention.

## After first-run

1. Hand the four answers to `memory-keeper`, which records them in
   `~/.gru953-studio/profile.md` — a durable location outside any single
   project, since this applies across all future projects (2026-07-11
   Round 10 audit fix: earlier wording never named who actually performs
   this write; `project-lead`, the obvious default, deliberately has no
   `Write` tool, so it structurally couldn't have been the one doing it —
   `memory-keeper` already owns this file going forward, so it writes the
   seed too). This is the same file `memory-keeper` goes on to grow
   throughout every later project with real working-style preferences
   learned from actual sessions, not just these four one-off answers — see
   the `dev-memory` skill's "Cross-project memory" section. First-run seeds
   the initial version; it is never recreated or overwritten wholesale
   after that, only added to.
2. Tell the user, in one or two lines, that this is done and won't be asked
   again, then move straight into their actual project's Brainstorm
   interview — no extra ceremony.
