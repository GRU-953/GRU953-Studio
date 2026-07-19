---
name: command-centre
description: The native task command centre for a GRU953-Studio project — plan, track and control work with pause, resume, stop, skip-now and schedule-for-later. Defines the task state machine over PROGRESS.md (adding paused/skipped/scheduled to todo/doing/done/blocked), the live plain-English STATUS-BOARD.md, how each /studio control command changes state, how "schedule for later" uses the session's scheduler (degrading gracefully when none exists), and the self-contained HTML dashboard. Use whenever the user wants to see, pause, resume, stop, skip or schedule work.
---

# Command Centre

## Why this exists

A long project needs a cockpit: the user should be able to see every planned
task and its state, and to pause, resume, stop, skip, or schedule work at any
moment — without anything being lost. The pieces already exist (`PROGRESS.md`
is the task table, `/studio-status` reports it); this skill turns them into a
controllable command centre with a small, durable **state machine** and a
live board. Everything is plain text, so control survives a closed laptop or a
new session. Plain-English rule is exactly as set in the `studio` skill.

## The task state machine (PROGRESS.md Status column)

`PROGRESS.md`'s Status column stays the single source of truth. The command
centre extends its vocabulary from `todo`/`doing`/`done`/`blocked` with three
control states:

| Status | Meaning | Picked as the next task? |
| :-- | :-- | :-- |
| `todo` | not started, ready when dependencies are `done` | yes (first eligible) |
| `doing` | in progress right now | — (already active) |
| `done` | finished and verified (`verified:` line required) | no |
| `blocked` | waiting on an external unblock | no, until a human unblocks |
| `paused` | user paused it mid-flight; resumes exactly where it stopped | no, until resumed |
| `skipped` | user set it aside for now; not lost, resurfaces later | no, until revisited |
| `scheduled` | set to resume at a recorded time (see below) | no, until its time |

Allowed transitions (each written by `memory-keeper`, with the usual
secrets-scan, and reflected into the **build plan** `PLAN.md` and the board
`STATUS-BOARD.md` in the same write — see "The build plan stays the source of
truth" below):

- `todo`/`doing` → `paused` (**pause**); `paused` → `doing` (**resume**).
- `doing` → `todo` (**stop** — a clean set-down; nothing is left half-claimed
  as `done`; the project is checkpointed and can end safely).
- `todo`/`doing` → `skipped` (**skip now**); the next eligible task becomes
  active. `skipped` → `todo` when revisited.
- `todo`/`doing` → `scheduled` (**schedule for later**, with a time);
  `scheduled` → `todo`/`doing` when the time arrives.
- The existing `todo` → `doing` → `done` / `blocked` transitions are unchanged.

The "next task" rule everywhere (dev-memory, memory-keeper) already means "the
first `todo`/`doing` row whose dependencies are all `done`" — it now also skips
over `paused`, `skipped` and `scheduled` rows, which are consciously not-active,
never `blocked`.

## The build plan stays the source of truth — control states reflect into it

A pause, stop, skip or schedule is not a transient board note — it is a real
change to the plan of work, so it must show up **in the build plan itself**. On
every control command, `memory-keeper` updates all three in one write, kept
consistent:

- **`PROGRESS.md`** — the authoritative Status cell (the new state).
- **`PLAN.md`** — the ordered/phased build plan: the same task's row is marked
  with its control state (`paused`/`skipped`/`scheduled` + any time), and the
  plan's next-actionable task and ordering are recomputed so the plan never
  reads as if a paused/skipped task were still the active one. On Standard/
  Complex Tier `PLAN.md` is the file; on Tiny Tier the inline task list is
  updated in place. (A `scheduled` task carries its time; a `skipped` task stays
  in the plan, clearly set aside, never deleted — the plan is a faithful record,
  not a rewrite.)
- **`STATUS-BOARD.md`** — the rendered at-a-glance board (below).

So anyone reading the build plan later — a new session, the user, the dashboard
— sees the true, current state of every task without having to reconcile a
separate control log against it. The plan and the board never drift.

## What the command centre surfaces (organised, in one place)

The command centre is more than a task list: it presents the whole shape of the
software being built, organised, so the plan is always understood in the context
of what is being built and why. It surfaces, from Dev-Memory:

1. **Concept** — the confirmed brief, Tier and goal (`OBJECTIVE.md`).
2. **Architecture & specifications** — the chosen stack, components, data flow,
   interface contracts, decisions and deliberate omissions (`ARCHITECTURE.md`).
3. **Build plan** — the complete, ordered/phased micro-task plan with each
   task's state (`PLAN.md`), including MVP-then-phases structure.
4. **Live task board** — Done / Doing / Paused / Scheduled / Skipped / Blocked /
   Next up (`STATUS-BOARD.md` / `PROGRESS.md`).

`/studio-status` gives this as a plain-English summary; `/studio-dashboard`
renders all four together as the self-contained HTML dashboard (below). Both are
read-only views of the same source of truth.

## STATUS-BOARD.md — the live board

`Dev-Memory/STATUS-BOARD.md` is a rendered, plain-English at-a-glance board,
refreshed whenever state changes. It is **derived** from `PROGRESS.md` (which
stays the source of truth — if they ever disagree, `PROGRESS.md` wins), grouping
tasks under: Done · Doing · Paused · Scheduled (with times) · Skipped · Blocked
· Next up. It is the same four-part picture `/studio-status` reports, persisted
so any session — and the HTML dashboard — can render it without re-deriving it.

## The control commands

Five commands drive the machine (see `commands/studio-*.md`). Each: reads
`Dev-Memory/`, makes the one state change via `memory-keeper`, refreshes
`STATUS-BOARD.md`, and confirms to the user in one or two plain sentences.

- **/studio-pause** — pause the active task (→ `paused`); everything freezes,
  resumable exactly. Safe to close the session after.
- **/studio-resume** — resume the paused/scheduled task (→ `doing`) and carry
  on, after the usual `focus-guard` re-orientation read.
- **/studio-stop** — stop work now and set the project down cleanly: revert the
  active task to `todo` (never a half-finished `done`), checkpoint memory, and
  report where things stand. Distinct from pause: stop ends the work session.
- **/studio-skip** — set the current task aside (→ `skipped`) and move to the
  next eligible task; the skipped task is recorded, never dropped.
- **/studio-schedule** — record a time to resume a task (→ `scheduled`) and arm
  the session's scheduler (below).

None of these ever touches Publish or any push-capable action — control is
local; publishing still needs its own explicit confirmation and token gate.

## Scheduling for later (portable, degrades gracefully)

"Schedule for later" records the intent durably first — a `scheduled` status
plus the target time in `PROGRESS.md`/`STATUS-BOARD.md` — so it is never lost.
Then it arms whatever scheduling capability the current session actually offers
(a scheduled-task / wake-up / cron trigger the host exposes), to re-enter the
project at that time. **If the session offers no scheduler**, say so plainly:
the time is recorded and the studio will resume the moment the user returns at
or after it — never a silent promise to wake up that the environment cannot
keep. A scheduled resume re-runs the normal re-orientation read and still never
auto-publishes.

## The HTML dashboard

On request (`/studio-dashboard`), run `hooks/dashboard.mjs` to generate a
**self-contained** `Dev-Memory/dashboard.html` — the organised command centre:
the **Concept** (`OBJECTIVE.md`), **Architecture & specifications**
(`ARCHITECTURE.md`) and the complete **Build plan** (`PLAN.md`, phases and all)
rendered as readable sections, followed by the live task board from
`PROGRESS.md`/`STATUS-BOARD.md` — every task grouped by status, a summary count
bar, and colour-coded rows. The generator guarantees the two hard rules — all
CSS inline with **no external network calls, fonts or scripts**, and every cell
HTML-escaped so task text can never break the page — and the core table works
with no JavaScript at all. It is a read-only view of the same source of truth
(`PROGRESS.md` still wins); opening it changes nothing, and it lives under the
private, never-shipped `Dev-Memory/`. Use the generator rather than writing the
HTML by hand, so those guarantees always hold.

## Who applies this

- **project-lead** interprets a control command and delegates the state change.
- **memory-keeper** writes the `PROGRESS.md` status change and refreshes
  `STATUS-BOARD.md` (and, Standard/Complex, the `GRAPH.md`/`INDEX.md` recall
  layer), with the usual secrets-scan.
- The commands themselves live in `commands/studio-*.md`.
