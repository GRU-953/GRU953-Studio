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
3. **A hard ceiling: 2 quiet attempts, then park — and only then escalate.** If
   the same failure is still present after 2 attempts, stop self-healing.
   **Unattended, park the task as `blocked-on-defect` — recording `blockedReason`,
   which `task-ledger.mjs` REQUIRES and without which the whole ledger is invalid — and
   take the next runnable
   task (2026-08-27)** — `Dev-Memory/tasks.json` records the attempts and
   `hooks/task-ledger.mjs` enforces the ceiling as data rather than as this
   agent's memory.

   **INCREMENT `attempts` on the task in `Dev-Memory/tasks.json` before each retry
   (added 2026-08-28).** Nothing said to, so the field stayed absent, the ceiling
   never fired, and the counting fell back to the memory of the agent being asked to
   keep trying — which is the one party that should not hold the counter, and exactly
   what moving it into data was for. A task with no `attempts` has no ceiling. The full Stuck Protocol is for when the ledger reports nothing
   runnable at all (its exit 2). With a person present, invoke the full Stuck
   Protocol exactly as already defined — tell the
   user what currently works, what's blocking, and the options. The
   ceiling exists so a genuinely hard problem doesn't quietly loop forever
   chewing through time and cost; 2 is deliberately small, matching
   `cost-guard`'s cheapest-first default.
4. **A bug self-healed twice on the same project is worth recording** —
   log it to `Dev-Memory/LESSONS.md` (per the `dev-memory` skill) so it
   isn't quietly hit a third time.
5. **Repeat-failure detector (anti-thrashing)** (2026-07-19, Phase 0
   guardrail spine). The 2-attempt ceiling bounds a SINGLE failure; this bounds
   a RECURRING one. If the same task reaches the self-heal ceiling and escalates
   more than once across the build — it keeps coming back after being "fixed" —
   stop treating it as a small local bug. That is a systemic signal: surface it
   to the user through the full Stuck Protocol as a pattern ("this task has now
   failed and been re-fixed N times — something underneath it is wrong"), not as
   another quiet round, and log the pattern to `Dev-Memory/LESSONS.md`. A
   guardrail against the classic derailment where a team burns a whole session
   re-fixing the same thing without ever stepping back.

6. **Is the run still working, or silently wedged?** (2026-08-27.) At each task
   boundary — and always before concluding a task is merely slow — run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/stall-check.mjs" .
   ```

   Exit 0 means the run looks healthy or has finished cleanly. **Exit 2 means it
   appears wedged**: treat that exactly as a self-heal ceiling breach and invoke
   the Stuck Protocol, naming what the check reported. Exit 1 means it could not
   determine — no transcript, or nothing in it this gate understands — which is
   not the same as healthy and must not be reported as such.

   *Why this step exists.* Everything above bounds a failure that ANNOUNCES
   itself: a command exits non-zero and the fix loop starts. Nothing bounded a
   run that stops making progress without failing — the case an unattended build
   is uniquely exposed to, because there is no person watching to notice. The
   detector for it shipped in v7 and, until this step was written, was invoked by
   nothing in the product: not by a skill, an agent, a command or any CLI path.

   The check's suppression rule is the reason it is worth running rather than
   eyeballing: an unanswered tool call is only reported if no later activity
   follows it, so an ordinary slow call does not trip it. A watchdog that cries
   wolf is a watchdog somebody turns off, and its silence then means nothing.

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
- **project-lead** runs the Stuck Protocol when the LEDGER reports nothing
  runnable at all (`task-ledger.mjs` exit 2) — not when a single task reaches its
  quiet-attempt ceiling. **Corrected 2026-08-28:** this said "still runs the Stuck
  Protocol exactly as before once the quiet-attempt ceiling is reached — nothing
  about that escalation path changes", which is the pre-fix behaviour step 3 above
  was rewritten on 2026-08-27 to remove. One task exhausting its attempts parks as
  `blocked-on-defect` and the run continues with anything whose dependencies are
  satisfied; the Protocol is for when there is genuinely nothing left to do. Step 3
  was fixed and these two summary sections were left describing the old rule, in the
  same file.

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
