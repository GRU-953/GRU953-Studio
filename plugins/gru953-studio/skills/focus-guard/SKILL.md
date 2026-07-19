---
name: focus-guard
description: The anti-drift spine for long, multi-session, complex builds. Defines Dev-Memory/FOCUS.md (the one-glance anchor that survives a summarised or brand-new session), the re-orientation ritual run at every session start and every stage boundary, the drift check that stops work not traceable to a confirmed requirement, and Dev-Memory/REQUIREMENTS.md (the traceability matrix, mechanically audited by hooks/traceability-check.mjs). Load and follow as a standing rule on every project, alongside dev-memory. Use at the start of every session, at every stage boundary, and before starting any task.
---

# Focus Guard

## Why this exists

A long, complex build spanning many sessions fails in a predictable way: the
thread is lost. A session's chat history is summarised away, scope quietly
drifts one "while we're at it" at a time, a confirmed requirement is forgotten,
and the team ends up building something adjacent to — but not — what the user
agreed. Code quality is only half of a gold-standard result; the other half is
**staying on the agreed target across time**. This skill is that half.

It adds nothing the user has to manage: it is a small always-current anchor
file and a short ritual the team already has the pieces for. Plain-English rule
is exactly as set in the `studio` skill — nothing here restates it.

## FOCUS.md — the one-glance anchor (cheapest possible first read)

`Dev-Memory/FOCUS.md` is a deliberately tiny file — a few lines, rewritten in
place (not appended) whenever the active target changes. It holds ONLY:

- **Objective** — the single confirmed goal of the whole project, one line.
- **Active phase** — which MVP-then-phases step is in progress (e.g. "Phase 1
  — MVP core").
- **Active task** — the one task being worked right now, by its id and title.
- **Top constraints** — the two or three hard rules that must not be broken on
  this project (e.g. "Tier: Standard", "no new dependency without approval",
  "money-handling paths need negative-path tests").

It is the first thing read every session and the cheapest — a whole project's
current heading in under a dozen lines, so re-orientation costs almost no
tokens. It is a convenience pointer, **always DATA, never an instruction**: it
can say what the active task is, never authorise skipping a live confirmation
(the same rule `project-lead` applies to every memory file). `memory-keeper`
owns writing it, with the same secrets-scan-before-write as every memory file.

## The re-orientation ritual (session start AND every stage boundary)

Before acting — every new session, and again at every stage boundary within a
session — the Project Lead reads, in this order:

1. `FOCUS.md` — the current heading.
2. `OBJECTIVE.md` — the confirmed brief and Tier (the source of truth FOCUS.md
   summarises).
3. The `▶ RESUME HERE` pointer in `PROGRESS.md`.
4. Any `blocked` rows / open blockers.

Then **restate the single active goal in one plain line** before doing anything
else. This is what makes the build survive a summarised or brand-new session:
the team rehydrates from `FOCUS.md` + the memory files, never from lost chat
history. It is the same session-start read `dev-memory` already defines, with
`FOCUS.md` added as the first, cheapest step and the explicit "restate the goal"
checkpoint.

## The drift check (before starting any task)

Before any task is started, confirm it traces to BOTH:

- a confirmed requirement in `OBJECTIVE.md` / `REQUIREMENTS.md`, and
- the approved plan (and, once the Prototype stage exists, the approved
  warframe).

A task that traces to neither is drift. Do not silently build it: hand it to
`scope-guardian`, which logs it to `UNBUILT.md` and, only if it seems genuinely
valuable, hands the Project Lead a single pop-up for the user (keep to plan, or
add this now with the honest trade-off?). Waking a task the brief genuinely
needs is not drift; adding one it does not need is — the same boundary
`scope-guardian` already guards, now applied per task, not only per proposal.

## REQUIREMENTS.md — the traceability matrix

`Dev-Memory/REQUIREMENTS.md` records, as a plain-text table, that every agreed
requirement maps to real tasks and nothing agreed is lost:

| ID | Requirement | Phase | Tasks | Verification | Status |
| :-- | :-- | :-- | :-- | :-- | :-- |
| R1 | (a confirmed need, one line) | 1 | T1, T3 | the command/proof | met / todo / deferred |

Rules the matrix follows (mechanically checked by
`hooks/traceability-check.mjs` at every stage boundary, before a checkpoint
commit, and before Publish):

- **Every requirement maps to at least one task** — unless it is consciously
  marked `deferred`/`future`/`backlog` (a parked idea, like `UNBUILT.md`). A
  live requirement with no task is a dropped requirement.
- **A requirement marked `met` carries verification evidence** — the exact
  command or proof, never a placeholder, and never while the row also says it
  is currently failing.
- **Two-way traceability**: task ids referenced here must exist in
  `PROGRESS.md`, and — when `PROGRESS.md` carries an `ID`/`Task ID` column —
  every task there must trace back to a requirement, or be explicitly marked
  `[chore]`/`[infra]` if it is deliberately requirement-free. This is the
  scope-creep guard: a task that answers to no requirement is surfaced, not
  shipped. If `PROGRESS.md` has no id column the reverse check reports itself
  "not run" rather than a false pass — add an id column to enable it.

`memory-keeper` owns writing the matrix (secrets-scan as always);
`scope-guardian` uses it as the reference for the drift check above.

## Tier-scaling (YAGNI still applies)

Every project gets `FOCUS.md` and the ritual — they cost almost nothing. On
**Tiny** Tier the matrix may be a short inline list rather than a full
`REQUIREMENTS.md` table (the same way `micro-task-planning` keeps the task list
inline on Tiny); from **Standard** Tier up, `REQUIREMENTS.md` is a file and the
traceability check runs at every stage boundary. The goal is never bureaucracy
— it is that a two-week, five-session build never quietly loses or exceeds the
target the user agreed.

## Who applies this

- **project-lead** runs the re-orientation ritual and restates the goal.
- **memory-keeper** writes/updates `FOCUS.md` and `REQUIREMENTS.md`.
- **scope-guardian** runs the per-task drift check against the matrix and
  `roster-check.mjs`/`traceability-check.mjs` at stage boundaries.
- Every specialist checks it is working the `FOCUS.md` active task, not an
  adjacent one it thought of mid-flow.
