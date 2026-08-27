# GRU953-Studio 7.0.0 (LTS)

**Paste this into the GitHub release when the draft appears.** `publish.yml` creates a
draft to hold the downloadable installers and deliberately does not write the notes —
so these are written by hand, checked against the tagged tree, and this file is what
gets pasted. The numbers below are re-measured at the tag by the step in
[docs/RELEASING-7.0.0.md](RELEASING-7.0.0.md); if you are reading this before that
step has run, treat them as the release commit's figures rather than the tag's.

---

## Read this first

Two things change that you would notice straight away.

**The licence is now Apache-2.0, and commercial use is free.** Every version up to and
including 6.1.0 was PolyForm Noncommercial: free personally, but selling anything you
built with it needed a separate licence. That is gone. Build something and sell it —
no permission needed, nothing to ask for. The GRU953 name and the Soaring Bird logo
stay protected separately; Apache-2.0 grants no trademark rights, and that is
deliberate.

**The studio no longer publishes anything for you.** A run finishes with a finished,
tested project committed on your own machine, and stops. It will not create a
repository, push a branch, or make anything public. Deciding to publish is yours, and
7.0.x will not change that.

Full plain-English upgrade notes: [MIGRATION.md](../MIGRATION.md).

## It works unattended now

You answer one round of pop-up questions at the start. The studio then researches,
designs, plans, codes, reviews and tests without interrupting you again.

That sentence was in the changelog a day before it was true, and the story is worth
telling because it is the whole point of this release. An audit found the decision
behind it — one interview, then silent — recorded in the plan and never implemented:
**fourteen** places still stopped to ask a person mid-build, and three further defects
would have made an unattended run fail outright rather than merely stall. The one test
that proved the product worked took a path that avoided every one of them, because it
built the simplest kind of project there is.

## Checks now run the work instead of reading a report about it

This is the change underneath everything else.

Before this release, the Definition of Done was a markdown table, and the agents wrote
it themselves. The gate read the table and marked the table. With a person at the
keyboard that is defensible — you notice when the app does not work. Unattended it is a
loop that always closes green.

Now `hooks/dod.mjs` **executes** each dimension — build, tests, coverage against a
stated numeric floor, lint, types, security, dependency audit, a real user journey,
accessibility, performance budgets — records every real exit code and output under
`Dev-Memory/evidence/`, and regenerates the table from that evidence. A hand-edited
table is overwritten on the next run, deliberately: a Definition of Done that can be
edited by the work it grades is not a Definition of Done.

Two dimensions no machine can measure — independent review, and documentation — are
kept explicitly separate as _judged_, and each must name the artefact it judged, so a
verdict is tied to something concrete rather than becoming a tick nobody re-earns.

## Claude Code only

Support for Cursor, Windsurf, Cline, Roo Code, Aider, GitHub Copilot, Devin, Replit,
OpenHands and Google Antigravity is withdrawn, along with the Ollama, OpenRouter and
Gemini integrations. That support was never tested end to end and this project's own
documentation called it "best-effort, uneven". One target that genuinely works is
worth more than nine that might.

The Antigravity npm package could never install in any case: every published version
shipped without the plugin its own code loads at runtime. Both withdrawn package names
are deprecated on npm rather than deleted, because a published name cannot be removed.

The Claude Desktop installer is still built. It puts the plugin where Claude Desktop
can see its skills and agents — but building a project needs Claude Code, and the
app's own Plugins page is the route Anthropic documents.

## Numbers

|                                  | 6.1.0 | 7.0.0 |
| :------------------------------- | ----: | ----: |
| Specialist roles                 |    38 |    36 |
| Skills                           |    37 |    34 |
| Commands                         |    11 |    10 |
| Enforcement hooks                |    24 |    24 |
| Tests                            |   468 |   737 |
| Third-party runtime dependencies |     0 |     0 |

The 6.1.0 column is measured from the `v6.1.0` tag rather than remembered, because an
earlier draft of this table had three of those figures wrong — including presenting
hook growth from 19 to 24 when the count had not moved at all.

The standing context load went **up**, from 127,762 B to 158,516 B, and that is stated
here rather than left out. A large share of that text is dated commentary explaining
why each rule exists, and this release added a great deal of it.

## What LTS means

7.0.x takes bug and security fixes. Features go to 7.1. What will not change is
written down in [docs/STABILITY.md](STABILITY.md) — file names and locations under
`Dev-Memory/`, the schema versions, the exit codes, the task state names, the gate
commands, that nothing is published for you, and that no hook carries a network client.

That last promise is worded narrowly on purpose. Three specialist roles are instructed
to use _your_ session's web search when a build turns on a current external fact, and
the licence scanner shells out to tools that may reach a package registry. Neither is
a hook reaching the network under its own steam, and saying "the plugin makes no
network call" — which an earlier draft did — was not true.

## Honesty about what is not proven

- **Tiny tier is green: 18 of 18 assertions in 71 minutes, 21 dispatches across 8
  specialists, nothing pushed.**
- **Complex tier is NOT green, and the reason is worth stating.** A run on 2026-08-27
  dispatched 14 specialists, wrote 92 passing tests, completed 5 of its 22 tasks — and
  then ended, reporting success, with no error of any kind. Its own task ledger was
  valid and naming the next task. It treated the end of a turn as the end of the job,
  so the Definition of Done never ran and nothing was committed: 13 of 18 assertions.
  The instruction it was missing is now in the coordinator and in `project-lead`, and
  the harness now names that cause instead of reporting its five symptoms. **That fix is
  NOT YET VERIFIED against a run:** the re-run stopped at a session limit and the harness
  reported exit 2, "could not measure" — correctly, and that refusal is itself the
  three-valued exit code doing its job. **Re-run it and replace this bullet with the
  result before publishing** — `docs/RELEASING-7.0.0.md` carries the command.
- Standard tier has not been run.

  This is stated as it stands rather than smoothed over. A Tiny brief has few enough
  tasks to finish inside one turn-group and can never fail that way, which is exactly
  why one fixture was never enough.

- `actionlint` is not wired into CI. Every other action reference in this repository is
  pinned to a full-length SHA, and adding it meant introducing the only mutable one.
  The reason and the remedy are in `CLAUDE.md`.
- Known limitations are disclosed, not hidden, under "Known limitations" in
  [SECURITY.md](../SECURITY.md) — including two bounds that were previously only in
  code comments each claiming to be disclosed there.

## Thanks

This release exists because a lot of things that looked green were measured and turned
out not to be. If you find another one, that is the most useful bug report you can
send.
