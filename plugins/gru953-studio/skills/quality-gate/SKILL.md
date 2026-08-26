---
name: quality-gate
description: The gold-standard Definition of Done every project must meet before a phase is checkpoint-committed and before Publish. Defines Dev-Memory/QUALITY-GATE.md (the checklist of required quality dimensions — acceptance, tests, review, security/licence/privacy, accessibility, docs, reproducible build), the rule that a dimension may be marked not-applicable with a reason but never silently omitted, and the mechanical enforcement by hooks/quality-gate.mjs which blocks a checkpoint or Publish when the bar is unmet. Load and follow as a standing rule. Use at every phase boundary and before Publish.
---

# Quality Gate

## Why this exists

"Every task's test passed" is not the same as "this is ready to ship." A
project can have a green task table and still fall short of a professional bar:
no independent review recorded, no security or licence pass, accessibility never
considered on a user interface, documentation gone stale, a build nobody can
reproduce. This skill is the single, explicit **Definition of Done** — the fixed
set of quality dimensions that must each be satisfied, or consciously ruled
not-applicable, before work is backed up or released.

`verify-progress.mjs` already proves each `done` task carries `verified:`
evidence; this gate proves the *whole phase* clears the bar. Plain-English rule is exactly as set in the
`operating-charter` skill.

## The Definition of Done (the required dimensions)

Recorded in `Dev-Memory/QUALITY-GATE.md` for the current phase, each dimension
marked **pass** (with concrete evidence) or **n/a** (with a stated reason —
never blank):

| Dimension | Means | Owned by |
| :-- | :-- | :-- |
| **Acceptance criteria** | Every criterion for this phase is proven, not asserted. | tester |
| **Tests** | The relevant tests run and pass, with the exact command as evidence. | tester |
| **Independent code review** | Someone who did not write the code reviewed it; no open findings remain. | reviewer (Standard+; on Tiny the tester's checks stand in — mark n/a with that reason) |
| **Security / licence / privacy** | Secrets/vulnerability/licence scans are clean; any personal-data handling is minimal, retained and consented properly. | security-compliance-auditor |
| **Accessibility** | A user interface meets the agreed access bar (WCAG 2.2 AA or the platform equivalent); n/a with reason if there is no UI. | accessibility-specialist |
| **Documentation** | The built app's user-facing docs match what was actually built; no stale statement. | technical-writer / reviewer |
| **Reproducible build** | The app builds/runs from a clean checkout with the recorded steps — not just "works on this machine". | devops-engineer / builder |

The file is a plain table:

| Item | Status | Evidence |
| :-- | :-- | :-- |
| Acceptance criteria | pass | all 4 criteria proven — see PROGRESS.md |
| Automated tests | pass | `npm test` → exit 0 (2026-07-19) |
| Independent code review | pass | reviewer sign-off, 0 open findings |
| Security / licence / privacy | pass | scan clean; licence-scan clean; no personal data |
| Accessibility | n/a | command-line tool — no user interface |
| Documentation | pass | README updated for this phase |
| Reproducible build | pass | `make build` → exit 0 on a fresh clone |

## `Dev-Memory/dod.json` — the file you actually write

`QUALITY-GATE.md` is **generated**. What a project author writes is `dod.json`:
the commands that PROVE each dimension. `hooks/dod.mjs` runs them, records the
real exit codes under `Dev-Memory/evidence/`, and renders the table from that.

This contract is written down here because until 2026-08-27 it was written down
nowhere: `dod.mjs` required a schema version, twelve exact dimension keys, and
different fields for measured and judged dimensions, and no skill, agent or
command said so. Anyone writing the file was guessing at a format a gate would
reject, which is a headless run stopping on a question nobody could answer.

```json
{
  "schemaVersion": 1,
  "dimensions": {
    "build":        { "command": ["npm", "run", "build"] },
    "tests":        { "command": ["npm", "test"] },
    "coverage":     { "command": ["npm", "run", "coverage"],
                      "minPercent": 80,
                      "reportPath": "coverage/coverage-summary.json" },
    "lint":         { "command": ["npm", "run", "lint"] },
    "types":        { "command": ["npm", "run", "typecheck"] },
    "security":     { "command": ["npm", "run", "security-check"] },
    "dependencies": { "command": ["npm", "audit", "--audit-level=high"] },
    "runs":         { "command": ["node", "scripts/journey.mjs"] },
    "accessibility":{ "notApplicable": "command-line tool — no user interface" },
    "performance":  { "command": ["node", "scripts/perf-budget.mjs"] },
    "review":       { "verdict": "pass", "artefact": "commit 9c1f0a2", "by": "reviewer" },
    "docs":         { "verdict": "pass", "artefact": "README.md", "by": "technical-writer" }
  }
}
```

**All twelve keys must be present.** A dimension may be given a command or
marked `notApplicable`; the one thing it may never be is absent, because a
quietly skipped check is indistinguishable from a passing one.

**The ten EXECUTED dimensions** — `build`, `tests`, `coverage`, `lint`,
`types`, `security`, `dependencies`, `runs`, `accessibility`, `performance`:

- `command` is an **argv array**, never a string. A string would have to be
  handed to a shell, and this gate never does that: the difference between
  `["npm","test"]` and a string is the difference between running the test
  suite and running whatever else is in the string.
- `cwd` (optional) must stay inside the project. `"../.."` would run the parent
  repository's suite and record it as this project's.
- `timeoutMs` (optional) bounds the run; the default is used otherwise.
- A program that cannot measure anything is refused — `["true"]` used to satisfy
  all ten.

**`coverage` additionally needs a number**, because a coverage tool exits 0 at
4% as happily as at 95%:

- `minPercent` — the floor, at least **60**. A floor of 0 is refused outright:
  at 0% the dimension cannot fail, so it is not a check. Below 60 needs
  `floorBelowProductMinimumBecause` stating why, so the exception is a recorded
  decision rather than a quiet number.
- `reportPath` — the coverage tool's own machine-readable report. The
  percentage is read from that file, never scraped from prose on stdout.

**The two JUDGED dimensions** — `review` and `docs` — are kept separate and
labelled as judgements, because no machine measures them:

- `verdict` must be exactly `"pass"`.
- `artefact` must name what was judged: a commit SHA, a diff hash, a file path.
  A judgement bound to nothing becomes a permanent tick nobody re-earns.
- `by` (optional) records who or what judged it.

**`notApplicable`** takes a real reason, and the reason has to be true: `tests`
marked n/a in a project that has a test suite is refused, and so are `build`,
`lint`, `types`, `coverage` and `dependencies` where the tree plainly
contradicts the claim.

**Never edit `Dev-Memory/evidence/` or `QUALITY-GATE.md` by hand.**
`hooks/config-protection.mjs` refuses it, through an edit tool or the shell, and
`quality-gate.mjs` cross-checks every row against the evidence that produced it.

## The one rule that makes it gold-standard: no silent omission

A dimension may be marked **n/a with a reason** — but it may never be simply
left out. `hooks/quality-gate.mjs` holds the required list itself, so deleting
the "Security" row does not make the gate pass; it makes it **BLOCK** with a
message naming the missing dimension by its full label (2026-07-26 correction:
this used to quote the message as literally "missing required dimension:
security" — the code actually emits `missing required dimension: security /
licence / privacy clean — no row in QUALITY-GATE.md covers it...`, the
dimension's full label, not its short key; corrected to describe it rather
than misquote it). This is deliberate: the single easiest
way to ship below the bar is to quietly skip the check that would have caught
it, and this closes that path mechanically.

## When it is enforced (and that it blocks)

- **Before every checkpoint commit** (the per-phase backup) and **before
  Publish**, `quality-gate.mjs` must report clean. If it BLOCKS, the phase is
  not backed up or released until the gap is closed — this is fail-closed, on
  purpose (a false "clean" is worse than a false block; nobody re-checks a green
  result before shipping).
- On a tree with no `Dev-Memory/` (e.g. a non-studio directory) the check is a
  no-op — there is nothing to gate.

The Project Lead never relays a raw BLOCK message to the user; it translates the
gap into one plain sentence about what still needs doing and what happens next
(the same rule the Stuck Protocol already uses).

## Tier-scaling (YAGNI still applies)

The dimensions are fixed; their DEPTH scales with Tier, and Tiny projects will
legitimately mark several as n/a-with-reason (no separate reviewer, no UI, no
personal data). That is the point — a small script consciously records "n/a: no
UI" rather than the team silently never thinking about access. The gate asks
that every dimension was *considered*, matched to the project's real size, not
that a one-off utility carries enterprise ceremony.

## Who applies this

- **security-compliance-auditor** runs `quality-gate.mjs` (alongside its
  existing secret/licence/progress checks) at each checkpoint and before
  Publish, and is the blocking owner of the security dimension.
- **tester**, **reviewer**, **accessibility-specialist**, **technical-writer**
  and **devops-engineer** each own their dimension's evidence.
- **memory-keeper** writes `Dev-Memory/dod.json` — the commands that PROVE each
  dimension — and never `QUALITY-GATE.md` itself. That file is generated by
  `hooks/dod.mjs` from the exit codes it recorded, and is overwritten on every
  run.

  (2026-08-27: this line used to read "memory-keeper writes `QUALITY-GATE.md`
  from their evidence". That is exactly the arrangement v7 removed — the graded
  agents composing their own report card — and it survived here while
  `dev-memory` and `studio` had both been rewritten to say the opposite. One
  instruction contradicting two is how the hand-written table kept coming
  back.)
- **project-lead** will not authorise a checkpoint commit or Publish while the
  gate is BLOCKED.
