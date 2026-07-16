---
name: self-healing
description: Two related but distinct uses — (a) when a verification command fails during Build/Test, `fixer` gets a bounded, quiet attempt to diagnose and fix it before the Project Lead's Stuck Protocol is invoked, so small bugs don't always need a full user-facing escalation; (b) an app GRU953-Studio builds can get standard, proportionate self-recovery (auto-restart on crash, retry-with-backoff on transient failures, always logged) as part of `devops-engineer`'s reliability work. Never touches Publish or any push-capable action — every fix still needs the same explicit confirmation as always. Use whenever a verification command fails during Build/Test, and whenever `devops-engineer` sets up a live service's failure posture.
---

# Self-healing

## Why this exists, and what it deliberately doesn't change

User-requested 2026-07-17: make GRU953-Studio "self-heal" when a bug
arises while building, and give apps it builds their own resilience. Two
different problems sharing one name — this skill covers both, each scoped
to what already exists rather than inventing something new.

**Confirmed directly with the user before building this: self-healing
never auto-publishes.** Every fix — however it was found — still needs
the same explicit "yes" before anything reaches GitHub that every other
GRU953-Studio publish action has always required, no exceptions. This
skill only ever touches local Build/Test/Fix work, never the Publish gate.

## (a) GRU953-Studio's own build-time self-healing

1. **When a verification command fails** during Build or Test (`builder`'s
   own check, or `tester`'s run) — before declaring the task stuck and
   invoking the Project Lead's full Stuck Protocol — hand it to `fixer`
   for up to **2 quiet attempts**, following `fixer`'s own existing Method
   (reproduce the exact failure, find the root cause, apply the smallest
   diff, re-verify). No user interruption yet at this stage.
   **Before starting the second attempt, `fixer` reverts the first
   attempt's own changes first** (`git diff`/`git checkout -- <files>` on
   exactly the files it touched, or `git stash` if untracked files are
   involved) so the second attempt starts clean rather than building on
   top of whatever the first attempt left behind. Deliberately NOT Claude
   Code's own `/rewind` checkpoint feature — that's an interactive menu a
   human opens (`Esc` twice), not something a subagent can invoke on its
   own, the same restriction that already applies to `AskUserQuestion`;
   `fixer` already has `Bash`/`Edit`, so a plain `git` revert needs no new
   tool grant.
2. **Quiet does not mean hidden.** Log each attempt to
   `Dev-Memory/SESSION-LOG.md` as it happens, not after the fact —
   self-healing avoids interrupting flow for something small and
   quickly resolved, it is never quiet about *what* happened.
3. **A hard ceiling: 2 quiet attempts, then escalate.** If the same
   failure is still present after 2 attempts, stop self-healing and
   invoke the full Stuck Protocol exactly as already defined — tell the
   user what currently works, what's blocking, and the options. The
   ceiling exists so a genuinely hard problem doesn't quietly loop forever
   chewing through time and cost; 2 is deliberately small, matching
   `cost-guard`'s cheapest-first default.
4. **A bug self-healed twice on the same project is worth recording** —
   log it to `Dev-Memory/LESSONS.md` (per the `dev-memory` skill) so it
   isn't quietly hit a third time.

## (b) Self-recovery for a built app (`devops-engineer`'s remit — Standard/Complex Tier, live/long-lived services only)

Not for a one-off script or static page — nothing runs continuously there
to recover (the same Tier/service-type gate `devops-engineer`'s reliability
work already uses).

1. **Crash recovery:** configure the app's own hosting/process manager to
   restart automatically on a crash. Most hosting platforms already do
   this natively — check for and enable that, rather than writing a
   custom supervisor (`yagni-rules`).
2. **Transient-failure retry:** for a call to another service (a database,
   an external API) that can fail transiently, retry with a short backoff
   before giving up — bounded (2-3 attempts), never an unbounded loop.
3. **Always log every auto-recovery event** (a restart, a retry) at the
   point it happens — never a silent recovery the app's own owner can't
   see in their own logs.

## Who applies this

- **fixer** performs the bounded quiet attempts for (a), using its own
  existing Method unchanged.
- **builder** and **tester** hand a verification failure to `fixer` for
  up to 2 quiet attempts before invoking the full Stuck Protocol.
- **devops-engineer** builds (b) as part of its existing reliability work.
- **project-lead** still runs the Stuck Protocol exactly as before once
  the quiet-attempt ceiling is reached — nothing about that escalation
  path changes.

## What this does not do

- Does not skip the Stuck Protocol — only delays it by up to 2 quiet
  attempts, for the current task's own failure, not a systemic or
  genuinely blocking problem.
- Does not touch Publish or any push-capable action, ever — confirmed
  directly with the user (2026-07-17): every fix still needs the same
  explicit "yes" before anything reaches GitHub.
- Does not build a custom process-supervisor or elaborate auto-healing
  infrastructure into a built app — uses the hosting platform's own
  standard restart behaviour where available (`yagni-rules`).
