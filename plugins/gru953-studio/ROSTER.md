# GRU953-Studio role roster (committed baseline)

**role count: 23**

This file is the committed baseline the roster checks read. `roster-check.mjs`
verifies the number of `agents/*.md` files against it; `repo-integrity.mjs`
confirms this number and the README agree with reality; CI runs both on every
change. It exists because a project built *by* GRU953-Studio records its
baseline in its own `Dev-Memory/decisions/*roster*.md`, but the product repo
itself has no `Dev-Memory/` — so without this file the product's own roster
could never be mechanically verified (a real gap fixed in v2.0.0).

Per `governance/CONTRIBUTING.md` and `governance/GOVERNANCE.md`, adding a role
requires a named, specific, **non-overlapping** gap. Removing or merging a
role is allowed and encouraged where two roles overlap or a hand-off is
artificial (the v3.0.0 consolidation below).

## v3.0.0 consolidation (2026-07-11): 31 → 23

The v2.0.0 expansion (16 → 31) broadened coverage to the full SDLC/AI
specialist set. A later review found eight of those roles either genuinely
overlapped another role or created an artificial hand-off. On the owner's
explicit instruction ("merge/remove overlaps; make every role unique"), each
was merged into the role that already owned the adjacent work:

| Merged away | Into | Why it overlapped |
| :-- | :-- | :-- |
| prompt-engineer | ai-developer | Writing the prompt *is* building the AI feature; the split forced a delegate-back-and-forth |
| mlops-engineer | ai-developer | Both own the AI feature's quality; the useful eval is a fixed check ai-developer hands the tester |
| qa-lead | tester | Deciding what to test and testing it are one job for an MVP |
| sre-observability | devops-engineer | Deploying the app and keeping it observable once live are one operational job |
| release-manager | publisher | Choosing the version and writing the notes is part of the same release act as the push |
| cut-recorder | scope-guardian | The role that decides a cut is the one that records it, in the same moment |
| project-assistant | memory-keeper | The task table/logs it tidied *are* Dev-Memory files memory-keeper already owns |
| privacy-dpo | security-compliance-auditor | Both are pre-publish compliance gates triggering on the same "handles personal data" condition |

Kept deliberately separate: `responsible-ai-reviewer` stays independent of
`ai-developer` (build-vs-review separation, the same reason `reviewer` is not
the `builder`); `accessibility-specialist`, `ux-designer`, `technical-writer`,
`data-engineer`, `localisation-specialist` and `researcher` are each a
distinct discipline with a distinct trigger, not an overlap.

## Core roster (15 — most projects use these)

project-lead · interviewer · architect · scope-guardian · builder · reviewer ·
tester · security-compliance-auditor · brand-guardian · ai-developer · fixer ·
cost-monitor · publisher · memory-keeper · maintenance-agent

## Feature- and need-triggered specialists (8), with the gap each fills

| Role | Distinct gap it fills (no overlap with the above) | Activates when |
| :-- | :-- | :-- |
| devops-engineer | The built app's build/package/deploy pipeline AND its live-running reliability (health, logging, failure posture) | Standard+ app needs hosting/packaging/CI, or runs as a live service |
| responsible-ai-reviewer | Independent fairness/harm/over-reliance/transparency review of an AI feature | AI feature that meaningfully affects a real decision about a person, Standard+ |
| accessibility-specialist | Disability access (WCAG 2.2 AA / platform equivalents) | Any project with a UI |
| ux-designer | Usability of the interface and its flow | UI project, Standard+ |
| technical-writer | The built app's own user-facing docs | Standard+, or app needs docs |
| data-engineer | Data model, storage, migrations, integrity | App stores data, Standard+ |
| localisation-specialist | More than one language (i18n/l10n; English + Bangla) | Brief needs multiple languages |
| researcher | External fact-finding on current evidence | On demand in Brainstorm/Ideate/Design |

## Model tiers (deliberate, cheapest-first)

Every role declares a model — none inherits the surface default — so cost is
a decision, not an accident, in line with `cost-guard`'s cheapest-first
rule. The principle: the cheapest model that does the job reliably; spend up
only where the reasoning is genuinely hard, or where a mistake is costly and
hard to undo.

- **haiku** (cheapest) — mechanical/clerical work, little open reasoning:
  `brand-guardian`, `cost-monitor`, `memory-keeper`.
- **sonnet** (balanced default) — real but bounded reasoning; the bulk of
  the team, including the code workhorse (`builder`, run 2 in parallel on
  Standard/Complex Tier per the Build Swarm — see `studio/SKILL.md`'s Tier
  table — so deliberately not opus) and the rare-but-irreversible `publisher`
  (spent up from haiku for reliability): `interviewer`, `scope-guardian`, `builder`,
  `tester`, `security-compliance-auditor`, `fixer`, `publisher`,
  `maintenance-agent`, `ai-developer`, `ux-designer`,
  `accessibility-specialist`, `technical-writer`, `data-engineer`,
  `localisation-specialist`, `devops-engineer`, `researcher`.
- **opus** (most capable, most expensive) — reserved for the hardest
  reasoning only: `project-lead` (orchestration), `architect` (design),
  `reviewer` (correctness), `responsible-ai-reviewer` (safety judgement).

Count: 3 haiku · 16 sonnet · 4 opus = 23.
