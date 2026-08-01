# Objective — Habit Tracker

A working MVP that lets users track daily habits, check in once a day, and
see their current streak.

## Tier questions (studio skill, Q1-Q3)

- **Q1 — Will your app remember users between visits?** Yes (habits and
  streaks are saved between sessions).
- **Q2 — Does your app handle money, passwords, or personal info?** No.
- **Q3 — Will your app connect to two or more other services?** None.

**Tier:** Standard

2026-07-31 maintenance fix: this exact line — `**Tier:** Standard` — is the
one, documented, machine-parseable place a project's Tier is recorded (see
`studio/SKILL.md`'s Tier-questions section and `focus-guard/SKILL.md`'s
Tier-scaling section). `hooks/traceability-check.mjs` reads it to tell a
genuinely Tiny-Tier project (no `REQUIREMENTS.md` file needed) apart from a
Standard/Complex one that has simply lost the file. This project has a real
`REQUIREMENTS.md`, so that path is never exercised here — this file exists so
the golden corpus's end-to-end promise stays real (every Dev-Memory file a
built project would actually have), and so a future studio flow that
templates a new `OBJECTIVE.md` has a working example of the exact line to
pre-set, not a guess.

## Target platform (Q4)

Web browser only.
