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
```

`repo-integrity.mjs` is the guard that stops a file referencing a skill,
hook, or role count that doesn't actually exist — if you add or rename any
agent, skill, or hook, run it before you commit. Adding a specialist role
means updating `plugins/gru953-studio/ROSTER.md` (the committed baseline)
with the named gap it fills.
