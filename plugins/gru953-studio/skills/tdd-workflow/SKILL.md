---
name: tdd-workflow
description: On Standard/Complex Tier only, the protocol that makes each Build task test-FIRST rather than test-after — a failing test must exist and genuinely fail before the Builder writes implementation code. Use whenever `tester` or `builder` is working a Build-stage task on Standard or Complex Tier.
---

# Test-first workflow (Standard/Complex Tier)

## Why this exists

A 2026-07-16 research pass into the wider Claude Code ecosystem found a
genuine gap: GRU953-Studio's existing Build cycle writes tests *after* the
code (`builder` implements, then hands off; `tester` proves it afterwards).
That is correct and sufficient for Tiny Tier's small, one-off scripts, but
for Standard/Complex Tier — where more is already at stake and more rigour
already applies elsewhere — the same idea an existing FOSS tool called
"TDD Guard" enforces (a test written and failing *before* implementation
exists) is worth having natively. This skill is a GRU953-Studio-original
protocol inspired by that idea, not a use of that project's code.

## Tier scope

**Standard and Complex Tier only.** Tiny Tier keeps its existing "does it
run, does the one core flow work" basic-checks approach (`tester.md`) —
adding a strict test-first requirement to a single one-off script would be
friction with no matching benefit, the same reasoning `yagni-rules` already
applies elsewhere.

## The protocol, per Build task

1. **Before any implementation code is written**, `tester` writes one
   small, targeted test that captures the task's specific acceptance
   criterion — not the full test plan (that still happens later, exactly
   as `tester.md` already describes), just the one test this task needs.
2. **`tester` runs it and confirms it genuinely fails** for the right
   reason (the feature doesn't exist yet) — a test that passes before any
   code exists proves nothing and must be rewritten before the Builder
   starts.
3. **`builder` receives the task together with this failing test** and
   implements the smallest working diff that makes it pass — `builder`
   must not write implementation code for this task before the failing
   test exists.
4. **`builder` runs the test itself as part of its own verification step**
   (`builder.md` Method, step 4) — the task is only handed to the reviewer
   once this specific test passes, in addition to whatever else the
   verification command already checks.
5. **Everything else stays exactly as already described**: `tester`'s
   broader test-plan and regression pass still happens after the reviewer,
   `reviewer` still does its own correctness/YAGNI pass, and the full
   regression suite still runs once before Publish. This skill adds one
   earlier checkpoint per task — it does not replace any existing step.

## Who applies this

- **tester** writes and confirms the failing test before the builder
  starts (Standard/Complex Tier Build tasks only).
- **builder** must not implement before that test exists, and must make it
  pass as part of its normal verification step.
- **reviewer** may treat "was there a genuinely failing test before this
  diff existed?" as one more correctness check, the same way it already
  checks the verification command's own output.

## What this does not do

- Does not apply to Tiny Tier, or to work outside the Build stage.
- Does not require a full test suite before every task — one targeted
  test per task's own acceptance criterion, not exhaustive coverage.
- Does not change who writes the *broader* test plan or runs the final
  regression pass — `tester` still owns both, exactly as `tester.md`
  already describes.
