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
2. If not, does the platform's persistent memory (Claude Code) record first-run
   as done? If yes, also write the file marker now (so a future session finds it
   at step 1 without needing to check this), then skip to the project interview.
   (2026-08-27: this said "Claude Code or Google Antigravity". Antigravity was
   removed in 7.0.0 with the other host adapters.)
3. **If nobody is there to answer, SKIP onboarding entirely (2026-08-27).** Write
   `~/.gru953-studio/profile.md` recording that first-run was skipped because the
   session was unattended, with every setting at its documented default, and go
   straight to the build. Say so in the final report so the owner knows the
   onboarding is still owed.

   This branch did not exist, and it is step 0 of the lifecycle: an unattended
   first run on any machine without that marker met four blocking pop-up MCQs
   before a single line of the app was designed — the earliest possible stall,
   and the one place the product's own decision 1 mattered most.

   It survived six green end-to-end runs because the harness prompts the `studio`
   skill directly rather than through `/studio-start`, which is where the
   first-run check lives. That is the same blind spot that let the "auto-publish
   to GitHub" defect (X14/H1) live in `commands/studio-start.md` long after its
   reproduction was written: **nothing automated has ever exercised the
   documented entry point.**

4. Otherwise — a person is present — run the interactive onboarding now.

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
4. **Offer** to publish the demo — and publish it ONLY on a fresh, explicit
   yes. Follow the `publish-github` skill from its confirmation step onward: its
   own AskUserQuestion pop-up using the "permanent and irreversible" wording,
   then `gh repo create --private`, then push, tag and Release. Running
   `gh auth login` first is fine and is genuinely a first-run concern; creating a
   repository or pushing is not, and neither may happen before the answer.
   If the user declines, say so plainly and carry on to step 5 without it — a
   first run that publishes nothing is a complete first run.
5. Show the live repo URL **if it was published**; otherwise say where the demo
   lives on their own machine.

> **Corrected 2026-08-22 (finding X14).** Step 4 used to read "Auto-publish to
> user's GitHub (guided: …creates private repo, pushes, tags, creates Release…)".
> It contained no confirmation step and never named `publish-github`, so it
> instructed an autonomous push of a user's work to GitHub on their very first
> session — while three other shipped files forbid exactly that:
> `operating-charter/SKILL.md` says publishing needs "their own explicit, fresh
> 'yes' — every time"; `publish-github/SKILL.md` puts its pop-up BEFORE
> `gh repo create`; and that skill's own description says publishing is "never
> auto-invoked by Claude on its own initiative". It was reachable on the most
> ordinary path there is — `studio/SKILL.md` sends a new user here "before
> anything else" — and since X214 removed the token layer, nothing mechanical
> stops it either: the one wired `PreToolUse` hook returns no decision for
> `gh repo create`, `git push -u origin main` or `gh release create` on a clean
> tree. Documented autonomy plus no code gate is the whole finding.

### Phase 4: Celebration + Dashboard Tour

"🎉 Published at github.com/you/hello-world  — say this ONLY if step 4 actually
published. If the user declined, open with "Your Hello World is built and
working" and name the folder it is in. Never announce a repository that was not
created (X14).

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
