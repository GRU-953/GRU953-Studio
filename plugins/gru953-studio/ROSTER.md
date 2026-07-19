# GRU953-Studio role roster (committed baseline)

**role count: 34**

This file is the committed baseline the roster checks read. `roster-check.mjs`
verifies the number of `agents/*.md` files against it; `repo-integrity.mjs`
confirms this number and the README agree with reality; CI runs both on every
change. It exists because a project built *by* GRU953-Studio records its
baseline in its own `Dev-Memory/decisions/*roster*.md`, but the product repo
itself has no `Dev-Memory/` — so without this file the product's own roster
could never be mechanically verified (a real gap fixed in v2.0.0).

Per `CONTRIBUTING.md` and `governance/GOVERNANCE.md`, adding a role
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

## Core roster (14 — most projects use these)

project-lead · interviewer · architect · scope-guardian · builder · reviewer ·
tester · security-compliance-auditor · brand-guardian · ai-developer · fixer ·
cost-monitor · publisher · memory-keeper

## Feature- and need-triggered specialists (9), with the gap each fills

| Role | Distinct gap it fills (no overlap with the above) | Activates when |
| :-- | :-- | :-- |
| maintenance-agent | Fixes and new features on a project already published — a distinct mode from building one for the first time | Returning to a previously published project (2026-07-16 fix: this was inconsistently listed as "core" here while README correctly placed it here — a brand-new project never wakes it) |
| devops-engineer | The built app's build/package/deploy pipeline AND its live-running reliability (health, logging, failure posture) | Standard+ app needs hosting/packaging/CI, or runs as a live service |
| responsible-ai-reviewer | Independent fairness/harm/over-reliance/transparency review of an AI feature | AI feature that meaningfully affects a real decision about a person, Standard+ |
| accessibility-specialist | Disability access (WCAG 2.2 AA / platform equivalents) | Any project with a UI |
| ux-designer | Usability of the interface and its flow | UI project, Standard+ |
| technical-writer | The built app's own user-facing docs | Standard+, or app needs docs |
| data-engineer | Data model, storage, migrations, integrity | App stores data, Standard+ |
| localisation-specialist | More than one language (i18n/l10n; English + Bangla) | Brief needs multiple languages |
| researcher | External fact-finding on current evidence | On demand in Brainstorm/Ideate/Design |

## Native language specialists (6), added v3.6.0 (2026-07-19)

Owner-directed expansion (feature request: "add native support for dart/flutter,
kotlin, rust, python, java, C++ with dedicated agents"). Recorded here as the
required named-gap decision under `governance/GOVERNANCE.md`; the owner is
Maintainer + Steering. Each is a distinct, **non-overlapping** gap: the generic
`builder` is the default implementer (web/scripting) and coordinates the Build
Swarm, but it does not carry a given ecosystem's toolchain, idioms, testing and
dependency/licence norms — each specialist below does, backed by a shared
`lang-*` skill pack so the agents stay thin (no duplicated logic). A language
with no specialist stays with `builder`; adding one is a roster change like this,
never ad hoc.

| Role | Distinct gap it fills | Activates when | Pack |
| :-- | :-- | :-- | :-- |
| flutter-dart-developer | Dart/Flutter toolchain (pub), null-safety and widget/state idioms | A task is in Dart/Flutter (default mobile stack) | `lang-dart` |
| kotlin-developer | Kotlin/Gradle toolchain, coroutine and null-safety idioms (JVM/Android) | A task is in Kotlin | `lang-kotlin` |
| rust-developer | Cargo toolchain, ownership/borrow and error idioms, minimal `unsafe` | A task is in Rust | `lang-rust` |
| python-developer | venvs, pytest/ruff/mypy toolchain, typing idioms | A task is in Python | `lang-python` |
| java-developer | Maven/Gradle toolchain, immutability and resource-handling idioms | A task is in Java | `lang-java` |
| cpp-developer | CMake/CTest, RAII/smart-pointer memory idioms, sanitizers | A task is in C++ | `lang-cpp` |

## Content team (5), added v4.1.0 (2026-07-19)

Owner-directed expansion (feature request: "add a content creation phase after
prototyping with specialised roles to generate the app's content"). Recorded
here as the required named-gap decision under `governance/GOVERNANCE.md`. Each is
a distinct, **non-overlapping** gap: producing the app's actual content (copy,
images, audio, video) is separate work from building the app shell (`builder`/
language specialists), designing it (`architect`/`ux-designer`), translating
existing strings (`localisation-specialist`), or documenting it for users
(`technical-writer`). Text is generated natively by Claude; media via the opt-in
`gemini-integration`.

| Role | Distinct gap it fills | Activates when |
| :-- | :-- | :-- |
| content-director | Plans and orchestrates all content from the spec + prototype; owns the content plan, `CONTENT.md` and the media opt-in | The Content stage (any app needing real content) |
| text-content-specialist | Writes the app's own in-app copy & microcopy in Bangla + English (not translation, not user docs) | Any app with in-app text |
| image-content-specialist | Generates the app's images/icons/illustrations via Gemini, platform-appropriate, with alt-text | Brief needs images |
| audio-content-specialist | Generates the app's audio/narration/speech via Gemini, with transcripts | Brief needs audio |
| video-content-specialist | Generates the app's video/clips via Gemini, with captions | Brief needs video |

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
  `localisation-specialist`, `devops-engineer`, `researcher`, and the six
  native language specialists (`flutter-dart-developer`, `kotlin-developer`,
  `rust-developer`, `python-developer`, `java-developer`, `cpp-developer`) —
  each an implementer like `builder`, so the same sonnet tier, not opus. Plus
  the five-strong content team (`content-director`, `text-content-specialist`,
  `image-`/`audio-`/`video-content-specialist`) — content planning and
  generation is bounded work, sonnet-tier.
- **opus** (most capable, most expensive) — reserved for the hardest
  reasoning only: `project-lead` (orchestration), `architect` (design),
  `reviewer` (correctness), `responsible-ai-reviewer` (safety judgement).

Count: 3 haiku · 27 sonnet · 4 opus = 34.

Per-task model choice (v3.6.0, `model-router` skill): the declared model above
is each role's DEFAULT and FLOOR; the router may pick a cheaper model for a
mechanical sub-task or spend up for a genuinely hard one, automatically, within
that floor — cost stays a decision, now per task, not only per role.
