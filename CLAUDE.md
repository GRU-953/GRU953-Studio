# GRU953-Studio

This repository IS the GRU953-Studio Claude Code plugin. If you are Claude
working in this repository, load `plugins/gru953-studio/skills/studio/SKILL.md`
for how the coordinator behaves, and treat every file under
`plugins/gru953-studio/` as the product itself — changes here affect every
user who installs the plugin, not a single project.

When GRU953-Studio is installed and used to build a DIFFERENT project (e.g.
Obhijatra), that project gets its own `Dev-Memory/` and its own `CLAUDE.md`
in its own working directory — this file only governs work on GRU953-Studio
itself.

## Picking this up mid-flight? Read HANDOVER.md first

[HANDOVER.md](HANDOVER.md) is the current state of the 7.0.0 LTS release: what is green,
the one thing blocking a verified release, what only the owner can do, and the facts that
cost a day each to find. Written 2026-08-28 on branch `v7-lts-rebuild`. Read it before
starting work on the release; this file governs how to work on the repo, that one says
where the work currently stands.

## Before committing changes to this repo

Run the same gates CI runs, and keep them all green:

```
for f in plugins/gru953-studio/hooks/*.mjs; do node --check "$f"; done
node plugins/gru953-studio/hooks/hooks.test.mjs
node plugins/gru953-studio/hooks/repo-integrity.mjs .
node plugins/gru953-studio/hooks/roster-check.mjs plugins/gru953-studio .
node plugins/gru953-studio/hooks/licence-scan.mjs .
node plugins/gru953-studio/hooks/docs-consistency.mjs .
node plugins/gru953-studio/hooks/charter-check.mjs .
npm run lint
npm run format:check
```

(2026-08-22, X178: `npm run lint` and `npm run format:check` were missing from this
block although CI runs both — so a contributor following these instructions would
not have run the two steps that were, at the time X178 was raised, the failing
ones. Both pass now; the omission was that nothing here told you to check.)

**If `repo-integrity.mjs` reports INV18, you have DELETED a file from
`plugins/gru953-studio/` without rebundling.** Run this and re-run the gate; it
takes a fifth of a second and loses nothing, because the directory it rebuilds
is build output:

```
cd clients/cli && node scripts/bundle-plugin.mjs
```

INV18 (added 2026-08-17, finding X220) guards `clients/cli/plugin/` — the copy
`npm pack` ships, so the copy an installing user receives. It had gone two days
stale still carrying five hooks that had been deleted, and twice in one day that
stale copy was mistaken for the truth: once answering "does this hook exist?"
for another check, once being what a live session's hook actually ran.

**It deliberately does NOT complain about ordinary staleness.** Editing a hook
leaves the copy out of date, and that is the state you are in every time you
touch one — a gate that fired then would interrupt normal work constantly and
end up switched off, and `prepack` runs the bundler anyway, so drifted content
is regenerated before anything is published. Only a file the copy carries that
source no longer has will fail it, because editing cannot produce that: deleting
without rebundling can, and that is deleted code still shipping. A checkout with
no packaged copy at all reports nothing, so a fresh clone needs none of this.

`repo-integrity.mjs` is the guard that stops a file referencing a skill,
hook, or role count that doesn't actually exist — if you add or rename any
agent, skill, or hook, run it before you commit. Adding a specialist role
means updating `plugins/gru953-studio/ROSTER.md` (the committed baseline)
with the named gap it fills. `docs-consistency.mjs` (added 2026-07-26 audit
stage 5) is the sibling check that catches a STALE claim rather than a
missing reference — a count repeated in two places that disagree, a
companion skill or marketplace tag listed twice, a specialist named in
prose that exists nowhere on the real roster. `charter-check.mjs` (added
2026-08-10 with the operating charter) is the third sibling in that family:
the owner's standing working rules necessarily exist in TWO copies — the
canonical `skills/operating-charter/SKILL.md` for Claude hosts, and
`universal-init.js`'s `CHARTER_FILE` template for every host that cannot load
a Claude skill — and this gate compares them clause by clause so the two can
never quietly say different things.

**`actionlint` is worth running locally on any workflow change, and is deliberately NOT in
CI (decided 2026-08-28).** Nothing validates the workflow files themselves — YAML structure,
`uses:` references, job dependencies, GitHub expression syntax — and that gap is real: a
stray `"` in `e2e.yml` made a whole `run:` block invalid bash and the nightly failed on every
run for a day, unnoticed. It is not wired into CI because every other `uses:` in
`.github/workflows/` is pinned to a full-length SHA, and adding it means either a mutable
`docker://rhysd/actionlint:TAG` — the only unpinned reference in the repository, in a job
that runs on every push — or a digest that has to be looked up online. Shipping an LTS whose
one supply-chain exception was added for a convenience is the wrong trade. To wire it up
later, resolve the image digest and pin it the way the other five are pinned.

Half of what it would have caught is already covered: the test suite's `workflows:` tests
parse every `run:` script in every workflow with `bash -n`, in all four YAML scalar forms and
on a CRLF tree. Run actionlint by hand when you touch a workflow:

```
actionlint -shellcheck= .github/workflows/*.yml
```

(`-shellcheck=` sets the shellcheck executable to nothing, which is how actionlint is told to
skip a pass the suite already does.)

The gates above are the ones CI itself runs and are mandatory on every commit —
**nine steps**: the syntax check, the suite, `repo-integrity`, `roster-check`,
`licence-scan`, `docs-consistency`, `charter-check`, `npm run lint` and
`npm run format:check`. (Counted 2026-08-27: this said "seven", which predated
lint and format:check being added to the block, and `publish.yml` had copied the
same stale number. A count restated in prose is the commonest stale claim in this
repository, which is what `docs-consistency.mjs` exists for.) A GRU953-Studio project's own `Dev-Memory/` additionally carries eight
project-level gates (no-ops on this repo, since it has no `Dev-Memory/` of its
own) that a project built _by_ the plugin must pass before a phase checkpoint
or Publish — run these too whenever you touch the skill/hook that documents
them, so the documented requirement and the enforcing script never drift apart:

```
node plugins/gru953-studio/hooks/run-brief.mjs .            # is the brief complete enough to build from unattended? (v7)
node plugins/gru953-studio/hooks/dod.mjs .                 # RUNS the Definition of Done and records the evidence (v7)
node plugins/gru953-studio/hooks/task-ledger.mjs .         # validates Dev-Memory/tasks.json, renders PROGRESS.md, says whether the run can continue (v7)
node plugins/gru953-studio/hooks/verify-progress.mjs .     # done tasks carry verified: evidence (tester / security-compliance-auditor)
node plugins/gru953-studio/hooks/quality-gate.mjs .        # Definition of Done (quality-gate skill)
node plugins/gru953-studio/hooks/traceability-check.mjs .  # requirements <-> tasks (focus-guard skill)
node plugins/gru953-studio/hooks/memory-integrity.mjs .    # recall index/graph consistency (memory-graph skill)
node plugins/gru953-studio/hooks/content-check.mjs .       # content approval/provenance/rights (content-creation skill)
```

**`dod.mjs` and `quality-gate.mjs` are not duplicates, and the order above is
the order to run them in (2026-08-26, v7 Phase 2).** `quality-gate.mjs` reads
`Dev-Memory/QUALITY-GATE.md` and proves no required dimension is MISSING from the
record. It never runs anything — neither it nor `verify-progress.mjs` imports
`child_process` at all, and the only `exec` in either is a regex `.exec()`. So the
table it grades was written by the agents being graded. With a human at the
keyboard that is defensible, because a person notices when the app does not work.
With nobody watching it is a loop that always closes green.

`dod.mjs` closes that: it EXECUTES each dimension — build, tests, coverage against
a stated numeric floor, lint, types, security, dependency audit, a real user
journey, accessibility, performance budgets — records each real exit code and
output under `Dev-Memory/evidence/`, and then REGENERATES `QUALITY-GATE.md` from
that evidence. So `quality-gate.mjs` still does its job, but on a table written
from measurements rather than from claims. Two dimensions no machine can measure
(independent review, documentation) are kept explicitly separate as _judged_, and
each must name the artefact it judged, so a verdict is bound to something concrete
rather than becoming a permanent tick nobody re-earns.

A hand-edited `QUALITY-GATE.md` is overwritten on the next `dod.mjs` run,
deliberately: a Definition of Done that can be edited by the work it grades is not
a Definition of Done.

**`task-ledger.mjs` exits 2, and that is not a failure (2026-08-26, v7 Phase 3).**
It has three outcomes, not two: `0` the ledger is valid and the run can continue
(or everything is done), `1` the ledger is _invalid_ — bad schema, a dependency
cycle, a `done` task with no evidence — and `2` the ledger is _valid_ and says
nothing is runnable while work remains. An unattended caller has to tell "this
file is wrong" from "this file is right and I am stuck", so a plain `&&` chain
over these gates will read a legitimate 2 as a failure. Check for it explicitly.

That third state exists because `commands/studio-start.md:29` says a task marked
"blocked" is never picked as next until a human unblocks it. With somebody at the
keyboard that is correct. With nobody there, the first hard failure ends the build
however much independent work remains — and `self-healing/SKILL.md` allows two
quiet attempts and then invokes the terminal Stuck Protocol, so there is no middle.
So v7 has no bare `blocked` state at all: a task is `blocked-on-defect` (parked —
the run carries on with anything whose dependencies are satisfied) or
`blocked-on-human` (genuinely cannot proceed). Only when nothing is runnable does
the run stop, and then it reports which of the two applies, per task.

`Dev-Memory/tasks.json` is the authoritative ledger and `PROGRESS.md` is rendered
from it. That direction is deliberate: this repository carries eight separate
reproductions for failures of _reading_ that markdown table (X122, X138, X141,
X142, X144, X146, X147, X192/X193), every one of them the same mistake of using a
human presentation format as a data structure. A rendered file cannot be torn,
because nothing parses it back. The rendered output is still in the shape
`verify-progress.mjs` reads, which is asserted by a test.

**`run-brief.mjs` is the headless front door's contract (2026-08-26, v7 Phase 3).**
The owner's decision for v7 is "one interview, then silent" — the existing
expert-panel pop-up interview runs once at kick-off, and the build then proceeds
with no further human input. That only works if the interview's answers are written
where the build can read them, and if something checks BEFORE the run that nothing
it will need is missing. Otherwise "headless" means "runs until the first question,
then stops", which is what happens today. So run it while a person is still there,
when a gap costs one more question rather than an abandoned run.

`Dev-Memory/run-brief.json` is the data; `OBJECTIVE.md` is rendered from it. The
precedent for that direction is in `studio/SKILL.md` itself, which already had to
carve one machine-readable island out of the prose brief — the Tier "must be
recorded as one exact, on-disk line" because a script needed to read it and prose
could not be trusted to yield it.

The check that earns the file its place: the Tier is **re-derived** from the three
recorded answers and compared with the Tier actually assigned. `studio/SKILL.md`
documents that mapping as "a checkable rule, not a vibe", added by a 2026-07-10
audit fix after "a typical web app" let almost any request round up to Standard by
default. The rule was written down and nothing checked it; now something does, so a
mis-tiered project is a caught error rather than a silent one.

`nonGoals` must be present even when empty — the same no-silent-omission rule the
quality gate applies to its dimensions. An absent field cannot be told from a
considered "nothing is out of scope", and the second is a claim somebody should have
to make on purpose. `stack` must be either a chosen technology or the exact string
`studio-chooses`, because an absent value means the run decides for you without
recording that it did.

**The fix loop's cap is data, not an agent's memory.** `self-healing/SKILL.md`
allows two quiet attempts before the terminal Stuck Protocol — but the counting is
done by the agent being asked to keep trying, which is the wrong party to hold the
counter. A task records `attempts`, and `task-ledger.mjs` refuses a task still
marked runnable after spending them: a fix loop past its ceiling has not terminated.
Default 3 (where both independent peer implementations landed); a project may state
its own as `maxAttemptsPerTask` in `Dev-Memory/run.json`.

**Two run-time observability tools, not gates (2026-08-26, v7 Phase 3).**
`session-cost.mjs` and `stall-check.mjs` answer questions about a RUN, so they are
not in the commit list — there is no run to observe when you are committing to this
repository. Both take `--transcript <path>`:

```
node plugins/gru953-studio/hooks/session-cost.mjs . --transcript <path>   # what this run has spent
node plugins/gru953-studio/hooks/stall-check.mjs   . --transcript <path>  # is it working or wedged?
```

`session-cost.mjs` reports TOKENS, never money. A per-model price list inside an LTS
release stops being a snapshot and becomes a promise that goes stale silently, in the
direction of under-reporting; tokens are what the transcript records and they never
go stale. A ceiling is declared as `tokenBudget` in `Dev-Memory/run.json`, and cache
reads are excluded from the number it is compared against — on a long session they
outnumber everything else by roughly eighty to one while costing least, so including
them would make any ceiling meaningless.

Totals are keyed by `message.id`, which is not a style preference. The harness writes
one transcript line per content block and repeats the whole `usage` object on each
line. Measured on a real session on this machine before building against it: 424
usage-bearing rows carrying only 162 distinct ids, 136 repeated with byte-identical
usage, so summing rows inflates output tokens by **2.84x**. A budget built on the
naive sum halts a run at a third of its allowance.

Measured again on 2026-08-28, on a live Complex-Tier run twelve minutes in: **299 rows,
58 distinct ids — 5.2x**. The factor is not a constant, which strengthens the case
rather than weakening it: a correction factor could be applied to a naive sum only if
the factor were stable, and it is not. Keying by `message.id` is the only thing that
gives the same answer whatever shape the transcript takes.

`stall-check.mjs` exits 2 for "wedged", 1 for "cannot tell", 0 for healthy — the same
three-way convention as `task-ledger.mjs`, for the same reason. Its suppression rule
is the part that matters: an unanswered tool call is only reported when there is no
later assistant activity after it. Without that, it would flag the call currently in
flight on every run, and flag a call that failed and was handled twenty minutes ago.
Both are healthy runs, and a watchdog that cries wolf gets switched off — after which
its absence is invisible.

Neither tool ever guesses. Given no `--transcript` they look in Claude Code's
conventional location, and if they find nothing they say so and block. "I could not
find the transcript" must never render as "this run has cost nothing", and "I never
looked" must never render as "healthy".

**`config-protection.mjs`** is a `PreToolUse` hook, not one of the commit gates. It
refuses edits to an existing linter/formatter/type-checker config, to
`Dev-Memory/dod.json`, and to `Dev-Memory/evidence/` — the files that decide
whether the work is acceptable. An unattended agent told "make the build pass" can
fix the code or edit the thing measuring it, and the second always works. Creating
such a file for the first time is allowed; `pyproject.toml` and `setup.cfg` are
deliberately excluded because they carry project metadata alongside tool
configuration, and a guard that fires on ordinary work gets switched off. `INV10`
in `repo-integrity.mjs` asserts it stays wired for all four file-editing tools.
