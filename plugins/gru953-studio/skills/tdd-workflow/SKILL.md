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
already applies elsewhere — the same idea an existing free, open-source
(FOSS) tool called "TDD Guard" enforces — TDD (Test-Driven Development): a
test written and failing *before* implementation exists — is worth having
natively. This skill is a GRU953-Studio-original protocol inspired by that
idea, not a use of that project's code.

## Tier scope

**The test-FIRST protocol below is Standard and Complex Tier only** (2026-07-26:
this scoping applies to the test-first protocol specifically — the
"Structured Evidence Format" section further down is a separate, broader
convention for how evidence is recorded in `PROGRESS.md`, and does apply on
Tiny Tier too; see its own Migration note). Tiny Tier keeps its existing
"does it run, does the one core flow work" basic-checks approach
(`tester.md`) — adding a strict test-first requirement to a single one-off
script would be friction with no matching benefit, the same reasoning
`yagni-rules` applies to unrequested process ceremony generally.

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
   (`builder.md` Method, step 5 — 2026-07-26 correction: previously cited
   step 4, which is the "implement the diff" step, not the "run the
   verification command" step; `builder.md` gained/reordered a step at some
   point and this citation was never updated) — the task is only handed to
   the reviewer once this specific test passes, in addition to whatever
   else the verification command already checks.
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

## Structured Evidence Format (2026-07-25 audit fix)

Task verification evidence may now also be recorded in a **machine-parseable
JSON format** embedded in the PROGRESS.md table's Notes column, as an
alternative to the plain free-text `verified:` format (2026-07-26 correction:
this section previously said the JSON format "replac[es]" the free-text one —
`hooks/verify-progress.mjs` itself accepts both, so nothing is actually being
replaced; corrected to match what the hook really checks). Using JSON enables
CI dashboards, historical trend analysis, and automated audit trails, where
the plain form doesn't.

### JSON Evidence Schema

```json
{
  "taskId": "T3",
  "criterion": "User can reset password via email",
  "command": "pytest tests/test_auth.py::test_password_reset -v --json-report",
  "exitCode": 0,
  "stdout": "1 passed in 1.24s",
  "stderr": "",
  "durationMs": 1240,
  "artifacts": ["coverage.xml", "report.html"],
  "timestamp": "2026-07-25T10:30:00Z",
  "verifier": "tester"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `taskId` | string | Yes | Task ID from PROGRESS.md (e.g., "T3") |
| `criterion` | string | Yes | The acceptance criterion being verified |
| `command` | string | Yes | Exact command run to verify |
| `exitCode` | integer | Yes | Process exit code (0 = success) |
| `stdout` | string | Yes | Command stdout (truncated if large) |
| `stderr` | string | Yes | Command stderr |
| `durationMs` | integer | Yes\* | Wall-clock duration in milliseconds |
| `artifacts` | string[] | No | Paths to generated artifacts (reports, coverage, etc.) |
| `timestamp` | string | Yes\* | ISO 8601 UTC timestamp |
| `verifier` | string | Yes\* | Role that produced the evidence ("tester", "builder", etc.) |

\* **Written discipline, not mechanically enforced** (2026-07-26 correction —
matching the same honest framing already used for the other three schemas in
`dev-memory`'s "Schema Validation" section): `verify-progress.mjs`'s actual
check only requires `taskId`, `criterion`, `command`, `exitCode`, `stdout` to
be present, in that literal order — `stderr`, `durationMs`, `timestamp`, and
`verifier` are not verified by the code even though they're written by
`tester`/`builder` as a matter of practice. Record all nine; only the first
five are what the hook actually checks.

### Verification

`hooks/verify-progress.mjs` checks for this shape — an order-dependent
pattern match on the five fields above, not a full JSON parse (2026-07-26
correction: this said "parses this JSON," which overstated it; a real JSON
object with the same fields in a different order or key-quoting style would
not match) — and accepts it as valid evidence alongside the legacy `verified:`
format. This is a **manual pre-Publish check, not a `PreToolUse` hook**
(2026-07-26 correction: this section previously mislabelled it "(PreToolUse)"
— `hooks/hooks.json`'s `PreToolUse` array wires only `scan.mjs`, since
`gate.mjs` was removed on 2026-08-16 by finding X214;
`verify-progress.mjs`'s own header states it is deliberately not
wired there, because whether a task's evidence is well-formed "cannot be
judged reliably from a single Bash call," and it is instead run manually
before Publish — see `publish-github`, which already
described this correctly). Both evidence formats are supported, matching the
"alternative, not a replacement" correction above.

### Migration

- Tiny Tier: Use the JSON format for the single smoke test per task
- Standard/Complex Tier: Use JSON format for all TDD and regression evidence
- Legacy `verified:` format still accepted but new evidence should use JSON
