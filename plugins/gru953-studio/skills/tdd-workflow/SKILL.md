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

## Structured Evidence Format (2026-07-25 audit fix)

All task verification evidence is now recorded in a **machine-parseable JSON
format** embedded in the PROGRESS.md table's Notes column, replacing the old
free-text `verified:` format. This enables CI dashboards, historical trend
analysis, and automated audit trails.

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
| `durationMs` | integer | Yes | Wall-clock duration in milliseconds |
| `artifacts` | string[] | No | Paths to generated artifacts (reports, coverage, etc.) |
| `timestamp` | string | Yes | ISO 8601 UTC timestamp |
| `verifier` | string | Yes | Role that produced the evidence ("tester", "builder", etc.) |

### Verification

The `verify-progress.mjs` hook (PreToolUse) parses this JSON and accepts it as
valid evidence alongside the legacy `verified:` format. Both formats are
supported for backward compatibility during migration.

### Migration

- Tiny Tier: Use the JSON format for the single smoke test per task
- Standard/Complex Tier: Use JSON format for all TDD and regression evidence
- Legacy `verified:` format still accepted but new evidence should use JSON
