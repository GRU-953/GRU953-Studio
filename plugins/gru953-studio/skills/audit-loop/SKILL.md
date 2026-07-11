---
name: audit-loop
description: The systematic, planned protocol for any review/fix/verify loop — plans every round's coverage upfront, targets convergence within 5 rounds, and always re-verifies the immediately-previous round's specific fixes with the same lens configuration that found them alongside a fresh panel exploring new ground. Use whenever the user asks for an audit, a review loop, to "keep going until clean/golden", or whenever reviewer/security-compliance-auditor need more than one pass to reach confidence. Distilled from GRU953-Studio's own 2026-07-11 audit-fix loop, where reactive, unplanned rounds took far longer to converge than planning would have.
---

# Audit Loop

Reactive auditing — start with one or two obvious lenses, add a new one
each time a round finds something a prior lens didn't think to check — is
slow and open-ended. This protocol front-loads the planning instead: decide
the full set of things worth checking BEFORE Round 1, so most of them are
covered in parallel from the start, not discovered one at a time.

## Step 0 — Plan before Round 1 (mandatory, do this first)

Write a short plan (in `Dev-Memory/decisions/` for a project, or wherever
this loop's findings are being tracked) covering:

1. **The full set of risk dimensions relevant to what's being audited.**
   Draw from this standing menu — not exhaustive, but a strong starting
   point so real categories aren't missed:
   - Mechanical/security (injection, unsafe defaults, unsafe obfuscation of
     whatever this system's own safety checks match against)
   - Role/responsibility overlap, gaps, or dangling references between
     components
   - Lifecycle/user-journey coherence (does the whole flow still make
     sense end to end, not just each piece in isolation)
   - Brand/governance/documentation consistency (do the docs describe what
     the code actually does, right now, not what it used to do)
   - Non-technical-user comprehension, if the audience includes one
   - Agent-manipulation / social-engineering (can content the system reads
     — not a live user — manipulate an AI acting on it into an unsafe
     action; distinct from a text-matching bypass)
   - Cross-file self-consistency (do independent files that describe the
     same fact agree with each other)
   - Test/gate coverage gaps (is there a real mechanical check behind every
     "must" rule, or is it prose-only)
2. **A bounded round budget.** Target 5 rounds or fewer. Assign the
   dimensions above across those rounds — most dimensions covered by Round
   2 or 3, not discovered ad hoc round by round.
3. **Which independent perspectives run each round.** Each round dispatches
   a genuinely fresh panel (parallel, independent reviewers, each told
   explicitly to assume nothing from a prior round is guaranteed correct).
   Never reuse the exact same lens twice in a row for *new* coverage — see
   Step 2 for the one deliberate exception.

## Step 1 — Each round: a fresh panel, verified by execution

Dispatch the round's assigned lenses in parallel. Each reviewer must:
- Read the real, current files/code — never assume a prior round's fix is
  still correct just because a prior round touched it.
- Verify by EXECUTION wherever the claim is checkable that way (run the
  code, don't just reason about what a regex would probably do) — reading
  alone missed real bugs in this project's own history that a five-minute
  script caught immediately.
- Report a clear PASS/FAIL with a concrete, reproducible finding for
  anything real — never manufacture a finding to look thorough, and never
  skip a real one to look clean.

## Step 2 — Also each round (from Round 2 onward): re-verify the last fix

Alongside the fresh panel, run ONE additional check using the SAME lens
configuration as the most recent round that found a real issue — attacking
the exact area just fixed, specifically trying to break the fix itself.
This is the one deliberate exception to "never reuse a lens": confirming a
fix holds is different work from finding new ground, and this project's own
history shows a fix can be real progress while still being incomplete (a
later pass on the *same* area found a bypass in a fix the *previous* round
had just shipped, more than once).

## Step 3 — Verify every finding directly before fixing

Never fix something because a report said so. Reproduce it first — a
throwaway script, a direct run of the real code, whatever proves the claim
— then fix, then prove the fix with the same reproduction. This applies
doubly to anything a background reviewer agent reports: if that agent was
cut off mid-task by a rate limit or any other interruption before
delivering a final verdict, its last message is NOT a verdict, however
conclusive it sounds — check the completion status, not just the text, and
never count an interrupted round as clean. Recover any concrete lead it
mentioned before being cut off and run it down directly rather than
discarding it.

## Step 4 — Re-run the full mechanical gate suite before closing the round

Whatever this system's own automated checks are (tests, consistency
checks, licence/dependency scans, whatever applies), run all of them again
after every fix, on the actual tree that will ship — not just the working
copy — before considering the round done.

## Step 5 — Convergence and re-planning

Stop once 2 CONSECUTIVE rounds find zero real issues. If the planned
round budget (Step 0.2) runs out without reaching that, do not keep
spawning open-ended extra rounds one at a time — instead, pause and
re-plan: run one short "what's still uncovered" reflection (a completeness
check across the dimension menu in Step 0.1), and if it surfaces a genuine
gap, set a new, small, bounded batch of rounds for it rather than drifting
into indefinite reactive auditing again.

## Output

A short, plain-English summary after every round: what was checked, what
was found (or that nothing was), what was fixed and how it was verified,
and — once true convergence is reached — a clear statement that the 2
consecutive-clean-rounds bar is met and this loop is done.
