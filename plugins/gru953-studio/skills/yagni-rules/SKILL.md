---
name: yagni-rules
description: The GRU953-Studio lean-coding rule set (YAGNI — "You Aren't Gonna Need It"). Use whenever the studio writes, reviews or trims code, whenever a builder is about to add a file, function, dependency or abstraction, and whenever the user says "keep it simple", "minimal", "lean", "no bloat", or "just the basics". Every line of studio-produced code must pass this ladder.
---

# YAGNI rules

Before writing ANY code — a file, a function, a class, a dependency — walk
this ladder from the top. Stop at the first rung that answers the need.

## The ladder

1. Does this need to exist at all? (speculative need = skip)
2. Already in this codebase? (reuse)
3. Standard library does it? (use it)
4. Native platform feature? (use it)
5. Already-installed dependency? (use it; never add a new one for what a
   few lines can do)
6. Can it be one line? (one line)
7. Only then: the minimum code that works.

## Standing rules

- **No unrequested abstractions.** No interfaces, base classes, plugin
  systems, config layers or wrappers the confirmed brief does not require
  today.
- **No scaffolding "for later".** Do not build hooks, empty folders, stub
  modules or feature flags for imagined future work. If it might matter
  later, write one line about it in `Dev-Memory/decisions/` instead.
- **Deletion over addition.** A smaller diff that deletes code beats a
  larger one that adds.
- **Boring over clever.** The obvious, well-trodden construct over the
  clever one.
- **Fewest files.** Split code across files only when a file genuinely
  serves two different owners or purposes.
- **Shortest working diff wins.**
- **Root-cause fixes.** Grep every caller and fix the cause, not the
  symptom.
- **A DIFF's explanation should not be longer than the diff.** Say why the change
  is needed, not a lecture around it.

  **Corrected 2026-08-22 (finding X98): this used to read "Explanation never longer
  than the code it explains", and this project's own code breaches it in 5 of its
  19 hooks** — `lib.mjs` at 2.33:1 (1,590 comment lines to 681 of code),
  `verify-progress.mjs` at 1.44:1, `quality-gate.mjs` at 1.42:1, `auto-update.mjs`
  and `scan.mjs` both at 1.09:1. Measured, not estimated.
  
  That is not five defects. Those comments are the record of WHY each guard exists
  and which finding produced it, and they are the reason a defect found in July can
  still be traced in August — the single most useful property this codebase has.
  So the RULE was wrong, not the code: stated absolutely it condemned the practice
  the project depends on, and a rule nothing obeys and nothing checks is worse than
  no rule. Scoped to what it was actually for — brevity in a change's *justification
  to a reader*, not a cap on durable explanation in source.

## When NOT to be lazy

Deletion pressure STOPS at these:

- Input validation at trust boundaries.
- Error handling that prevents data loss.
- Security measures (authentication, permission checks, escaping).
- Accessibility basics (labels, keyboard use, readable contrast).
- Anything the confirmed brief explicitly asked for.

If in doubt, keep the safety and note the question in
`Dev-Memory/decisions/` rather than deleting it.

## Beyond code: the same principle applied to process, scaled by Tier

This file's ladder is scoped to code — "before writing ANY code." A handful
of other skills (`phased-roadmap`, `content-creation`, `quality-gate`,
`memory-graph`, `focus-guard`) each carry their own Tier-scaling section — headed
`## Tier-scaling (YAGNI)` in the first two and `## Tier-scaling (YAGNI still
applies)` in the other three (X98, 2026-08-22: this named only the first spelling,
so a reader grepping for it would have concluded three of the five had lost the
section) — applying the same "don't do more than the task genuinely needs"
spirit to *process and documentation ceremony* — a Tiny-Tier project skips a
multi-phase roadmap, a content manifest, a knowledge graph, or a
requirements matrix it has no real use for (2026-07-26 clarification: those
five sections cited "YAGNI" without this file ever confirming the extension
to process/ceremony — the ladder above never mentioned Tiers at all, so the
citation was one-directional). Tiers themselves are defined in
`studio/SKILL.md`, not here; this file's contribution is only this: the same
reasoning that stops unrequested code from being written also stops
unrequested process from being run. It does not relax rung 1 above — code is
still never speculative regardless of Tier.

## Who applies this

- **builder** walks the ladder before every task.
- **reviewer** re-walks it over every diff, and also runs the whole-product
  trim before Publish (absorbing the retired `minimalist` role — 2026-07-10
  audit).
- **architect** applies the same ladder to stack and storage choices:
  zero-dependency options win ties.
- Deviations are allowed only with a written reason in
  `Dev-Memory/decisions/`.
