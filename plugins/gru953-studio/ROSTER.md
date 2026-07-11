# GRU953-Studio role roster (committed baseline)

**role count: 31**

This file is the committed baseline the roster checks read. `roster-check.mjs`
verifies the number of `agents/*.md` files against it; `repo-integrity.mjs`
confirms this number and the README agree with reality; CI runs both on every
change. It exists because a project built *by* GRU953-Studio records its
baseline in its own `Dev-Memory/decisions/*roster*.md`, but the product repo
itself has no `Dev-Memory/` — so without this file the product's own roster
could never be mechanically verified (a real gap fixed in v2.0.0).

Per `governance/CONTRIBUTING.md` and `governance/GOVERNANCE.md`, adding a role
requires a named, specific gap. The v2.0.0 expansion (16 → 31) was an explicit
owner decision to broaden coverage to the standard SDLC/AI specialist set;
every added role names the gap it fills and is Tier- or feature-gated so it
never activates on a project that does not need it.

## Core roster (the original 16)

project-lead · interviewer · architect · scope-guardian · builder · reviewer ·
tester · security-compliance-auditor · brand-guardian · ai-developer · fixer ·
cut-recorder · cost-monitor · publisher · memory-keeper · maintenance-agent

## Added in v2.0.0 (15 roles), with the gap each fills

| Role | Gap it fills (not covered by any existing role) | Activates when |
| :-- | :-- | :-- |
| devops-engineer | The built app's own build/package/deploy pipeline | Standard+ app needs hosting/packaging/CI |
| sre-observability | Reliability of the app once it runs live (health, logging, failure posture) | Complex, or app runs as a live service |
| release-manager | Versioning + honest release notes + release readiness | Publish on Standard+ |
| mlops-engineer | Ongoing evaluation/monitoring of an AI feature | AI feature needing ongoing quality, Standard+ |
| prompt-engineer | Designing/structuring/versioning the prompts themselves | Any project with an AI feature |
| responsible-ai-reviewer | Fairness, foreseeable harm, over-reliance, AI transparency | AI feature, Standard+ |
| qa-lead | Test strategy and coverage (distinct from executing tests) | Standard+ |
| accessibility-specialist | Disability access (WCAG 2.2 AA / platform equivalents) | Any project with a UI |
| ux-designer | Usability of the interface and its flow | UI project, Standard+ |
| technical-writer | The built app's own user-facing docs | Standard+, or app needs docs |
| data-engineer | Data model, storage, migrations, integrity | App stores data, Standard+ |
| privacy-dpo | Lawful, minimal, transparent handling of personal data | App handles personal data |
| localisation-specialist | More than one language (i18n/l10n; English + Bangla) | Brief needs multiple languages |
| researcher | External fact-finding on current evidence | On demand in Brainstorm/Ideate/Design |
| project-assistant | Routine task-table/checklist/log upkeep and next-step prep | On demand; continuous on Complex |

## Model tiers (deliberate, cheapest-first)

Every role declares a model — none inherits the surface default — so cost is
a decision, not an accident, in line with `cost-guard`'s cheapest-first
rule. The principle: the cheapest model that does the job reliably; spend up
only where the reasoning is genuinely hard, or where a mistake is costly and
hard to undo.

- **haiku** (cheapest) — mechanical/clerical work, little open reasoning:
  `brand-guardian`, `cost-monitor`, `cut-recorder`, `memory-keeper`,
  `release-manager`, `project-assistant`.
- **sonnet** (balanced default) — real but bounded reasoning; the bulk of
  the team, including the code workhorse (`builder`, run 2–3 in parallel, so
  deliberately not opus) and the rare-but-irreversible `publisher` (spent up
  from haiku for reliability): `interviewer`, `scope-guardian`, `builder`,
  `tester`, `security-compliance-auditor`, `fixer`, `publisher`,
  `maintenance-agent`, `ai-developer`, `prompt-engineer`, `mlops-engineer`,
  `qa-lead`, `ux-designer`, `accessibility-specialist`, `technical-writer`,
  `data-engineer`, `privacy-dpo`, `localisation-specialist`, `devops-engineer`,
  `sre-observability`, `researcher`.
- **opus** (most capable, most expensive) — reserved for the hardest
  reasoning only: `project-lead` (orchestration), `architect` (design),
  `reviewer` (correctness), `responsible-ai-reviewer` (safety judgement).

Count: 6 haiku · 21 sonnet · 4 opus = 31.
