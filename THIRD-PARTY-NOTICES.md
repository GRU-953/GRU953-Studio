# Third-party notices

This file forms part of [NOTICE](NOTICE). It records third-party material
incorporated into GRU953-Studio and the attributions those licences require.

## Incorporated third-party code

**None at present.**

GRU953-Studio contains no third-party code. It has no runtime dependencies, and
its development tooling (ESLint, Prettier) is not distributed with the product —
see the note on dependencies in [CONTRIBUTING.md](CONTRIBUTING.md).

If that ever changes, each item is listed here with its copyright holder,
licence, the licence text or a link to it, and the paths it covers. An entry is
required before the code is merged, not after.

## Prior art and influences

The following projects were studied during the design of version 7.0.0. Their
ideas informed GRU953-Studio's own implementation; **no code from them is
included**, so none of the notices below is a legal obligation. They are
recorded because the ideas were genuinely useful and the people who published
them deserve the credit.

| Project | Licence | What it contributed |
| :-- | :-- | :-- |
| [obra/superpowers](https://github.com/obra/superpowers) | MIT | The shape of an unattended execution loop: a plan-scoped, identity-stamped progress ledger that survives context compaction and crashes; passing work between agents as file paths rather than pasted text; and a review/fix cycle that is bounded by a round cap with escalation, so it terminates instead of spinning. |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | MIT | Proving that a skill is actually reachable from realistic phrasing rather than merely present; refusing to accept an evaluation corpus that has decayed into placeholders; and grading a run by its recorded tool calls rather than by what the agent says it did. |
| [affaan-m/ECC](https://github.com/affaan-m/ECC) | MIT | Deciding when an autonomous loop should stop by measurement rather than by asking a human; detecting a run that has silently wedged; accounting for what a session actually cost; and preventing an agent from weakening the very quality gates it is being measured against. |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | MIT | Detecting mechanically when a newly proposed specialist role is substantially a re-skin of one that already exists. |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | MIT | The discipline that a measuring instrument is not trusted until it has been shown to pass a known-good sample and fail a known-bad one. |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | Naming the ways a generated test suite can be green and worthless, and requiring a debugging agent to reproduce a failure before theorising about it. |
| [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 (in part; some skills are separately licensed) | Conventions for authoring agent skills, and the three-level progressive-disclosure model for what a skill costs to load. |

Reviewed 2026-08-26.
