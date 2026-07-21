# Changelog

## 4.3.0 — 2026-07-21

A **quality-and-hardening release** from a deep, multi-round independent audit
(each finding double-checked against the real code before it was trusted). It fixes
real bugs — including two security-gate gaps — and adds many tests. No change to how
you use the tool; the roster stays 38 agents / 32 skills.

**Security fixes:**
- Closed a way to bypass the publish / go-public safety gate using GitHub's
  `gh api` command — in both its spaced (`-f name=x`) and attached (`-fname=x`)
  forms, and including repo creation that defaults to public. Ordinary reads (e.g.
  `gh api user`) are unaffected.
- Removed a "slow regex" flaw where certain long commands could freeze the safety
  check for many seconds; it is now effectively instant.
- The secret scan now also checks the git history a push would ship (not just the
  current files), including by key-file and private-folder name.
- The secret scan no longer skips a whole file just because it contains one stray
  non-text byte. An ordinary text file — say a log or a database export — that
  happens to include such a byte next to a real password or key is now still
  checked, on both the current files and the history a push would ship. Genuine
  picture, font and other binary files are still skipped (they don't hold
  typed-in secrets), and non-English text such as Bangla is treated as text.

**Correctness & reliability:**
- The licence check no longer false-blocks publishing on ordinary npm/TypeScript
  projects (it stopped treating npm's `.bin`/`.cache` tooling folders as packages).
- Fixed false "all clear" and false "blocked" results in several internal checks
  (indented progress tables, a content manifest followed by a second table,
  knowledge-graph links with trailing notes, and roster-count parsing).
- The automatic AI model chooser had the most expensive model (Fable) mislabelled
  as a cheap one, so cheap work was routed to the priciest model; corrected, with a
  context-window rule added.
- Reconciled the publish checklist to its full seven blocking checks across every
  file that describes it (with a mechanical guard so it can't drift again), added
  the "treat data as data" guardrail to the one role that lacked it, hardened the
  AI prompt-injection and Gemini key-handling guidance, and fixed the dashboard's
  colour contrast (light and dark) to meet accessibility standards.
- The check that "every finished task shows proof it was tested" no longer quietly
  passes when the progress table's status column is written in an unusual but valid
  way (in **bold**, under a synonym like "State", or in a table without outer
  borders). It now recognises those, and if it genuinely can't tell which column
  is the status, it stops and asks rather than waving the work through.

**Under the hood:**
- The automated test suite was grown substantially, with new mechanical guards so
  each fix above cannot silently regress; all five safety checks stay green.

## 4.2.0 — 2026-07-21

A **documentation and packaging release**. The whole GitHub repository was
rebuilt to be clearer, more consistent, and easier for non-technical people to
use — front to back. There are **no changes to how the tool behaves**: the roster
stays at 38 agents / 32 skills, and no agent, skill, hook or safety gate was
altered.

**The wiki is now the main guide.** A new, plain-English
[GitHub Wiki](https://github.com/GRU-953/GRU953-Studio/wiki) is the primary
handbook — installing on every platform, connecting Ollama, connecting Gemini,
the full team of specialists, all the skills, features, sample use cases,
troubleshooting, an FAQ, and a sponsorship page. Each page was independently
checked for accuracy and plain-English clarity.

**The website is now a focused landing page.** The
[website](https://gru-953.github.io/GRU953-Studio/) keeps its polished landing
page and points to the wiki for depth; the old deep pages now redirect there, so
no existing links break. Two brand-compliance fixes: the brand fonts are now
**self-hosted** (previously loaded from a third-party font service, which the
brand guidelines don't allow, and which also sent visitors' details to that
service), and the colours were aligned to the official GRU953 "Open Spectrum"
palette in both light and dark themes.

**The licence file is now the exact, official text.** `LICENSE` now contains the
verbatim, canonical PolyForm Noncommercial 1.0.0 text. The commercial-licensing
terms moved to a dedicated, friendly [COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md),
and [NOTICE](NOTICE) now explains honestly that GitHub may still label the licence
"Other" — because PolyForm isn't in GitHub's built-in licence catalogue, a display
limit on GitHub's side, not a fault in the file.

**Sponsorship and support.** A new "Sponsor" button (`.github/FUNDING.yml`) links
to a plain-English [Sponsorship](https://github.com/GRU-953/GRU953-Studio/wiki/Sponsorship)
page covering how to support the project or arrange a commercial licence. A new
[SUPPORT.md](SUPPORT.md) points people to the right place for help.

**Community files, tidied for newcomers.** The README was rebuilt as a clear
front page. `SECURITY.md` gained a stronger plain-English opening (with a clear
"non-technical users need only the first part" signpost) and a currency note
bringing it up to date — with none of its honest technical detail removed. The
bug-report and feature-request forms are now guided, labelled forms that are
easier to fill in, with a helpful chooser linking to Discussions, the guide and
the security policy.

**Repository housekeeping.** A stale, already-merged working branch was removed,
and the repository's "About" details, topics and description were reviewed.

## 4.1.1 — 2026-07-19

A hardening, documentation and website pass over 4.1.0 — no new agents or
skills (roster stays at 38 agents / 32 skills); every change below is a bug
fix, a clarity improvement, or new documentation/website content.

**Real bugs fixed, found by a deep multi-lens audit (with adversarial
verification against the live code, not just review):**
- `traceability-check.mjs` — a composite task id like `P1-T3` was silently
  split into two separate ids (`P1`, `T3`); an unrelated bare `T3` elsewhere
  could then collide with and overwrite the composite's entry, hiding real
  scope creep from the reverse (untraced-task) check. Now matched as one
  token.
- `hooks/lib.mjs` — bash's scalar append-assignment (`NAME+=value`) was not
  resolved at all, so a push or go-public command built up this way (e.g.
  `p=pu; p+=sh; git $p origin main`) bypassed both the push gate and the
  private/public separation guarantee. Now resolved like every other
  assignment form.
- `content-check.mjs` — the media/alt-text check matched only English
  keywords (image/audio/video/…), so a `CONTENT.md` row written in Bangla
  (e.g. `ছবি` for "image") silently skipped the mandatory alt-text check.
  Inverted to fail closed: alt-text is required unless a row is explicitly,
  recognisably marked TEXT (English or Bangla).
- `memory-integrity.mjs` — node/link ids and "does this look like a real
  path" checks were ASCII-only, so a punctuated id (`T1.a`), a Bangla node
  id, a bare non-ASCII filename, or a markdown-link-formatted `INDEX.md` cell
  were silently skipped from validation even when genuinely dangling/stale.
- `quality-gate.mjs` — the Definition-of-Done table parser swept rows from
  *every* Item+Status-shaped table in the file, so an unrelated later table
  (e.g. a backlog list) could leak a spurious row into a required
  dimension's matching. Now reads only the first, intended table.
- `session-start.mjs` — an ephemeral-environment env-var check treated any
  non-empty string (including the literal text `"false"`) as true; now
  compares against a real truthy value. This file also had zero test
  coverage before this release; it now has six locked-in tests.
- Two `lang-*/SKILL.md` packs (Kotlin, Java) overclaimed that
  `licence-scan.mjs` reads Gradle/Maven manifests; corrected to the same
  honest best-effort/INCOMPLETE wording already used for C++/Swift/Go/.NET.
- `ux-designer.md`/`technical-writer.md`/`text-content-specialist.md` had
  drifted out of sync on who owns final in-app button/error/empty-state
  wording (introduced when the Content team was added in 4.1.0, never
  reconciled). Now explicit: `ux-designer` drafts placeholder wording while
  shaping the flow; `text-content-specialist` supplies the final, shipped
  bilingual copy.
- A handful of unexplained acronyms (MCQ, RFC, TDD, FOSS, LLM) expanded on
  first use, per the project's own plain-English tone rule.
- 18 new regression tests added alongside these fixes and to lock in
  already-correct edge cases (117 → 135 behavioural tests, all pass).

**Documentation & website (new):**
- `README.md` rewritten as a full product description and user guide:
  installation through every sample use case, the complete team, features
  and skills, in plain UK English.
- A new [GitHub Pages website](https://gru-953.github.io/GRU953-Studio/) —
  a marketing landing page plus a non-technical guide, agents/skills
  directories, an expanded use-case gallery, an FAQ and a troubleshooting
  page — built from the project's real "Open Spectrum" brand palette and
  typefaces, in both light and dark themes.
- `SECURITY.md` gains a short plain-English "at a glance" summary; the
  legal/policy documents (`LICENSE`, `governance/GOVERNANCE.md`,
  `CODE_OF_CONDUCT.md`) were reviewed and kept as-is — their terms were
  already clear and are unchanged.
- `plugin.json`/`marketplace.json` keywords extended to reflect 4.1.0's new
  capabilities (content-creation, gemini, bangla, prototyping,
  command-centre).

## 4.1.0 — 2026-07-19

Adds a **Content Creation** capability so the studio produces the app's real
content, not just the shell, and completes **native coverage of every target
platform**.

**All-platform language specialists (roster 34 → 38).** Four new specialists +
`lang-*` packs — `swift-developer` (iOS/macOS), `csharp-developer` (Windows/.NET,
cross-platform), `go-developer` (services/CLI/Linux), `typescript-developer`
(web, React Native/Electron/Node) — so Android, iOS, macOS, Windows, Linux and
web each have a distinct-ecosystem native owner, with Flutter the cross-platform
default. `architect` gains an explicit platform → stack map; `licence-scan.mjs`
detects SwiftPM, .NET and Go (best-effort, honestly INCOMPLETE; TypeScript is
npm, already scanned). The INV11 language-pack contract keeps all ten packs
honest.

**New: Content stage + team (roster 29 → 34).** After the approved prototype, a
new **Content** stage (`content-creation` skill) plans and generates the app's
content from the spec + warframe, before Build consumes it. Five new agents:
`content-director` (plans content, owns the manifest and the media opt-in),
`text-content-specialist` (in-app copy & microcopy in **Bangla + English** via
Claude), and `image-`/`audio-`/`video-content-specialist` (media via Gemini).
Content is recorded in `Dev-Memory/CONTENT.md` with provenance, approval, rights
and alt-text, and woven into the phased build.

**New: `gemini-integration` skill — the studio's first external cloud service,
handled with care.** Opt-in only; the **user's own Google API key** (never
stored or committed — `scan.mjs` already blocks `AIza…` keys); models referenced
**by capability + a small dated registry** (image/video/audio → current model,
verified before use) so it stays correct as Google renames things; a plain-
English **cost estimate + "sent to Google" notice + approval before every
generation**; generation via REST/CLI (**no bundled SDK**, so "no third-party
code dependencies" still holds); and **graceful degrade** with a step-by-step
guide when a key/network is absent or a human must supply an asset.

**New: `content-check.mjs`.** Before Publish, every asset in `CONTENT.md` must
carry a recorded approval, provenance, a rights/licence note, and — for media —
alt-text/caption; unattributed or unapproved content blocks the release. Added
to the security auditor's Publish gate (now **seven** blocking checks). No-op on
a project with no declared content.

**Model router extended to content + media.** The one automatic router now also
picks/switches content models + effort — Claude tiers for text, the Gemini
capability registry for media — cost-ceiling-aware, with media still passing the
per-generation approval. `cost-monitor` logs media spend. Accessibility and
brand review, and the `reviewer` parity check, extend to content; the dashboard
gains a **Content** section.

9 new behavioural tests across both additions (108 → 117, all pass).
`repo-integrity` clean (**38 agents, 32 skills**, 20 hooks, 9 commands); roster
and licence green. (2026-07-19 audit fix: this line previously stated only the
content-team addition's own subtotal — 34 agents, 28 skills, 108→114 — and
omitted the language-specialist addition described above it in this same
entry, understating this release's real final state.)

## 4.0.0 — 2026-07-19

Phase 5 (final) of the staged programme: **brainstormed hardening**, and the
milestone release that completes the programme (features 0–10). Several Phase 5
ideas already shipped in earlier phases — the model-router audit ledger
(`cost-monitor`, 3.6.0) and the warframe→build parity check (`reviewer`, 3.8.0).
This release adds the rest.

**New: INV11 language-pack contract (`repo-integrity.mjs`).** A `lang-*` pack
cannot land unless it declares all five standard command families (build, test,
lint, format, deps) — so a native language can never ship half-wired, the same
way a new agent cannot land without a roster entry. Locked in by a test.

**Resume rehearsal on cloud.** The pre-Publish "prove the memory folder alone is
enough to resume" rehearsal now, on a cloud session with persistence enabled,
additionally proves the *branch-persisted* memory rehydrates a fresh container —
not just the soon-to-be-wiped local copy.

**Scheduler safety.** A fired "schedule for later" resume is treated as a fresh
session with no standing push/publish authorisation — every auth token is
60-minute TTL and long expired by the time a later schedule fires, so a
scheduled wake-up can never silently push or publish.

**Dashboard as publish snapshot.** At Publish, generating the dashboard once more
doubles as a human-readable record of the finished project (concept,
architecture, full plan, final task states).

1 new behavioural test (107 → 108, all pass). `repo-integrity` clean (29 agents,
26 skills, 19 hooks, 9 commands); roster and licence green.

**Programme complete.** Across 3.4.0 → 4.0.0 this delivered: the guardrail &
gold-standard spine (focus/drift/quality/traceability), the task command centre
+ HTML dashboard, indexed knowledge-graph memory, the automatic model+effort
router, six native language specialists, the warframe Prototype stage,
MVP-then-phases building, per-phase backup checkpoints, and Claude Code on the
web support — each phase committed with all gates green.

## 3.9.0 — 2026-07-19

Phase 4 of the staged programme: **Claude Code on the web / cloud support**
(feature 2).

**New: `session-start.mjs` SessionStart hook.** On any surface, when a session
starts inside a studio project it injects a reminder to run the `focus-guard`
re-orientation ritual and recall via the `memory-graph` protocol — so a resumed
project picks itself back up automatically. It stands down silently outside
studio projects, and adds a cloud/persistence note when the environment looks
ephemeral. Wired into `hooks.json` under `SessionStart`.

**Opt-in cloud memory persistence — private-only, still secret-scanned.** On
Claude Code on the web the container is reclaimed between sessions, so
Dev-Memory would be lost. The studio can now (only if the user opts in for the
project) persist Dev-Memory to a **private branch** so resume survives. The
safety envelope is the narrowest possible relaxation of the "Dev-Memory never
ships" guard:

- A distinct project-bound `MEMORY-PERSIST-APPROVED` token
  (`confirm-memory-persist.mjs`) tells `scan.mjs` not to block purely on a
  Dev-Memory path — but `scan.mjs` **still runs its full secret scan** on those
  files, so a secret in memory is blocked exactly as before.
- `gate.mjs` accepts the token for an ordinary (private) push only; it is
  checked after the go-public gate and never satisfies it, so persisted memory
  can **never** reach a public repository.
- Desktop sessions are unchanged — Dev-Memory stays strictly local. The product
  Publish path is unchanged (still deletes Dev-Memory, ships a clean orphan
  commit).

**Graceful degrade.** Ollama-dependent features (local second opinion, optional
semantic re-rank) **self-disable with a plain note** on cloud/ephemeral sessions
rather than failing, and the studio prefers the session's available GitHub tools
where a local `gh` CLI is absent. README/`dev-memory`/`memory-keeper`/
`ollama-integration` updated for web support.

5 new behavioural tests (102 → 107, all pass), including the two critical
guarantees: a secret inside Dev-Memory is still blocked under the persist token,
and the persist token never authorises going public. `repo-integrity` clean (29
agents, 26 skills, 19 hooks); roster and licence green. Version 3.8.0 → 3.9.0.

## 3.8.0 — 2026-07-19

Phase 3 of the staged programme: the **warframe Prototype stage**, the
**MVP-then-phases roadmap**, and **per-phase backup checkpoint commits**
(features 5, 6, 7).

**New: `warframe-prototype` skill — a real Prototype stage.** Between Design and
Plan, `ux-designer` + a `builder` produce a **self-contained clickable HTML
warframe** (a wireframe prototype — all inline, no external calls) plus the
phased build plan, and the Project Lead runs a **hard, blocking approval gate**:
no implementation code is written until the user approves both. A pure
CLI/library gets a text walkthrough instead. The approved warframe is the
reference the built MVP is checked against at Review (a new `reviewer` parity
step flags silent drift).

**New: `phased-roadmap` skill — MVP first, then progressive phases.** The design
becomes Phase 1 (MVP core only), then Phase 2…N (enhancements in priority
order); `PLAN.md`/`PROGRESS.md` gain a **Phase** column. YAGNI is unchanged — a
phase's code is built only when that phase is active, nothing scaffolded ahead.
Each phase is independently shippable and ends in a clean, backed-up boundary.

**New: `checkpoint-commit` skill + `confirm-checkpoint.mjs` — per-phase backup.**
At the end of each phase (once its `quality-gate` is clean and the secret/licence
scans pass), the app's code — never `Dev-Memory/` — is committed to a **private
work branch** and pushed, as a progressive offsite backup. The final Publish is
unchanged: still the separate, clean, confirmed release.

**Security: the publish gate now recognises a distinct checkpoint token.**
`gate.mjs` accepts a project-bound `CHECKPOINT-APPROVED` token for an ORDINARY
(private) push only. It is checked AFTER the go-public gate and never satisfies
it — so **a checkpoint can never make a repository public** (the guarantee that
matters most is untouched), and `scan.mjs` still blocks secrets and `Dev-Memory/`
on every push regardless of any token. `confirm-checkpoint.mjs` joins the
confirm-writers exempted from the push matcher (exact-basename only, so a chained
push after it is still caught). Four new gate tests lock the private-only and
never-public guarantees in.

5 new behavioural tests (97 → 102, all pass). `repo-integrity`, `roster` and
`licence` gates green. README skill count 23 → 26; version 3.7.0 → 3.8.0.

## 3.7.0 — 2026-07-19

Command-centre hardening (owner request): control states reflect into the
build plan, and the command centre presents the whole software — concept,
architecture, specifications and complete build plan — organised.

**Control states now reflect into the build plan.** A pause, stop, skip or
schedule is a real change to the plan of work, so every control command
(`/studio-pause|stop|skip|schedule`) now updates `PLAN.md` (the build plan) in
the same write as `PROGRESS.md` and `STATUS-BOARD.md` — the plan always shows
the true state (`paused`/`skipped`/`scheduled`, with any time) and its
next-actionable task is recomputed, so plan and board never drift and a skipped
task is set aside in the plan, never lost.

**The command centre surfaces concept + architecture + build plan, organised.**
`/studio-dashboard` (`hooks/dashboard.mjs`) now renders, in one self-contained
page: the **Concept** (`OBJECTIVE.md`), the **Architecture & specifications**
(`ARCHITECTURE.md`), the complete **Build plan** (`PLAN.md`, phases and all),
and the live task board — each document rendered by a small **safe** markdown
renderer (headings, tables, lists, inline code) that HTML-escapes everything, so
project text can never break the page or inject script, and the page still makes
no network requests. `/studio-status` now opens with what the app is and points
to the dashboard for the full architecture and plan.

New behavioural test for the organised sections and the renderer's escaping
(97 → 98). All gates green; version 3.6.0 → 3.7.0.

## 3.6.0 — 2026-07-19

Phase 2 of the staged programme: the **automatic model+effort router** and
**native language specialists** (features 4 and 3).

**New: `model-router` skill — the best model and effort per task, automatically.**
The studio now picks a Claude model (Haiku / Sonnet / Opus / Fable) and effort
level (low / medium / high / **xhigh** / max) per individual task, scoring five
signals (reasoning depth, reversibility, risk, breadth, creativity-vs-rigour)
and choosing the cheapest that reliably does the job. Each role's declared model
is the default and floor; the router escalates only where justified. It runs
**fully automatically and silently**, with the single exception of `cost-guard`'s
hard per-task cost ceiling, which still pauses for one unusually expensive task.
`cost-monitor` logs the model/effort actually used per task so a silent choice
stays reviewable. "Ultracode" is documented as the opt-in heavy multi-agent
mode, never entered silently. The router never raises model/effort to route
around a safety gate, and degrades to today's fixed tiers where a surface can't
set a subagent's model.

**New: six native language specialists + shared `lang-*` packs (roster 23 → 29).**
Dedicated agents — `flutter-dart-developer`, `kotlin-developer`, `rust-developer`,
`python-developer`, `java-developer`, `cpp-developer` — each carrying its
ecosystem's toolchain, idioms, testing and dependency norms that the generic
`builder` does not. Each stays thin by loading a shared `lang-*` skill pack
(the exact build/test/lint/format/dependency commands). `architect`'s stack menu
routes a chosen language to its specialist; `builder` still handles web/scripting
defaults, glue, and Build-Swarm coordination. Recorded as a named-gap roster
decision under `governance/GOVERNANCE.md` (owner-directed; owner is Maintainer +
Steering). All six are sonnet-tier implementers (3 haiku · 22 sonnet · 4 opus).

**`licence-scan.mjs` grows to five ecosystems + SPDX expressions.** Adds Rust
(Cargo — a real scan via `cargo metadata`'s SPDX `license` field), and
best-effort **not-checked** detection for JVM (Maven/Gradle) and C++
(vcpkg/Conan/CMake) — honestly surfaced as INCOMPLETE so a human runs the
ecosystem's own report, never a false pass. A new `classifySpdxExpr` correctly
handles dual licences: "MIT OR GPL-2.0" is usable (a permissive alternative
exists), "GPL-2.0 OR LGPL-3.0" is blocked (all copyleft), "MIT AND GPL-2.0" is
blocked.

9 new behavioural tests; `repo-integrity`, `roster` and `licence` gates green.
README role count 23 → 29, skill count 16 → 23; version 3.5.0 → 3.6.0.

## 3.5.0 — 2026-07-19

Phase 1 of the staged programme: the **memory & command-centre foundations**
(features 1, 8, 9), building on 3.4.0's guardrail spine.

**New: native command centre (`command-centre` skill + six commands).** Plan,
track and control work with a small, durable task state machine over
`PROGRESS.md` — the Status vocabulary gains `paused`, `skipped` and `scheduled`
alongside `todo`/`doing`/`done`/`blocked`. New commands: `/studio-pause`,
`/studio-resume`, `/studio-stop`, `/studio-skip`, `/studio-schedule`, and
`/studio-dashboard`. A live plain-English `STATUS-BOARD.md` gives the
at-a-glance picture. "Schedule for later" records the intent durably first, then
arms whatever scheduler the session offers — and says so honestly when the
environment has none, rather than promising a wake-up it cannot deliver. No
control command ever touches Publish or a push.

**New: self-contained HTML dashboard (`hooks/dashboard.mjs`).** `/studio-dashboard`
renders `Dev-Memory/dashboard.html` from `PROGRESS.md` — every task grouped by
status, colour-coded, with a summary bar and the board. A deterministic
generator guarantees the two hard rules: **no external network calls** (all CSS
inline) and every cell HTML-escaped so task text can't break the page or inject
script; the core table works with no JavaScript. It lives under the private,
never-shipped `Dev-Memory/`.

**New: token-cheap indexed knowledge-graph memory (`memory-graph` skill +
`hooks/memory-integrity.mjs`).** Recall now reads a compact machine-readable
`INDEX.md` first, then expands only the `GRAPH.md` knowledge-graph nodes the
current task touches (typed links: `implements`/`depends-on`/`relates-to`/
`supersedes`/`caused-by`/`blocks`) — least tokens by construction, with an
optional local Ollama semantic re-rank only when it is already present (never a
dependency). `memory-integrity.mjs` keeps it honest: no stale index path, no
dangling graph link. The session-start recall ritual and `memory-keeper` now use
this layer.

**Smallest-unit tasks + immediate record (`micro-task-planning`).** Micro-tasks
decompose to sub-tasks (`T3.1`, `T3.2`), each still a provable unit with one
acceptance criterion and one command; and the moment a task or sub-task is
verified `done`, progress, lessons and the recall layer are recorded before the
next task starts — never a batch saved for later that goes missing when a
session ends.

New behavioural tests cover both new hooks; `repo-integrity`, `roster` and
`licence` gates stay green. README skill count 14 → 16; version 3.4.0 → 3.5.0.

## 3.4.0 — 2026-07-19

Phase 0 of a planned, staged programme: the **guardrail & gold-standard
spine** for long, multi-session, complex builds — the backbone that stops
Claude and the team losing focus or drifting off the agreed target over
time. Built first, before the rest of the programme, so every later phase
and every user project inherits it. All gates fail closed.

**New: `focus-guard` skill.** The anti-drift half of a gold-standard result
(code quality is only the other half). Adds `Dev-Memory/FOCUS.md` — a tiny,
always-current one-glance anchor (objective, active phase, active task, top
constraints) rewritten in place — read first at every session start and
stage boundary, with an explicit "restate the single active goal" step, so a
summarised or brand-new session rehydrates from the memory files rather than
lost chat history. Adds a per-task **drift check** (a task must trace to a
confirmed requirement and the approved plan, or it goes to `scope-guardian`,
never silently built) and `Dev-Memory/REQUIREMENTS.md`, a two-way
traceability matrix.

**New: `quality-gate` skill + `hooks/quality-gate.mjs`.** A codified
Definition of Done — acceptance criteria, tests, independent review,
security/licence/privacy, accessibility, documentation, and a reproducible
build — recorded per phase in `Dev-Memory/QUALITY-GATE.md` and mechanically
enforced before every backup checkpoint and before Publish. Its one
gold-standard rule: a dimension may be marked *not-applicable with a reason*
but never silently omitted — the required list lives in the hook, so
deleting a row BLOCKS rather than passes. Fails closed, because a false
"clean" is worse than a false block: nobody re-checks a green result before
shipping.

**New: `hooks/traceability-check.mjs`.** Audits `REQUIREMENTS.md` both ways —
every confirmed requirement maps to at least one task (nothing agreed is
dropped) and, when `PROGRESS.md` carries a task-id column, every task traces
back to a requirement or is explicitly marked `[chore]`/`[infra]` (nothing
unagreed is built). Where it cannot run the reverse check it says so, never a
false pass — the same honesty `licence-scan.mjs` uses for an ecosystem it
cannot inspect.

**New: anti-derail loop guard.** `self-healing` gains a repeat-failure
detector: the 2-attempt ceiling bounds a single failure; this bounds a
recurring one — a task that keeps coming back after being "fixed" escalates
to the user as a systemic pattern rather than looping through another quiet
round.

**Progress-honesty rule** stated at the coordinator level: never report a
task or phase complete without its evidence; a failure, a skip, or a check
that could not run is stated plainly, never softened.

Wired through the load-bearing roles — `project-lead` (the re-orientation
ritual), `memory-keeper` (owns the three new files), `scope-guardian` (the
drift check and traceability script), and `security-compliance-auditor`
(now six blocking pre-Publish checks, adding the Definition-of-Done and
traceability gates). New behavioural tests lock every hook's logic in; the
repository-integrity, roster, and licence gates stay green.

## 3.3.0 — 2026-07-17

Self-healing, plus six small refinements found by a bounded, fact-checked
gap-research pass. A pop-up interview came first, since the raw request
("self-heal, publish each fix as new contributors, research and include
ALL relevant features") bundled a real safety-model question and a
pattern this project's own history has explicitly guarded against before
(a prior tool's roster grew 12→26 roles in a week with nothing ever
shipped). Confirmed: fixes never auto-publish (every push still needs an
explicit yes, no exceptions); attribution stays exactly as it's always
been (sole GRU-953 authorship); and the roster-growth research would
return a shortlist to choose from, not an unfiltered "add everything."

**New: `self-healing` skill, two parts.** (a) When a verification command
fails during Build/Test, `fixer` now gets up to 2 quiet attempts (no user
interruption) before the Project Lead's full Stuck Protocol — closing a
real gap where that hand-off depended entirely on `builder`/`tester`
remembering to do it. A new `PostToolUseFailure` hook
(`self-heal-nudge.mjs`) makes the reminder structural rather than
prose-only, using a plain command hook (Anthropic's own newer "agent"
hook type is explicitly documented as experimental, "prefer command hooks
for production" — this project's established pattern throughout). Before
a second attempt, `fixer` now reverts the first attempt's own changes via
plain `git` first (not Claude Code's own `/rewind`, which is an
interactive human menu a subagent cannot invoke — the same restriction
that already applies to `AskUserQuestion`). (b) `devops-engineer` can add
proportionate self-recovery to a live built app: crash auto-restart via
the hosting platform's own behaviour, bounded retry-with-backoff for
transient failures, every event logged — never a custom supervisor.
Self-healing never touches Publish or any push-capable action.

**Six small refinements from the gap-research pass**, all independently
fact-checked against Anthropic's own current docs before being built (one
research thread initially cited a folder path that had been reorganised
outside this session — caught, and re-verified from the real current
location before trusting anything downstream of it):
- `cost-monitor` can now show real spending figures (`cost.total_cost_usd`,
  and `rate_limits.*` for Pro/Max subscribers only — verified, not every
  billing plan gets this) instead of a rough transcript-size proxy, via a
  one-time opt-in that only ever adds to the user's own personal
  `~/.claude/settings.json` — never overwrites an existing `statusLine`.
- `tester` can capture a rendered screenshot before sign-off on
  Standard/Complex Tier UI projects, if a browser-automation tool happens
  to be available in that session — gracefully skipped otherwise.
- The plain-English/UK-English tone rule now has one clearly-marked
  canonical statement (`studio/SKILL.md`) other files point back to,
  instead of quietly-drifting duplicated prose. (A shipped `output-style`
  with `force-for-plugin` was considered and rejected — it would override
  the user's chosen style for their whole Claude Code session, not just
  while using GRU953-Studio.)
- A new `subagentStatusLine` (`settings.json` + `subagent-statusline.mjs`)
  shows a plainer line for GRU953-Studio's own specialists specifically,
  leaving every other subagent's row at the platform default.

`hooks.test.mjs` stays at 63/63; `repo-integrity.mjs` now reports 23
agents/12 skills/12 hooks, clean; `roster-check.mjs`/`licence-scan.mjs`
clean; `claude plugin validate --strict` clean for both the plugin and
the marketplace.

## 3.2.0 — 2026-07-17

A feature release adding two new abilities, both user-requested.

**New: `micro-task-planning` skill.** Investigating the request surfaced a
genuine pre-existing gap: `builder.md`/`tester.md` both referenced "the
task's acceptance criteria" as something that already exists, but no file
ever said who produces it or where it lives. Closed properly rather than
patched around: `architect` now breaks a confirmed design into an ordered
list of small, independently-verifiable micro-tasks — each with one
acceptance criterion, the exact command that proves it, and its
dependencies — stated inline on Tiny Tier, recorded in the new
`Dev-Memory/PLAN.md` on Standard/Complex. "Sequential" means dependency-
correct ordering, not one-task-at-a-time-only: tasks with no dependency on
each other can still run together in the existing parallel Build Swarm —
`project-lead` reads the dependency graph to decide what runs together and
what must queue. `architect.md`, `builder.md`, `tester.md`,
`project-lead.md`, `studio/SKILL.md`, and `dev-memory/SKILL.md` all
updated so this is stated consistently everywhere a reader would look.

**New: `ollama-integration` skill.** Ollama (a free tool for running AI
models locally, no cloud needed) can now be used two ways: `ai-developer`
may offer it as an alternative to the Claude API for a built app's AI
feature (private, free to run, but slower and less capable — always an
offered choice, never the default), and several roles that already have
both `Bash` and `Skill` (`reviewer`, `security-compliance-auditor`,
`architect`, `builder`, `devops-engineer`, `publisher`) may use a local
Ollama model as an independent second opinion on their own work, the same
technique used once already this cycle (see the "quick post-v3.1.0
re-check" note in v3.1.1). Every technical detail — install commands per
OS, the OpenAI-compatible endpoint and its real gaps, non-interactive
model pulling, disk-space caveats — was verified 2026-07-17 against
Ollama's own documentation and GitHub repo via live research, not
assumed. Installing Ollama or pulling any model always requires an
explicit, fresh "yes" — every time, no exceptions, matching how every
other install-capable feature in GRU953-Studio already works.

`ai-developer.md` gained the `Skill` tool grant it was missing (needed to
actually load `ollama-integration`) — the same "subagent told to use a
skill/tool it wasn't granted" class of bug this project's audit history
has repeatedly caught, checked for directly this time before shipping
rather than after.

`hooks.test.mjs` stays at 63/63 (no push-safety changes this release);
`repo-integrity.mjs` now reports 23 agents/11 skills, clean;
`roster-check.mjs`/`licence-scan.mjs` clean; `claude plugin validate
--strict` clean for both the plugin and the marketplace.

## 3.1.1 — 2026-07-16

A patch, following a quick targeted re-check of v3.1.0 requested right
after it shipped (not another open-ended audit — the product has already
been through 15+ prior rounds). Two review passes ran independently: a
direct re-read of everything changed in v3.1.0, and a second opinion from
a locally-run AI model (Ollama, model `ornith:9b`) fed the full plugin
source and asked to find concrete, high-confidence issues only. Every
finding from both was independently verified by reading the actual files
before being treated as real — nothing was fixed on either report's word
alone.

**Fixed (found by direct re-read): a tool-grant mismatch in the new
`ecosystem-finder` skill.** It told `researcher` to run
`claude plugin list --json` to check what's already installed before
recommending anything — but `researcher` has no `Bash` tool and cannot run
any command at all, the exact class of bug this project's own audit
history has caught before ("subagents told to use tools they weren't
granted"). Fixed by having `builder` (which has `Bash`) run that check and
report back, matching the same recommend/execute split the skill already
used for the actual install step. `ecosystem-finder/SKILL.md`,
`researcher.md`, and `builder.md` all updated to state this consistently.

**Fixed (found by the local-model second opinion, independently
confirmed): README stated a stale "Latest version: 3.0.4"** in its own
version banner, while both `plugin.json` and `marketplace.json` — the
files Claude Code actually reads to identify the installed version —
already said 3.1.0. Rewrote the banner to state 3.1.0 correctly and
describe what's actually new in it, rather than just swapping the number.

**Fixed (same source, independently confirmed): `ROSTER.md` and README
disagreed on how Maintenance Agent is classified.** `ROSTER.md`'s "Core
roster" list (roles "most projects use") included `maintenance-agent`;
README correctly placed it under "brought in only when needed." Checked
`maintenance-agent.md`'s own description to settle which was right: it
activates only when returning to an already-published project, never on a
brand-new one — so README's classification was correct and `ROSTER.md`'s
was the stale one. Moved it to `ROSTER.md`'s feature-triggered table
(14 core + 9 feature-triggered, still 23 total) to match.

No behaviour change for anyone not yet using the two new v3.1.0 skills.
`hooks.test.mjs` stays at 63/63; `repo-integrity.mjs`/`roster-check.mjs`
still report 23 agents/9 skills, clean; `claude plugin validate --strict`
clean for both the plugin and the marketplace.

## 3.1.0 — 2026-07-16

A feature release, following a research pass into the wider FOSS Claude
Code ecosystem (superpowers, claude-mem, several skill/plugin "finder"
tools, and a broader sweep) to check what GRU953-Studio should adopt.
Nothing from that research was bundled — GRU953-Studio ships under one
licence, and mixing in another project's code (even a permissively
licensed one) would mean re-auditing someone else's code for security,
plus at least one candidate carried a copyleft licence that would create a
real conflict if ever copied in. Instead, two gaps the research surfaced
were built natively, and the file tree was reorganised to match regular
GitHub practice.

**New: `ecosystem-finder` skill.** When a task would clearly benefit from
an existing Claude Code skill/plugin GRU953-Studio has no native way to
provide, `researcher` can now recommend one — checking what's already
installed, preferring Anthropic's own vetted plugin lists first, only
searching further if nothing fits. Nothing installs without an explicit
"install it" from the user on a `project-lead` pop-up; `researcher` itself
has no `Bash` and cannot install anything, deliberately — `builder` runs
the confirmed install (`claude plugin marketplace add` /
`claude plugin install`) as a separate, later step. Distinct from
Anthropic's own built-in `/plugin > Discover` browsing feature (which this
does not replace or duplicate — it adds a task-aware recommendation layer
on top).

**New: `tdd-workflow` skill.** On Standard/Complex Tier, the Build stage
now writes one small test per task that must genuinely fail *before* the
Builder implements anything — inspired by an idea a FOSS tool called
"TDD Guard" enforces (not its code). Tiny Tier is unaffected, matching this
product's existing "no rigour where it doesn't earn its keep" reasoning.
`tester`, `builder`, and `studio/SKILL.md` all updated so this is stated in
every place a reader would look, not just one.

**File tree reorganised to match regular GitHub practice.** `LICENSE`,
`NOTICE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `SECURITY.md` moved
from a custom `governance/` folder to the repository root, where GitHub's
own licence-badge detector and Community Standards checklist actually look
— previously they lived in `governance/` for brand-structure consistency,
a deliberate trade-off documented at the time, now reversed on request.
Removed three now-redundant one-line redirect stubs that used to sit in
`.github/` pointing at the old `governance/` location. `governance/`
itself keeps `GOVERNANCE.md`, `LOGO-USAGE.md`, and `TRADEMARKS.md` — brand
and project-governance documents with no special GitHub recognition.
Every cross-reference across the repo (README, ROSTER.md, CI's own
required-files check, the plugin's `LICENSE` symlink, and others) updated
to match; verified with a fresh clone and the full local gate suite, not
just a search-and-replace.

**README refreshed** for the above: skill count restated (7 → 9), the
Researcher and Tester team-list entries mention their new capabilities in
one plain clause each, and a new "Other tools you might also find useful"
note credits three independent, well-licensed companion projects found
during the research (clearly marked as not affiliated with GRU953-Studio),
alongside a pointer to Claude Code's own `/plugin > Discover`.

`hooks.test.mjs` stays at 63/63 (this release adds capability, not push-
safety hardening); `repo-integrity.mjs`, `roster-check.mjs`, and
`licence-scan.mjs` all clean; `claude plugin validate --strict` passes for
both the plugin and the marketplace.

## 3.0.4 — 2026-07-13

A platform-compliance patch release (fixes and hardening only; no roster,
Tier, or workflow changes). A fresh 5-round audit checked every plugin
component — the 23 agent files, 7 skills, the hooks, the 3 slash commands,
and the manifests — strictly against Anthropic's own published Claude Code
documentation, using the real `claude plugin validate --strict` CLI and
by reproducing each issue before fixing it. Closed at the 5-round cap.
`hooks.test.mjs` grew from 61 to 63 tests.

**CRITICAL — a total publish-gate bypass via the `Monitor` tool**
(`hooks/hooks.json`, `hooks/repo-integrity.mjs`). The `PreToolUse` matcher
listed only `Bash|PowerShell`, but Claude Code's built-in `Monitor` tool
also runs shell commands, through the same `command` field and the same
Bash-style permission rules — so a push or a go-public command run via
Monitor bypassed both the secret scan and the publish gate entirely, with
no obfuscation and (unlike PowerShell) no opt-in needed. This is the same
class of gap as the previously-fixed PowerShell bypass. Fixed: matcher is
now `Bash|PowerShell|Monitor`, the `repo-integrity.mjs` INV10 check now
also requires Monitor coverage, and a regression test guards it.

**Agents silently loading with NO metadata** (`agents/accessibility-specialist.md`,
`agents/ai-developer.md`, `agents/responsible-ai-reviewer.md`). Each had an
unquoted mid-sentence colon in its `description:` frontmatter, which YAML
parses as an illegal nested key — so at runtime each of these three agents
loaded with empty metadata (no name, description, tool restriction, or
model pin), invisibly. Fixed by quoting the descriptions; caught and
confirmed with `claude plugin validate --strict`.

**Hook deny-reasons never reaching Claude** (`hooks/lib.mjs`). `deny()`
wrote its explanation as JSON to stdout and then exited with code 2 — but
Claude Code ignores stdout entirely on exit 2 (it reads only stderr), so
the tool call was blocked with an empty reason. Fixed to exit 0 with the
`permissionDecision: "deny"` JSON, the documented block pattern, so the
remediation text actually reaches Claude.

**Subagents told to use skills/tools they weren't granted.** Several agents
instructed themselves to "follow"/"apply" a named skill without `Skill` in
their `tools:` list (which is required to invoke a skill at runtime), and
`project-lead` — whose whole job is delegation — lacked the `Agent` tool
needed to spawn any subagent at all. Granted `Skill` where a role actively
invokes one (builder, reviewer, publisher, security-compliance-auditor,
cost-monitor, devops-engineer, architect, project-lead), and `Agent` to
project-lead; where a role has no `Skill` tool by design, the needed rule
text is now carried inline instead. `architect` also gained the specific
"zero-dependency options win ties" rule that the lean-coding skill assigns
it but it previously had no way to load.

**A licence path that broke on install** (`plugin.json`, new
`plugins/gru953-studio/LICENSE` symlink). The manifest pointed at
`governance/LICENSE`, which lives outside the plugin directory and so was
never copied into an installed copy. Fixed with a within-marketplace
symlink at the plugin root (the documented mechanism), which install
dereferences into place.

**Other fixes:** `gate.mjs` deny-messages no longer embed a literal
`${CLAUDE_PLUGIN_ROOT}` placeholder that wouldn't resolve if copied into a
fresh shell (the real path is interpolated instead); `publish-github` is
marked `disable-model-invocation: true` and `first-run`/`dev-memory` are
marked `user-invocable: false`, matching how each is actually used; a
stale platform claim in the `studio` skill description was corrected (a
same-named skill takes precedence over a command, and SKILL.md does
support `argument-hint`); the `repo-integrity.mjs` matcher check was
corrected to accept a comma as a valid separator (it is, per the docs);
and `memory-keeper.md` now carries its cross-project-memory safety
guardrail inline in full. The `marketplace.json` tag list was aligned with
`plugin.json`'s keywords, and `governance/SECURITY.md` documents the
Monitor fix.

## 3.0.3 — 2026-07-12

A security-hardening patch release closing a 15-round audit-loop engagement
run after v3.0.2 shipped, on the user's own question of whether further
audit was warranted. Every fix below was verified by direct execution
(real bash ground truth compared against the real `isPushCapable()`/
`gate.mjs`) before being called done — never trusted from a report alone.
`hooks.test.mjs` grew from 47 to 61 tests, one new regression test per
real finding.

**CRITICAL — bash variable-assignment/retrieval mechanisms bypassing the
push/go-public gate matcher** (`plugins/gru953-studio/hooks/lib.mjs`,
`hooks/gate.mjs`). Each of these, alone, made `isPushCapable()` return
`false` for a command that genuinely executes a push, which makes
`gate.mjs` `allow()` immediately — a complete, unconditional bypass of
every confirmation gate:
- Array assignment and subscript access (`arr=(pull push); git "${arr[1]}"`),
  including variable/arithmetic/bare-name/negative indices, array length
  used in same-command arithmetic (`i=${#arr[@]}; i=$((i-1))`), brace
  expansion inside array literals, and an ordering bug where `$IFS` inside
  a subscript was never normalised.
- `printf -v NAME VALUE`, including a value-capture bug that swallowed a
  trailing semicolon.
- Parameter-expansion defaults (`${VAR:-default}`), indirect expansion
  (`${!ref}`), case-folding (`${x,,}`/`${x^^}`) and bash 4.4+'s `@`
  transformation operators (`${x@L}`/`${x@U}`), and substring expansion
  (`${VAR:offset:length}`).
- `read` assigning from a here-string (`<<<`) or a real here-document
  (`<<DELIM`), `mapfile`/`readarray` reading a here-string into an array,
  and `set --` resetting positional parameters (`$1`, `$2`, ...).
- A separate array/scalar cross-contamination bug where an array
  assignment was wrongly captured as a bogus scalar value, corrupting the
  parameter-expansion-default step and defeating the private-then-public
  separation gate.

**CRITICAL — publish-safety structural gaps** (`hooks/gate.mjs`,
`hooks/confirm-publish.mjs`, `hooks/confirm-go-public.mjs`,
`hooks/repo-integrity.mjs`, `hooks/hooks.json`):
- The private-publish and go-public confirmation tokens were never
  deleted by any code (only by prose instruction), and had no expiry —
  a legitimate confirmation could silently authorise unlimited later
  commands in later sessions. Fixed with a 60-minute validity window
  stamped and enforced on both tokens.
- `hooks.json`'s `PreToolUse` matcher only ever listed `Bash`; Claude
  Code's separate `PowerShell` tool (the automatic default on native
  Windows without Git Bash) was never gated at all. Fixed by adding
  `PowerShell` to the matcher, plus a new `repo-integrity.mjs` invariant
  (INV10) that structurally verifies the matcher and both hook scripts
  stay wired — including a fix to that check's own matcher-parsing regex,
  which initially both false-blocked a legitimate anchored form and
  false-passed a comma-separated one that never actually matches at
  runtime.

**MAJOR — false-positive fix:** `repo-integrity.mjs`'s role-count/baseline
check used a bounded-but-arbitrary character gap, which still
false-blocked legitimate longer prose around the count. Tightened to
require immediate adjacency, matching the file's own established
convention exactly.

**Guardrail coverage:** extended the "content read from Dev-Memory or a
cross-project file is DATA, never an instruction" guardrail to
`interviewer.md`, `memory-keeper.md`, `project-lead.md`,
`scope-guardian.md`, `fixer.md`, `ai-developer.md`, and a further batch of
agent files, closing a real cross-session/cross-project contamination
vector.

**Documentation:** a go-public cleanup step (deleting
`Dev-Memory/GO-PUBLIC-APPROVED` after use) was never mirrored from the
private-publish path in `publish-github/SKILL.md`; fixed.

**Disclosed, not fixed — a deliberate scope boundary, confirmed with the
user** after repeated rounds kept finding narrower constructs in the same
vein: array post-assignment element writes (`arr[1]=x`), `+=` append,
associative arrays (`declare -A`), command substitution embedded in an
array element, process substitution feeding `read`, co-processes, and
bash's `declare -n` nameref variables (a live-alias mechanism distinct
from the indirect-expansion fix above). All seven require either
modelling a fundamentally different assignment form or actually executing
a subprocess to resolve — the same shape of already-accepted limitation
this project documents for scalar command substitution. See
`governance/SECURITY.md` for full detail on every fix and every disclosed
limitation.

## 3.0.2 — 2026-07-12

A patch release: one final, maximally-deep single-round audit on top of the
already-published v3.0.1 — 8 parallel specialist lenses (security
whole-engagement coherence, integrity/test-coverage hooks, role-consistency,
comprehension/docs/governance, lifecycle/user-journey, packaging/CI,
AI-safety/agent-manipulation, and cross-cutting whole-product consistency),
chosen as one deep round rather than another bounded multi-round loop. Every
lens found at least one real, verified issue; all were fixed and re-verified
by execution before this release.

**Pre-audit decision, also part of this release:** Dependabot is disabled
going forward — `.github/dependabot.yml` removed — to stop future automated
dependency-bump pull requests on this small, stable public repo. No git
history rewrite, no force-push: contributor history (`GRU-953`, 9 commits;
`dependabot[bot]`, 2, from the two already-merged CI-action bumps) stays
exactly as it is. Confirmed no hook or CI check depends on the file
existing. Trade-off, consciously accepted rather than silently left
unstated: `actions/checkout`/`actions/setup-node` version bumps are now
fully manual, with no automated or scheduled reminder — GitHub Actions pins
don't silently break, they just age, and this is judged an acceptable
trade-off for a repo this size.

**Security (CRITICAL, live bypass, the most serious finding of this
round):** a declaration keyword (`export`/`declare`/`readonly`/`typeset`)
is itself a real command invocation, so its OWN arguments undergo bash's
normal command-line expansion — including brace expansion — before the
keyword ever sees them. `export v={private,public}` does not assign the
literal text `{private,public}`; bash expands it into two arguments,
`v=private v=public`, and the keyword applies them left-to-right with the
LAST one winning (confirmed live via `bash -x`). The push-safety matcher's
same-command variable-substitution feature (added in the prior 5-round
engagement) captured the raw, un-expanded value instead, producing
`--visibility=private public` — which no longer matched the go-public
gate's regex, letting `export v={private,public}; gh repo edit me/app
--visibility=$v` through with only the private-publish token recorded.
Reproduced end-to-end via the real `gate.mjs` before fixing; fixed by
resolving an embedded brace list (or degenerate range) to its real,
bash-effective last-write-wins value specifically for keyword-prefixed
assignments — the bare, no-keyword form was confirmed live to be a
different, already-safe case and was deliberately left untouched. 1 new
regression test added — `hooks.test.mjs` is now 47/47.

**Also fixed, all found by direct execution, none taken on a report's
word alone:**

- `roster-check.mjs`/`repo-integrity.mjs`'s `role count`/`baseline` regex
  had an unbounded gap to the first digit, so a plausible prose edit
  mentioning an earlier, unrelated number could misread the wrong count
  (a false-block, the safe direction, but citing the wrong number). Bounded
  the gap to the real phrasing's actual shape.
- Tiny-tier projects with an AI/LLM feature had no independent check that
  `ai-developer`'s guardrails actually shipped — only its own self-report,
  since `reviewer` isn't woken on Tiny either. Extended
  `security-compliance-auditor`'s guardrail-presence check to every Tier,
  matching how its other four checks already work universally.
- `fixer.md` and `memory-keeper.md` both carried a stale explanation of an
  apparent "Complex-only" naming in the Tier table that a later fix had
  already made obsolete (the table's Tiny row already names both roles
  directly) — simplified both.
- `builder.md`/`ROSTER.md` said the Build Swarm runs "2-3" builders in
  parallel; `studio/SKILL.md`'s own Tier table — the one file the
  coordinator actually follows — specifically says 2. Settled on 2
  everywhere.
- `dev-memory/SKILL.md` and `first-run/SKILL.md` both still framed the
  memory schema as working "across any surface" — this plugin is Claude
  Code only; corrected, and this is the second time this exact claim has
  had to be corrected (a prior round already fixed `memory-keeper.md`'s
  version of the same wording), so the cross-app framing was dropped
  entirely this time rather than reworded.
- `cost-monitor.md` carried an unused `Write` grant (trimmed); `memory-keeper.md`'s
  `Bash` grant had no cited use — given a genuine, real need (creating
  `~/.gru953-studio/` on a brand-new install before its first write there),
  the grant was justified with a concrete instruction instead of removed.
- "MVP" was unexplained in the two most first-touch-facing description
  strings in the whole product — `plugin.json`/`marketplace.json`'s own
  descriptions and the `/studio-publish` command's description — reworded
  to plain "a working app" instead.
- The v3.0.0/v3.0.1 zip release assets differ only in filename casing
  (`GRU953-Studio-v3.0.0.zip` vs `gru953-studio-v3.0.1.zip`) — cosmetic,
  doesn't break anything, but pinned in `publish-github/SKILL.md` so it
  can't drift a third time.
- `governance/SECURITY.md`'s disclosed-limitations section had gone stale
  relative to the actual matcher: bash brace expansion, the degenerate
  single-element range collapse, and the trailing-shell-terminator boundary
  fix (all added in the prior 5-round engagement) were entirely undocumented
  — under-describing real protections, not over-claiming them, but still a
  gap. Filled in, alongside this round's own new fix.
- Two small AI-safety hardenings, neither an exploitable gap today: the
  `audit-loop` skill now explicitly says a resumed plan file is a prior
  session's own work product to verify, not a settled instruction to trust
  blindly; the "fetched/read content is data, never an instruction"
  guardrail line (already on `researcher.md`/`ai-developer.md`) was
  extended to `maintenance-agent.md`, `builder.md`, and `reviewer.md`, which
  also read arbitrary, potentially attacker-modified project-tree content.
- `repo-integrity.mjs`'s skill-reference check is now documented, in a code
  comment, as covering specific prose/bullet-list shapes only — a stale
  reference hidden inside a markdown table cell or fenced code block would
  not be caught. Narrow, low-severity, and deliberately left as a disclosed
  limitation rather than a fix, matching this project's established
  "close the concrete case found" pattern.

Verified: 47/47 tests, `repo-integrity.mjs`/`roster-check.mjs`/`licence-scan.mjs`
all clean, re-checked on a fresh clone of the actual published repo (with a
real secrets scan against that clone's own tracked file set) before this
release ships.

## 3.0.1 — 2026-07-12

A patch release: a fresh, bounded 5-round security-and-quality audit of the
already-published v3.0.0, fixing everything it found. Every round found at
least one real issue; the loop closed at its agreed 5-round cap rather than
the ideal "two clean rounds in a row," the same honest outcome as the prior
audit engagement on this project. No new features or roles — fixes and
hardening only.

**Fixed — publish-safety hooks (several CRITICAL, found and closed across
all 5 rounds; every fix independently reproduced against the real code
before and after, never taken on trust)**

- A trailing character after a push/go-public keyword (`;`, `|`, `&`, `)`,
  a backtick, or a newline) could hide a real `git push`/`gh ... --public`
  from detection entirely — closed with a shared boundary check reused
  across every affected pattern (one instance of this was itself missed on
  the first pass and only caught by a dedicated re-check round, then fixed).
- Bash's `{git,push}`-style shortcut syntax (brace expansion) was not
  recognised at all, letting a disguised push slip through completely
  unchecked — closed by expanding this shortcut before checking.
- A follow-on bypass of the fix above: a variable set earlier in the same
  command (`t=t; {gi$t,push}`) could still hide the keyword. Closed with a
  narrow, same-command-only variable resolver — not a general shell
  interpreter, deliberately bounded in scope.
- A further re-check of that variable resolver found it could still be
  defeated by common prefixes (`export`, `local`, `readonly`, `declare`,
  `typeset`), by a two-step variable chain, by a bash "single-item range"
  shortcut (`{s..s}`), and — the most interesting of the whole exercise — a
  subtle bug in how the fix used a built-in JavaScript text-replacement
  feature, unrelated to shell tricks at all. All closed and independently
  verified.
- A narrower rule (spotting a script pretending to be something safe) was
  too easily fooled by ordinary punctuation after the script name, and
  separately blocked some perfectly normal read-only commands that merely
  mentioned a script's name without running it — both fixed.
- One further technique (spelling out a command letter-by-letter via a
  `printf` call) is real but sits inside an already-accepted, clearly
  out-of-scope category — closing it fully would mean this safety check
  actually running shell commands to see what they do, which is not what a
  fast, lightweight check like this is built to do. Documented plainly in
  `governance/SECURITY.md` instead of pretending it's closed.

**Fixed — internal quality checks**

- The dependency-licence checker silently ignored a package it couldn't
  read instead of flagging it for a human look.
- The internal consistency checker missed a broken reference in the
  studio's own main instruction file, and could crash instead of reporting
  cleanly on a corrupted file.
- The role-count checker sorted dates incorrectly in a way that could
  either hide or wrongly flag a legitimate roster change.
- The progress-tracking checker had two bugs: one that could wrongly block
  a perfectly normal in-progress task, and one that could wrongly wave
  through a task that had actually documented its own failure.
- 16 new automated regression tests added (30 → 46) so none of the above
  can silently reappear.

**Fixed — navigation, wording and first-time-user experience**

- The studio's own nine-stage roadmap named a stage ("Update") that no
  file anywhere actually defined — renamed to "Review," matching what
  genuinely happens there, and clarified that smaller ("Tiny" tier)
  projects fold this into the tester's own checks rather than leaving it
  unowned.
- The publishing instructions were missing a safety check that other files
  already assumed was in place.
- The status-report command promised to state a project's size-tier but
  was never told to read the one file that actually records it.
- The one-off first-time setup asked for a GitHub username with no
  "I'll do this later" option for someone who doesn't have an account yet;
  and "GitHub handle" was replaced with the plainer "username" throughout,
  to match the README's own wording.
- Several smaller wording and cross-reference fixes (a miscounted check
  list, a stale CI-tool-version note, a contributor-guide example that
  accidentally contradicted its own advice).

## 3.0.0 — 2026-07-11

A golden release: fixes a real shipping bug that failed CI, closes a
critical publish-safety bypass found in Round 5 of the audit loop, and
consolidates the specialist roster from 31 to a leaner, genuinely
non-overlapping **23**. The roster change is why this is a MAJOR version —
eight role names no longer exist.

**Fixed — CI / a real shipping bug (every release since v1.0.0 was affected)**

- The `dev-memory` **skill was never actually published.** `.gitignore`'s
  `Dev-Memory/` line (meant for a project's private working-memory folder)
  also matched the plugin's own `plugins/gru953-studio/skills/dev-memory/`
  skill folder case-insensitively on macOS (`git core.ignorecase=true`), so
  git silently never committed it. On a clean Linux CI checkout the plugin
  had 5 skills, not the 6 the README and five files reference, and
  `repo-integrity.mjs` correctly failed. Fixed by root-anchoring the ignore
  rule to `/Dev-Memory/` and committing the skill. The published plugin now
  actually contains its memory skill.
- The secret scanner (`scan.mjs`) had the **same case bug**: its
  `DEVMEMORY_RE` used a case-insensitive flag, so once the `dev-memory`
  skill was committed the scanner flagged it as the private `Dev-Memory`
  folder and would have blocked every push of the plugin itself. Made the
  match case-sensitive to the canonical `Dev-Memory` name.
- Cleared the CI "Node.js 20 is deprecated" warning (bumped
  `actions/checkout` and `actions/setup-node` to v5, Node 22). (Note, added
  2026-07-12: Dependabot has since bumped these further, directly on
  GitHub, to `actions/checkout@v7` and `actions/setup-node@v6` — the
  currently committed `ci.yml` reflects that, not the v5 this entry
  originally described.)

**Fixed — publish-safety (Round 5 of the audit loop, CRITICAL)**

- `gate.mjs`'s go-public check (`isGoPublicCommand`) matched **raw,
  un-normalized** command text, so every obfuscation the push detector was
  hardened against over four rounds — quoted flag values
  (`--visibility="public"`), `$IFS` word-splitting, quoted tokens
  (`"gh" repo edit`) — sailed past it. With only a private-publish
  confirmation recorded, an obfuscated "make it public" command was allowed
  with no go-public confirmation at all, defeating the private-then-public
  guarantee. Also, `isPushCapable`'s `gh` rules themselves required the
  literal unquoted word `gh`, so a quoted `"gh"` was not even seen as
  push-capable. Both fixed: the go-public check now normalizes the command
  the same way and both tolerate quotes/`$IFS` around every token; verified
  live and locked in with regression tests (suite now 22 tests, all green).

**Changed — roster consolidated 31 → 23 (BREAKING)**

On the owner's explicit instruction to remove overlap and make every role
unique, eight roles that overlapped another or created an artificial
hand-off were merged into the role that already owned the adjacent work:

- `prompt-engineer` and `mlops-engineer` → **ai-developer** (it now owns the
  prompt, the integration, the guardrails, and a repeatable quality check).
- `qa-lead` → **tester** (test strategy + execution in one role).
- `sre-observability` → **devops-engineer** (deploy + live-running
  reliability in one role).
- `release-manager` → **publisher** (versioning + release notes + the push).
- `cut-recorder` → **scope-guardian** (it decides a cut and records it).
- `project-assistant` → **memory-keeper** (the task table/logs it tidied are
  Dev-Memory files memory-keeper already owns).
- `privacy-dpo` → **security-compliance-auditor** (one pre-publish
  compliance gate covering security AND personal-data/privacy).

`responsible-ai-reviewer` was kept deliberately separate from `ai-developer`
(independent review, like `reviewer` vs `builder`). Every surviving role's
trigger is now distinct. See `plugins/gru953-studio/ROSTER.md` for the full
rationale. Anyone who referenced a removed role by name should use the
survivor it merged into.

**Rounds 6 and 7 of the same audit loop, before this release ships:**

- Two agent files (`reviewer.md`, `builder.md`) still instructed a hand-off
  "with the Cut-Recorder" — a role merged into `scope-guardian` above.
  Fixed to reference `scope-guardian`'s `UNBUILT.md` cut ledger instead.
- `technical-writer`'s own description claimed it writes "clear help/error
  text" while also stating it is distinct from `ux-designer` (which owns
  in-app wording) — self-contradictory, since in-app error/help text IS
  in-app wording. Narrowed `technical-writer` to standalone docs only.
- `project-lead.md` described itself as separate from "23 specialist
  roles" while being one of the 23 itself — an off-by-one that implied 24
  roles total. Reworded to avoid stating a count that has to be kept in
  sync by hand.
- Trimmed an unused `Write` tool grant from `scope-guardian` (it delegates
  the one write action it performs to `memory-keeper`, so it never uses
  `Write` directly).
- `governance/LOGO-USAGE.md` still named the superseded GRU953 Community
  Licence 1.0; corrected to the Polyform Noncommercial License 1.0.0 this
  repo actually ships under.
- `governance/CONTRIBUTING.md` and `CLAUDE.md` documented gate commands
  that didn't textually match what `.github/workflows/ci.yml` actually
  runs (a `--test` flag CI doesn't use; a bare `roster-check.mjs` invocation
  where CI passes explicit arguments) — functionally equivalent, but no
  longer worth a reader having to notice that. Made them match exactly.
- **Security (CRITICAL, found live): `normalizeForPushCheck`'s
  backslash-unescape only covered letters and digits**, so
  backslash-escaped PUNCTUATION (`gh repo edit me/app -\-public`,
  `--visibility\=public`) kept its backslash and slipped past the
  go-public regexes while bash resolved a real `--public` /
  `--visibility=public` flag — allowed with only the private-publish
  token recorded. Fixed by un-escaping a backslash before ANY character.
- **Security (CRITICAL, found live): ANSI-C quoting (`$'public'`) wasn't
  recognised at all.** Bash resolves `$'public'` to the literal text
  `public`, so `gh repo edit me/app --visibility $'public'` bypassed the
  go-public gate the same way. Reproduced directly (`x=$'public'; echo
  "$x"` → `public`) before fixing. Fixed by stripping `$'...'` to its raw
  content as the very first normalization step.
- `repo-integrity.mjs`'s README role/skill-count check used only the FIRST
  match anywhere in the file with no `/g` — a later, wrong count could hide
  behind an earlier correct one (false-clean), while an unrelated
  historical number could falsely block a correct README. Fixed to check
  every occurrence of the specific "N specialist roles"/"N skills" phrase
  consistently.
- `repo-integrity.mjs`'s INV9 crashed with an uncaught exception on a
  missing `marketplace.json` instead of reporting it — losing every other
  finding (including the real one) behind a raw stack trace. Fixed with a
  proper guard.
- `repo-integrity.mjs`'s frontmatter parser returned a quoted
  `name: "x"` value with the quotes still attached, which would have
  falsely failed a syntactically valid file. Fixed to parse quoted values
  like real YAML would.
- `verify-progress.mjs` required an exact `done` status cell, so a
  decorated `Done ✅` row with zero verified-evidence text was silently
  skipped — the exact failure mode this script exists to catch. Loosened
  to recognise "done" as the leading word, tolerating trailing decoration.
- Added 6 new regression tests for `repo-integrity.mjs`/`verify-progress.mjs`,
  which had zero test coverage before this round — `hooks.test.mjs` is now
  28/28, up from 22.
- `project-lead.md` described itself as separate from "23 specialist
  roles" while being one of the 23 itself. Reworded to avoid a count that
  has to be kept in sync by hand.
- Trimmed an unused `Write` tool grant from `scope-guardian` (it delegates
  its one write action to `memory-keeper`).
- `governance/LOGO-USAGE.md` still named the superseded GRU953 Community
  Licence 1.0; corrected to the Polyform Noncommercial License 1.0.0.
- `CLAUDE.md`/`governance/CONTRIBUTING.md` documented gate commands that
  didn't textually match what `ci.yml` actually runs; made them match.
- **Security (CRITICAL, the most severe bypass found across this whole
  loop): every `git`/`gh` regex matched literal, case-SENSITIVE text**, but
  the filesystems this plugin targets (macOS APFS, Windows NTFS) resolve a
  binary name via `PATH` without regard to case. `GIT push origin main` is
  not obfuscation — it is bash running the real `git` binary, unchanged.
  Reproduced live: with a real secret committed and ZERO confirmation
  tokens of any kind recorded, `GIT push origin main` was allowed by both
  `scan.mjs` and `gate.mjs`, while lowercase `git push origin main` was
  correctly denied — this defeated the matcher's very first check, for the
  plain push/repo-create/repo-edit cases themselves, not an edge-case flag
  value. Fixed by adding `/i` to every relevant regex in `isPushCapable`
  and `isGoPublicCommand`.
- **Security (CRITICAL): ANSI-C hex/octal escapes inside `$'...'` weren't
  decoded.** `$'pub\x6cic'`/`$'pub\154ic'` resolve to the literal text
  `public` in bash (the escape spells the letter "l"), and `$'\x67\x68'`
  resolves to `gh` — spelling the binary name itself. The Round 7 fix only
  stripped the `$'...'` wrapper without decoding what was inside it. Fixed
  by decoding `\xHH`/`\NNN` escapes before stripping the wrapper.
- Added 5 new regression tests for the case-insensitivity and ANSI-C
  hex/octal fixes — `hooks.test.mjs` is now 30/30.

**Round 9, a dedicated non-technical-comprehension pass plus an
agent-manipulation security pass — both genuinely new lenses, not
re-testing prior fixes:**

- README's install section had "click the links below" with no links to
  click, an unexplained "marketplace," and a bare `/path/to/...`
  placeholder with no real example — all fixable, all real for a total
  first-time user. Rewritten with concrete instructions and a worked
  example path for both Mac and Windows.
- The single highest-stakes sentence in the whole product — the
  "permanent and irreversible" private-publish confirmation — used the
  word "repository" without ever defining it anywhere in the product.
  Added a plain-English gloss at the one place this sentence is defined.
- No rule anywhere barred relaying a raw hook/tool error string (shell
  variables, file paths, code identifiers) to the user verbatim. Added an
  explicit rule to the Stuck Protocol: always translate, never relay raw.
- The Tier-assignment question "Does it integrate two or more external
  services?" used jargon a non-technical user answering the pop-up
  wouldn't necessarily know. Reworded in plain terms with an example.
- `publish-github/SKILL.md` had a stale cross-reference ("before step 2,
  not after it") left over from an earlier renumbering of the same list,
  and a resume-rehearsal instruction placed AFTER the four checks it says
  it must precede. Both fixed — the cross-reference now names the actual
  step, and the instruction moved to where it belongs.
- `dev-memory/SKILL.md` contradicted itself (and `project-lead.md` and
  `studio/SKILL.md`) about who reads Dev-Memory at session start — one
  passage said Project Lead reads "the single resume pointer... and
  nothing more," another said `memory-keeper` does the reading. Settled on
  one consistent story matching the other two files: Project Lead reads
  `PROGRESS.md`/`SESSION-LOG.md` tail/`INDEX.md` directly (the one narrow
  exception to its delegate-only rule), `memory-keeper` owns everything
  else.
- The agent-manipulation security pass confirmed a genuine PASS on the
  core guarantee — no skill or agent file lets a memory file's *claimed*
  approval substitute for a live `AskUserQuestion` answer on an
  irreversible action — but surfaced two real, bounded, disclosed-not-fixed
  limitations, documented in `governance/SECURITY.md`: the publish token is
  derived from a public formula and a non-secret path, so it proves "this
  file was written," not "a human clicked yes"; and the mandatory
  secrets-scan-before-memory-write rule has no `PreToolUse` hook backing
  it on `Write`/`Edit`, only prose (bounded — `Dev-Memory/` never ships
  regardless).

Verified: 30/30 tests, `repo-integrity.mjs`/`roster-check.mjs`/`licence-scan.mjs`
all clean, re-checked on a fresh clone of the repo before this release ships.

**Three new features, added on request, plus the Round 10-11 audit-fix
loop that followed:**

- **New skill: `audit-loop`.** A systematic, planned protocol for any
  review that needs more than one pass — plan the full set of risk
  dimensions and a bounded round budget (target 5 or fewer) before
  starting, dispatch a genuinely fresh panel each round, and always
  re-verify the immediately-previous round's specific fix with the SAME
  panel configuration that found it, alongside fresh exploration.
  Referenced from `reviewer.md`, `security-compliance-auditor.md`, and
  `studio/SKILL.md`. Distilled directly from this project's own 2026-07-11
  audit-fix loop.
- **Learning from mistakes, both scopes.** A new per-project
  `Dev-Memory/LESSONS.md` (append-only, factual, dated) logs a real mistake
  and the corrected rule going forward; at Publish, anything genuinely
  general is distilled into a new cross-project
  `~/.gru953-studio/common-pitfalls.md`, so a mistake caught once benefits
  every future project, not just the one it happened on. Checked by
  `builder`, `fixer`, and `ai-developer` before starting a task that
  resembles one already logged.
- **Working-style memory, across every project.** The existing
  first-run-only `~/.gru953-studio/profile.md` is now also grown by
  `memory-keeper` throughout every later project with durable working-style
  facts learned from real sessions — read by `interviewer` before drafting
  questions and by `project-lead` at the start of every session. Explicitly
  documented as a preference hint, never authorization for anything, and
  never a substitute for a live confirmation on an irreversible action.

**Round 10 (4 lenses, 3 found real issues):** the new files' documented
"read triggers" were aspirational prose never actually wired into the
consuming roles — fixed by adding real checks to `builder.md`, `fixer.md`,
`ai-developer.md`, and `project-lead.md`, and by naming `memory-keeper` as
the executor of `first-run`'s initial write (the previous default,
`project-lead`, deliberately has no `Write` tool and structurally couldn't
have done it). The "same secrets-scan rule applies" disclosure for the new
cross-project files was copied from the narrower per-project case without
re-deriving whether it held at a much wider blast radius (outside any git
repo, read at the start of every future project forever) — re-derived
explicitly rather than borrowed by reference. Re-verifying Round 9's
comprehension fixes (same panel configuration) confirmed all 5 held, but
surfaced 3 new issues (unexplained "converges" jargon; an internal
changelog note spliced into literal user-facing pop-up question text — a
real risk of it being shown verbatim; "CLI" never expanded) — all fixed.
Re-verifying Round 9's agent-manipulation conclusion (same configuration):
clean re-confirmation, no new failure mode.

**Round 11 (2 lenses — a smaller, targeted completeness check, not another
open-ended round, per the new `audit-loop` skill's own "re-plan"
guidance):** a dedicated first-ever deep-read of the governance/CI files
found `governance/LOGO-USAGE.md` still named the superseded GRU953
Community Licence 1.0 in a SECOND place ("Everything else stays open")
that an earlier fix (this same file's opening paragraph) had missed —
fixed, now consistently Polyform Noncommercial License 1.0.0 throughout.
An unconstrained wildcard pass found this very CHANGELOG entry itself
hadn't kept pace with the Round 10 feature work — this entry is that fix.

Verified again: 30/30 tests, all gates clean.

**11 rounds of independent audit panels ran across this whole loop, every
one finding at least one real issue.** Publishing now on explicit user
instruction to stop the loop and ship what has been verified, rather than
continuing to an idealised "2 consecutive clean rounds" state.

## 2.0.3 — 2026-07-11

Round 4 of the same "until golden" audit-fix loop on v2.0.2. The Round 3
fixes all held up under fresh, hostile re-testing (every case verified by
executing the real code, not just reading it) — no push/publish/go-public
bypass was found. Three new bugs surfaced, all in the safe direction
(over-blocking a legitimate command, not under-blocking a real push), plus
one dangling documentation cross-reference.

**Fixed**

- **`normalizeForPushCheck()`'s quote-stripping was one-sided.** It
  stripped a quote whenever a word character touched either side of it,
  with no check on the OTHER side — so the closing quote of a perfectly
  normal, properly paired argument (`"My Project"`, or the second of two
  separately-quoted absolute paths) also got stripped, purely because it
  sits after a word character, even though what follows it is whitespace
  or end-of-string, not another word character. That corrupted a
  legitimate confirm-publish.mjs invocation whose project-root argument
  contained a space, misclassifying it as push-capable — over-blocking,
  not a bypass, but the same deadlock shape found and fixed in Rounds 1-3.
  Fixed: a quote is now only stripped when word/quote characters sit on
  BOTH immediate sides (the actual mid-word-splice signature); a quote at
  a genuine token boundary is left alone. The Round 1-2 splice bypasses
  (`p"u"s"h"`, `pu""sh`) are still caught — verified with new tests.
- **`isConfirmScriptOnly()`'s closing anchor didn't tolerate a trailing
  newline.** `node confirm-publish.mjs \n` failed the exemption and fell
  through to the generic heuristic (misclassified as push-capable).
  Trailing `\r`/`\n` is now tolerated the same as spaces and tabs.
- **The script-indirection keyword list only covered the private-publish
  action.** A script indirectly performing the plugin's separately-gated
  GOING-PUBLIC action (e.g. `make-repo-public.mjs`, `visibility-change.mjs`)
  contained none of the original `deploy|release|publish|ship` keywords
  and got an unconditional pass. Added `public`/`visibility` to the list.
- `governance/SECURITY.md` was missing the paragraph its own code comment
  (in `lib.mjs`) pointed readers to, about the confirm-script exemption's
  filename-trust residual risk. Added.

Verified: 19/19 behavioural tests (3 new this round), `repo-integrity.mjs`,
`roster-check.mjs` and `licence-scan.mjs` all clean — re-run after every
fix, then again on a fresh clone of the actual published repo before
pushing.

## 2.0.2 — 2026-07-11

Round 3 of the same "until golden" audit-fix loop on v2.0.1 — a fresh,
independent review pass with instructions to assume nothing from the prior
two rounds is guaranteed correct. Found the most serious issue of the whole
loop, plus one architectural misdescription affecting four agent files.

**Fixed**

- **Security (CRITICAL, real bypass): the v2.0.1 confirm-script exemption
  trusted a filename suffix, not an identity.** `isConfirmScriptOnly()` in
  `plugins/gru953-studio/hooks/lib.mjs` (added in 2.0.1 to fix the
  confirm-publish.mjs bootstrap deadlock) matched any path that merely
  ENDED WITH `confirm-publish.mjs` or `confirm-go-public.mjs` — so
  `node ./evil-confirm-publish.mjs` or `node /tmp/attacker/z-confirm-publish.mjs`
  were exempted just as completely as the real script. Since `gate.mjs` and
  `scan.mjs` both `allow()` immediately once a command is judged non-push,
  this gave any arbitrarily-named script an unconditional, unscanned,
  ungated pass. The same regex also failed the confirm scripts' own
  documented bare usage (`node confirm-publish.mjs`, no directory prefix),
  recreating the exact deadlock the exemption exists to close. Fixed by
  comparing an exact `path.basename()` match instead of a suffix test;
  verified live against both bugs before and after the fix, and locked in
  with a new regression test in `hooks.test.mjs` (now 16/16 passing).
- **`repo-integrity.mjs` INV9 had no `else fail()`.** Unlike every sibling
  invariant, the role-count-in-description check silently stopped verifying
  anything if the wording ever stopped matching its expected pattern —
  the same shape of blind spot it was written to close. Now fails loud if
  the description is missing or doesn't state a role count in the expected
  form.
- **A real architectural misdescription, found by verifying against
  Claude Code's own subagent documentation rather than assuming:**
  `interviewer.md`, `publisher.md` and `scope-guardian.md` were written as
  if they themselves called `AskUserQuestion` to show the user a live
  pop-up. Task-tool subagents cannot do this — the tool depends on the main
  conversation's session state and is unavailable to them even when
  declared. Corrected all three to prepare question content / confirmation
  wording / an escalation recommendation and hand it to the Project Lead,
  which is the one role played by the main conversation itself and the
  only place that can actually show a pop-up or wait for a live answer —
  documented explicitly in `project-lead.md`. This was a documentation
  correction, not a behavioural change: every real GRU953-Studio session
  observed so far already worked this way in practice.
- Stray "Claude Code or Claude Desktop" claim in `memory-keeper.md` —
  the plugin does not run on Claude Desktop (see README); corrected to
  match the accurate wording already used in `dev-memory/SKILL.md`.
- `reviewer.md` said it performs deletions and "fixes" stale docs directly,
  contradicting its own deliberately read-only tool list (Read, Grep, Glob,
  Bash — no Write/Edit) and the project's stated "every review-only role is
  correctly read-only" guarantee. Reworded to recommend and report findings
  for the builder/Project Lead to act on, matching its actual tools and its
  own Output section.

Verified: 16/16 behavioural tests, `repo-integrity.mjs` clean (31 agents,
version 2.0.2 in both `plugin.json` and `marketplace.json`), `roster-check.mjs`
clean, `licence-scan.mjs` clean — all re-run after every fix in this round.

## 2.0.1 — 2026-07-11

A follow-up audit round on v2.0.0, requested explicitly ("identify and fix
all issues... until golden"). GitHub Copilot was requested for this round
too — checked and reported honestly that this account has no active
Copilot subscription (`user/copilot_seat` → 404), so this round used the
same Claude-based adversarial audit process instead, across four lenses:
role-redundancy/growth, security, cross-file consistency, and non-technical
end-user experience.

**Fixed**

- **Security (MAJOR, real bypass): `isPushCapable()` defeated by shell
  word-splitting/quote-splicing — found and closed across two audit
  rounds, not one.** Round 1: `git${IFS}push` (bash's `$IFS` expands to
  whitespace, triggering word-splitting) and `git pu""sh` / `git pu''sh`
  (empty adjacent quotes are zero-width to bash) both resolved to a real
  `git push` while the matcher — which only ever sees the un-expanded
  literal text — rated them non-push, skipping the secret scan and the
  publish gate entirely. Round 2 (an independent re-audit of the Round 1
  fix, not just re-reading it): found the fix only stripped EMPTY quote
  pairs, missing the equally trivial non-empty case (`git p"u"s"h"`),
  plus backslash-escaped mid-word splicing (`git p\ush`) and
  backslash-newline line continuations. Generalised the fix to a
  fixed-point loop that strips any quote touching a word character on
  either side (so chained splices like `p"u"s"h"` fully resolve, not just
  the first pair), plus the two backslash techniques. This closes every
  proof-of-concept bypass demonstrated across both rounds; shell text
  obfuscation in general remains an open-ended problem (command
  substitution, variable reuse), documented plainly in SECURITY.md rather
  than implied to be solved. Locked in with 2 new test cases (14 tests
  total, up from 12 at v2.0.0).
- **`hooks/repo-integrity.mjs` false-clean bug (MAJOR).** The
  plugin.json/marketplace.json version-agreement check compared
  `pv !== mv` only — if BOTH files were entirely missing, both values were
  `undefined`, `undefined !== undefined` is `false`, and the check
  reported "clean." Reproduced directly (a repo missing both files passed
  as clean) and fixed: now fails explicitly when either file is
  unreadable or either version is absent. Also added a new invariant
  (INV9) checking marketplace.json's own plugin-description text states
  the correct role count — the systemic fix for the next finding.
- **`marketplace.json`'s plugin description said "up to 16 specialised
  roles"** — visible in the actual marketplace listing, unnoticed for a
  full day after the roster grew to 31 because nothing checked
  description text, only the version field. Fixed, and now mechanically
  checked (see above).
- **CHANGELOG's own "11 tests" claim was wrong** (actually 12 at the time of
  v2.0.0, now 14 after this round's fixes) — fixed for the record, per the
  user's own note that this project's CHANGELOG has a history of
  overclaiming.
- **`responsible-ai-reviewer` narrowed.** Previously fired on ANY Standard+
  AI feature — an opus-tier (priciest) role waking for a harmless
  AI-generated encouragement message added cost with no matching risk.
  Now scoped to AI features that make or meaningfully influence a real
  decision about a person.
- **Security (MAJOR, real deadlock, found live while publishing this very
  release): `confirm-publish.mjs`/`confirm-go-public.mjs` could never be
  run.** Both scripts' own filenames contain "publish"/"go-public", so
  invoking either via the Bash tool matched the generic "script whose name
  suggests deploy/release/publish/ship" indirection rule and was itself
  treated as push-capable — meaning `gate.mjs` denied the very command
  that RECORDS a user's publish confirmation, on the grounds that no
  confirmation was recorded yet. An unbreakable deadlock with no way to
  ever create the record. Fixed with a narrowly-scoped exemption (matches
  ONLY a plain `node <path-ending-in-one-of-these-two-scripts>
  [one optional arg]` invocation with no chained commands anywhere in the
  string — verified a decoy like `git push origin main; node
  confirm-publish.mjs` is still correctly caught, not exempted). Existing
  tests never caught this because they invoke the confirm scripts directly
  via `spawnSync` (bypassing the Bash-tool hook layer entirely) rather than
  through the actual PreToolUse interface; a new test exercises the real
  interface and locks the fix in (15 tests total).
- **README "31 AI roles" headline softened** to "The specialist team,"
  with the count moved into supporting text — a minor but real instance of
  number-forward framing cutting against this product's plain-language,
  non-overwhelming design ethos.

**Considered and explicitly declined**

- An independent audit flagged 4 of the 15 new v2.0.0 roles (`qa-lead`,
  `project-assistant`, `prompt-engineer`, `release-manager`) as likely
  duplicating `tester`, `memory-keeper`, `ai-developer`, and `publisher`
  respectively — the same "one job as two roles" pattern that sank an
  earlier 26-role tool. Asked directly; the user chose to keep all 31
  roles as-is. Not re-litigated further.

## 2.0.0 — 2026-07-11

A major gold-standard audit and expansion. Breaking only in the sense that
the specialist-role contract changed (the roster grew); every existing
project, command and skill continues to work unchanged.

**Added**

- **15 new specialist roles (16 → 31)**, the standard SDLC/AI specialist
  set, each Tier- or feature-gated so it only wakes when a project actually
  needs it (a Tiny site never loads them): `devops-engineer`,
  `sre-observability`, `release-manager`, `mlops-engineer`, `prompt-engineer`,
  `responsible-ai-reviewer`, `qa-lead`, `accessibility-specialist`,
  `ux-designer`, `technical-writer`, `data-engineer`, `privacy-dpo`,
  `localisation-specialist`, `researcher`, `project-assistant`. The `studio`
  skill's Tier table now has a companion "feature-triggered roles" table.
- **The `dev-memory` skill now exists.** It was referenced by five files
  (the studio skill, publish-github, memory-keeper, a command and a hook)
  but the `SKILL.md` had never been written — the headline "it remembers
  everything" feature had no defining document. Now it does.
- **`hooks/repo-integrity.mjs`** — a repository self-consistency check
  (referenced skills/hooks exist, role/skill counts match the README,
  versions agree, roster matches its baseline). This is the systemic fix
  for the class of bug above: CI now fails on a dangling reference, so a
  missing skill can't hide again.
- **`hooks/hooks.test.mjs`** — the first behavioural test suite for the
  security hooks (12 tests): the push-matcher catches real bypasses and
  allows ordinary reads; the scanner refuses planted secrets and the
  private Dev-Memory folder while ignoring look-alike code; the publish
  gate's two tokens are proven independent.
- **`plugins/gru953-studio/ROSTER.md`** — a committed roster baseline so the
  product's own role count is mechanically verifiable (previously
  `roster-check.mjs` could never pass on this repo, because the baseline
  lived only in a built project's Dev-Memory).
- Community-health pointer files under `.github/` (SECURITY, CONTRIBUTING,
  CODE_OF_CONDUCT) so GitHub discovers the canonical `governance/` versions;
  a `CODEOWNERS`; and a Dependabot config for the CI Actions.
- **Every role now declares a model deliberately** (6 haiku · 21 sonnet ·
  4 opus) instead of 12 roles inheriting the surface default — cheapest-first
  per `cost-guard`, with the tiers and reasoning recorded in
  `plugins/gru953-studio/ROSTER.md`. Existing opus/sonnet choices were left
  untouched; only the 12 unset roles were assigned.

**Fixed**

- **Security (fail-open risk): `lib.deny()` emitted invalid JSON** whenever a
  deny reason contained a quote, backslash or newline — which several of the
  gate's own reasons do. An unparseable PreToolUse deny risks not being
  honoured (failing open). Both `allow()` and `deny()` now build their
  output with `JSON.stringify`, so any reason is always correctly escaped.
  Caught by the new test suite.
- `roster-check.mjs` now falls back to the committed `ROSTER.md` when no
  per-project Dev-Memory baseline exists, so it works on the product repo.
- `publish-github` skill: removed a duplicated, mis-numbered "step 7" in
  section 5, and de-hardcoded the `v0.1.0`/`v1.0.0` version strings to a
  `<version>` placeholder set by the new `release-manager` role.
- CI: the DCO sign-off check now inspects only the commits introduced by
  the current push or pull request (merge commits exempt), instead of
  scanning all history — a single unsigned legacy or fork commit can no
  longer block every future change. CI also now runs the integrity check,
  the roster check and the behavioural test suite on every change.
- **Role-boundary sharpen (independent verification audit):**
  `ai-developer` still claimed prompt authoring as its own step, which
  duplicated the newly added `prompt-engineer`. It now delegates prompt
  authoring to `prompt-engineer` (drafting inline only when none is
  engaged, e.g. Tiny Tier) and keeps AI-justification, integration and the
  safety guardrails — closing the only genuine overlap the 16 → 31
  expansion introduced. A second, independent audit confirmed every other
  role boundary is distinct, no role is redundant, and every review-only
  role is correctly read-only.
- **Security (fail-open bypass in the push matcher):** `isPushCapable()`
  rated `git "push"`, `git 'push'` and `"git" push` as NON-push, so a
  quote-obfuscated push could have slipped past both the secret scan and the
  publish gate (failing open) — the opposite of the matcher's stated
  "prove non-push or treat as push" rule. The matcher now tolerates optional
  quotes around the `git` binary and the `push` subcommand. Found by an
  adversarial audit that ran the matcher against a battery of bypasses;
  a new `hooks.test.mjs` case locks it in, and the safe-command set was
  re-verified to confirm no new false positives.

## 1.0.2 — 2026-07-11

- **Licence changed again, from the GRU953 Community Licence 1.0 to the
  Polyform Noncommercial License 1.0.0**, following a critical audit
  requested by the user: a custom licence text, however well-intentioned,
  isn't machine-readable by GitHub's licence detector or dependency
  scanning tools, and creates a real adoption barrier. Same
  free-noncommercial/paid-commercial intent; `governance/` structure
  unchanged.
- README: added a full table of the 16 specialist roles and 6 skills;
  added a clear, honest statement that GRU953-Studio requires Claude Code
  and does not work in Claude Desktop (verified, not assumed — Desktop's
  only extension mechanism is MCP servers, with no equivalent to Claude
  Code's sub-agent spawning or hook system); added install-from-a-
  downloaded-zip instructions as an alternative to the marketplace command.
- Every GitHub Release now gets a downloadable `.zip` asset attached
  automatically as part of the publish protocol (`publish-github` skill),
  so non-technical users can install without typing marketplace commands.
  Retroactively attached to v1.0.0 and v1.0.1 as well.

## 1.0.1 — 2026-07-11

Found while archiving old repos using the freshly-published v1.0.0: the
`isPushCapable()` compound-command fallback treated ANY `gh` command
chained after a `cd` (e.g. `cd <dir> && gh repo view ...`) as push-capable
— including harmless reads (`gh repo view`, `gh auth status`, `gh api
user`). Since this environment's Bash tool doesn't reliably persist a
working directory, `cd <dir> && gh <command>` is the normal way to run
almost any `gh` command here, so this blocked ordinary use constantly.
Removed the fallback: every specific push-pattern regex already matches
anywhere in a compound string (unanchored `.test()`), so it added no real
detection power while causing this false-positive class.

## 0.1.0 — 2026-07-10

Initial plugin scaffold: 16 specialist agent roles (project-lead,
interviewer, architect, scope-guardian, builder, reviewer, tester,
security-compliance-auditor, brand-guardian, fixer, cut-recorder,
cost-monitor, publisher, memory-keeper, maintenance-agent, plus
ai-developer added during the gold-standard audit below), 6 skills
(studio, first-run, dev-memory, cost-guard, yagni-rules, publish-github),
3 commands, and security hooks adapted from the sibling GRU953-Crew
project's proven design.

Same-day gold-standard audit (multi-perspective review → fix loop) closed
before first publish:
- Retired the `minimalist` role (redundant with `reviewer`'s own
  whole-product trim pass) and added `ai-developer` in its place — net
  role count unchanged at 16, per this project's bounded-growth rule.
- Fixed a real security bug: `hooks/scan.mjs` could scan the wrong git
  tree in a multi-step publish sequence.
- Hardened `hooks/lib.mjs`'s push-command detection against a git-alias
  bypass and script/Makefile indirection.
- Added a separate, distinctly-tokened "go public" confirmation
  (`hooks/confirm-go-public.mjs`) so a private-publish confirmation can
  never also authorise making the repository public.
- Added real GitHub Release creation (tag + `gh release create` +
  `isDraft: false` verification) to the publish protocol — previously
  publishing stopped at a private repo push, the exact failure mode that
  affected every one of this project's ten predecessors.
- Replaced the internally-contradictory "Apache-2.0 + commercial
  restriction" licence with the Polyform Noncommercial License 1.0.0,
  which is designed for exactly this free-noncommercial/paid-commercial
  model.
- Added `hooks/verify-progress.mjs`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `NOTICE`, issue/PR templates, and a baseline CI
  workflow.

Rounds 2-4 of the same audit found and fixed further real issues:
- A residual git-alias-reuse bypass class (disclosed as a limitation in
  `SECURITY.md`, not fully closable with stateless per-command matching),
  plus `git send-pack`/`gh alias set` detection added to `hooks/lib.mjs`.
- Two agents (`scope-guardian`, `interviewer`) were missing the `Bash`
  tool their own instructions required — a real bug, fixed.
- The plan's own headline sentence, plus `memory-keeper.md`,
  `cost-monitor.md`, and `cost-guard/SKILL.md`, described a private
  GitHub backup mirror for Dev-Memory that was never built and directly
  conflicted with the security hooks. Asked directly, the user chose
  **local-only, no mirror** — every file corrected to match.
- The publish sequence would have self-blocked: the confirmation was
  recorded AFTER `gh repo create --private`, but the publish-gate hook
  denies that exact command unless confirmation already exists. Reordered
  in `publish-github/SKILL.md` and `publisher.md`.
- `security-compliance-auditor.md` undercounted its own checks ("three"
  instead of four) and didn't state its Publish-gate checks apply at
  every Tier, including Tiny — both corrected.
- `agents/project-lead.md` had unused Bash/Write/Edit tools (trimmed to
  Read/Grep/Glob, matching its actual delegate-only behaviour);
  `agents/cost-monitor.md` was missing Bash for a cheap file-size check
  (added).
- `first-run/SKILL.md`'s surface-detection had no deterministic order —
  given a fixed 3-step check sequence.
- A stale "Apache-2.0" reference survived in the plugin's own
  machine-readable `plugin.json` (the most consequential one, since
  tooling reads it) plus a few agent files — all corrected to match the
  Polyform Noncommercial licence actually in use.

Rounds 5-6 came back clean — the project's own "2 consecutive clean
rounds" convergence rule was satisfied before this version was published.

## Brand alignment (2026-07-11, before first publish)

Aligned the whole repository to the established GRU953 brand system (the
GRU953 Brand & Engineering Guidebook), rather than the generic choices made
during the audit:
- Licence changed again, from Polyform Noncommercial License 1.0.0 to the
  **GRU953 Community Licence 1.0** — the same licence used across every
  other GRU953 product. Same free-noncommercial/paid-commercial intent,
  now the brand's own licence instead of a third-party template.
- `LICENSE`, `NOTICE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, and new `TRADEMARKS.md`, `LOGO-USAGE.md`, `GOVERNANCE.md`
  moved into a `governance/` folder, matching the brand's established repo
  structure.
- Added the GRU953 logo to the README and a Community section linking the
  governance docs.
- Added a DCO 1.1 sign-off requirement (checked in CI) to match the
  brand's standing contribution policy — the publish protocol's orphan
  commit now carries a `Signed-off-by` trailer.

## Pre-publish live-fire finding (2026-07-11)

Running the actual secrets scanner against the real repository — not just
reviewing its regex in the abstract, as all 6 prior audit rounds did —
found a genuine false positive that would have permanently blocked
publishing: `SECRETVAR_RE` matched the hooks' own
`const token = crypto.createHash(...)` lines, because "token" + "=" +
16+ letters-and-a-dot ("crypto.createHash") satisfied the old pattern,
which allowed the secret VALUE to be unquoted. Fixed by requiring the
value to actually be a quoted string literal — a real secret is always a
literal, never a function call — which keeps every genuine detection
case working while eliminating this false-positive class entirely.
