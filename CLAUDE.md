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
```

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

The seven gates above are the ones CI itself runs and are mandatory on every
commit. A GRU953-Studio project's own `Dev-Memory/` additionally carries five
project-level gates (no-ops on this repo, since it has no `Dev-Memory/` of its
own) that a project built *by* the plugin must pass before a phase checkpoint
or Publish — run these too whenever you touch the skill/hook that documents
them, so the documented requirement and the enforcing script never drift apart:

```
node plugins/gru953-studio/hooks/verify-progress.mjs .     # done tasks carry verified: evidence (tester / security-compliance-auditor)
node plugins/gru953-studio/hooks/quality-gate.mjs .        # Definition of Done (quality-gate skill)
node plugins/gru953-studio/hooks/traceability-check.mjs .  # requirements <-> tasks (focus-guard skill)
node plugins/gru953-studio/hooks/memory-integrity.mjs .    # recall index/graph consistency (memory-graph skill)
node plugins/gru953-studio/hooks/content-check.mjs .       # content approval/provenance/rights (content-creation skill)
```
