---
name: phased-roadmap
description: Turns the confirmed design into an MVP-first, then progressively-enhanced build roadmap — Phase 1 is the smallest core that actually works, Phases 2..N add the rest in order. PLAN.md/PROGRESS.md gain a Phase column; each phase is independently shippable and ends in a backup checkpoint. Use at the Prototype/Plan boundary and whenever the build plan is organised or revised.
---

# Phased Roadmap

## Why this exists

The studio already builds the smallest version that works; this skill makes the
"then grow it" explicit and visible. User-directed (2026-07-19): "develop each
app beginning with the first MVP with core functions only, then add the rest in
progressive phases." A phased roadmap lets the user see the whole journey — what
the first version does, and what each later phase adds — and gives every phase a
clean, shippable, backed-up boundary. Plain-English rule is as set in the
`studio` skill.

## The shape

- **Phase 1 — MVP core.** The smallest set of features that makes the app
  genuinely useful for its one core job. Nothing that isn't needed to make the
  core work (this is `yagni-rules`, unchanged — no scaffolding "for later",
  future ideas get one line in `Dev-Memory/decisions/`, not stub code now).
- **Phase 2…N — progressive enhancements.** Each later phase adds a coherent
  slice of value, in priority order, and is itself independently shippable and
  independently acceptance-tested.

This is a *product* roadmap, not a licence to pre-build. YAGNI still governs the
code: a phase's features are only built when that phase is the active one.

## How it is recorded

- `PLAN.md` and `PROGRESS.md` gain a **Phase** column, so every micro-task
  carries the phase it belongs to and the task board/dashboard can group by
  phase (the command centre renders the full phased plan — see
  `command-centre`).
- Each phase has its own short acceptance summary ("Phase 1 is done when …") in
  `PLAN.md`, and its own entry in `REQUIREMENTS.md` mapping requirements → phase.
- The whole roadmap is approved once at the Prototype gate (the
  `warframe-prototype` skill), alongside the warframe.

## Phase boundaries (the rhythm)

For each phase, in order:

1. Build and test the phase's micro-tasks (the normal Build/Test/Fix/Review
   flow, with the `model-router` picking model/effort per task).
2. Clear the **quality gate** (`quality-gate` skill) for the phase — the
   Definition of Done must be green.
3. Take a **backup checkpoint** (`checkpoint-commit` skill): commit the phase's
   app code to the private work branch. Nothing is lost if work stops here.
4. Advance to the next phase (or, at the final phase, proceed to Publish).

A phase is never reported complete until its quality gate is clean and its
checkpoint is taken — the `progress-honesty` rule applied at phase scale.

## Tier-scaling (YAGNI)

A **Tiny** project may be a single phase (an MVP that is the whole thing) — no
roadmap ceremony where there is nothing to phase. Multi-phase roadmaps earn
their place on Standard/Complex projects with real growth beyond the MVP.

## Who applies this

- **architect** proposes the phased roadmap from the design; **project-lead**
  presents it at the Prototype gate and drives phase-by-phase.
- **memory-keeper** maintains the Phase column in `PLAN.md`/`PROGRESS.md` and
  the per-phase acceptance summaries.
