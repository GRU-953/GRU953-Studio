---
name: first-run
description: Use before a user's very first GRU953-Studio project — the one-off "getting to know you" setup that runs once, never on later projects. Includes interactive onboarding: welcome screen, guided setup, demo project build, and celebration. Confirmed 2026-07-10 as a separate step rather than folding it into the first project's own interview.
user-invocable: false
---

# First-run setup & Interactive Onboarding

## When this runs

Exactly once per user, before their first real project's Brainstorm stage.
Check in this fixed order, so behaviour never depends on which happens to
run first (2026-07-10 Round 4 fix — the earlier "whichever this surface
supports" wording had no deterministic order and risked first-run either
repeating or being wrongly skipped):

1. Does `~/.gru953-studio/profile.md` exist? If yes, first-run is done —
   skip straight to the project interview.
2. If not, does the platform's persistent memory (Claude Code or Google Antigravity)
   record first-run as done? If yes, also write the file marker now (so a
   future session finds it at step 1 without needing to check this), then
   skip to the project interview. (Updated 2026-07-26 for Google Antigravity support.)
3. Otherwise, first-run has never happened — run the interactive onboarding now.

## Interactive Onboarding Flow (2026-07-25)

The onboarding has FOUR phases, each with a clear purpose:

### Phase 1: Welcome Screen (30 seconds)

Show a warm, plain-English welcome:

> "Welcome to GRU953-Studio! I'll help you build working apps from your ideas — no coding needed. You'll answer a few questions, then we'll build a tiny demo app together and publish it to your GitHub. Ready? [Start Setup]"

### Phase 2: First-Run Setup (guided, 4 questions via pop-up MCQs)

1. **What to call them** — preferred name/handle for GRU953-Studio to use.
2. **Typical project types** — web apps, mobile apps, desktop tools, command-line tools, "not sure yet, decide per project" — informs (never restricts) the architect's stack-menu defaults.
3. **GitHub username confirmation** — confirm via `gh api user --jq '.login'`. If CLI isn't signed in (brand-new user likely has no GitHub account yet), offer recommended "I'll connect this later, when I publish" option and record as not-yet-set.
4. **Language preference** — UK English by default; Bangla on request.

### Phase 3: Guided Demo Project (Tiny, ~5 minutes)

"Let's build a 'Hello World' CLI together."

1. Auto-run simplified interview (project type: CLI tool, no data, no integrations → Tiny).
2. Auto-generate a tiny CLI script (prints greeting with user's name).
3. Auto-run smoke test (runs the script, checks output).
4. Auto-publish to user's GitHub (guided: runs `gh auth login` if needed, creates private repo, pushes, tags, creates Release with downloadable zip).
5. Show the live repo URL.

### Phase 4: Celebration + Dashboard Tour

"🎉 Published at github.com/you/hello-world

Here's your dashboard — it shows project status, tasks, and quality gates. Next: build your real idea."

## After first-run

0. **Offer the optional `statusLine` cost upgrade, once** (2026-07-26 — this
   step was already documented in `cost-guard`'s "How usage can be judged
   locally" section as something first-run offers, but never actually
   appeared in this file until now): if the user has no existing `statusLine`
   configured, offer to add a small script that both displays real cost/usage
   figures and writes them to `~/.gru953-studio/cost-snapshot.json` for
   `cost-monitor` to read. If the user already has their own `statusLine`,
   never overwrite it — show them the one line to add themselves instead, and
   leave their file untouched either way. See `cost-guard`'s own section for
   the exact mechanism; this file just owns the "when to offer" moment.
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
