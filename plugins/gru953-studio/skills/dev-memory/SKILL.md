---
name: dev-memory
description: The plain-text memory system that makes every GRU953-Studio project resumable — in the same session or a brand-new one, days later. Defines the exact files, the ▶ RESUME HERE pointer, the secrets-scan-before-write rule, the resume rehearsal, and the rule that memory is local-only and never ships. Use at the start and end of every session, after every stage or task, and whenever the studio needs to read or write project memory. The memory-keeper role performs the reads and writes; this skill is the protocol it follows.
user-invocable: false
---

# Dev-Memory

Dev-Memory is GRU953-Studio's project notebook: a small set of plain-text
files in a `Dev-Memory/` folder inside the user's own project directory.
It exists so no work is ever lost — close the computer mid-project, come
back a week later in a new session, type `/studio`, and the studio picks up
at the exact point it stopped.

Written by the `memory-keeper` role. At the start of every session, the
Project Lead reads three specific files directly — `PROGRESS.md`, the tail
of `SESSION-LOG.md`, and `INDEX.md` (see `project-lead.md`) — the one
narrow exception to its own delegate-never-do-specialist-work rule, because
it needs the resume point before it can decide who to delegate to.
`memory-keeper` owns everything else: every write, the mandatory
secrets-scan on each one, and growing these files as the project continues.
(2026-07-11 Round 9 fix: this paragraph and the "Read before acting"
section below used to disagree with each other, and with `project-lead.md`
and `studio/SKILL.md`, about who does this initial read — settled on one
consistent story, matching those two files.)

## The files

All live under `Dev-Memory/` in the project's working directory:

| File | What it holds |
| :-- | :-- |
| `OBJECTIVE.md` | The confirmed one-page brief, the three Tier questions and their Y/N answers, and the resulting Tier — so the Tier is auditable, not just asserted. |
| `FOCUS.md` | (2026-07-19, see `focus-guard` skill) The tiny always-current anchor — objective, active phase, active task, top constraints — rewritten in place, read first every session so the team re-orients in almost no tokens even after a summarised or brand-new session. |
| `REQUIREMENTS.md` | (2026-07-19, see `focus-guard` skill) The traceability matrix: every confirmed requirement mapped to its tasks, verification, and status, so nothing agreed is dropped and no task exceeds the brief. Audited by `hooks/traceability-check.mjs`. Standard/Complex Tier — a short inline list suffices on Tiny. |
| `ARCHITECTURE.md` | The chosen stack, components, data flow, interface contracts, decisions, and deliberate omissions (written by `architect`). |
| `PLAN.md` | (Standard/Complex Tier — see `micro-task-planning` skill) The ordered list of small "micro-tasks" `architect` breaks the design into: each with one acceptance criterion, the exact verification command that proves it, and its dependencies. Gains a **Phase** column (MVP → progressive phases, see `phased-roadmap`) and reflects the command-centre control state of each task. `builder`/`tester` read task specifics from here; `project-lead` reads the dependency graph to decide what may run in the parallel Build Swarm versus what must wait. Not used on Tiny Tier — the task list there is short enough to state plainly instead. |
| `PROGRESS.md` | The task table. Its **Status** column (`todo` / `doing` / `done` / `blocked`) is the single source of truth. Each `done` row carries the tester's `verified:` evidence cell. An optional `ID`/`Task ID` column enables two-way traceability against `REQUIREMENTS.md`. |
| `CONTENT.md` | (2026-07-19, see `content-creation` skill) The content manifest — every text/image/audio/video asset the app ships, each with its medium, source model + prompt (provenance), approval, a rights/licence note, and (for media) alt-text/caption. Audited by `hooks/content-check.mjs` before Publish. Absent on projects with no generated content. |
| `QUALITY-GATE.md` | (2026-07-19, see `quality-gate` skill) The current phase's Definition of Done — each required quality dimension (acceptance, tests, review, security/licence/privacy, accessibility, docs, reproducible build) marked pass-with-evidence or n/a-with-reason. Audited by `hooks/quality-gate.mjs`; must be clean before a checkpoint commit or Publish. |
| `SESSION-LOG.md` | An append-only diary — one entry per session/stage. Never edited or deleted, only added to. |
| `INDEX.md` | A short, growing, machine-readable map of what is where — a compact table (entity, where, summary, tags, last-touched), most-recent first, read first for cheap recall (2026-07-19, see the `memory-graph` skill). Its `Where` column names real file paths, checked by `hooks/memory-integrity.mjs`. |
| `GRAPH.md` | (2026-07-19, Standard/Complex Tier, see the `memory-graph` skill) The plain-text knowledge graph — nodes (requirements, tasks, decisions, files, lessons) and typed links (`implements`/`depends-on`/`relates-to`/`supersedes`/`caused-by`/`blocks`) — expanded on demand so a session recalls only what the current task needs. Links are checked for dangling nodes by `hooks/memory-integrity.mjs`. |
| `decisions/*.md` | One small dated note per load-bearing decision (stack choices, Tier changes, the roster baseline — `*roster*.md` — and anything a future session must not re-litigate). |
| `UNBUILT.md` | The append-only ledger of things deliberately **not** built (owned by `scope-guardian`), so a cut idea is never silently re-proposed. |
| `PUBLISH-APPROVED` | Written by `confirm-publish.mjs` only after the user confirms publishing; read by `gate.mjs`. Deleted after a successful publish. Valid for 60 minutes from the moment it's written (2026-07-12 Round 7 audit fix — the deletion above is a prose instruction the agent must remember, not something any code enforces, so `gate.mjs` also checks a written-in timestamp and stops honouring the record on its own once the window passes, rather than relying solely on the delete step happening). |
| `GO-PUBLIC-APPROVED` | Written by `confirm-go-public.mjs` only after the separate "go public" confirmation; read by `gate.mjs`. Also valid for 60 minutes from being written, enforced the same way — this file was never deleted by anything until the 2026-07-12 Round 7 fix added the time-bound check, so a single confirmation would otherwise have authorised every later visibility-changing command in the project, indefinitely. |
| `CHECKPOINT-APPROVED` | (2026-07-19, see `checkpoint-commit` skill) Written by `confirm-checkpoint.mjs` to authorise a per-phase backup — an ordinary (private) push only; read by `gate.mjs`, TTL-bounded the same 60 minutes. A distinct, project-bound token that can never satisfy the go-public gate, so a checkpoint can never make anything public. |
| `LESSONS.md` | (2026-07-11 addition) An append-only log of real mistakes made on THIS project and what to do differently — see "Learning from mistakes" below. Distinct from `SESSION-LOG.md` (a diary of what happened) and `UNBUILT.md` (things deliberately cut): this is specifically things that went WRONG and the corrected rule going forward. |

## The ▶ RESUME HERE pointer

`PROGRESS.md` always contains exactly one line beginning `▶ RESUME HERE`,
pointing at the next thing to do. It is a **human-friendly hint** — if it
ever disagrees with the Status column, the Status column wins (the next
task is the first `todo`/`doing` row whose dependencies are all `done`; a
`blocked` row is never picked until a human unblocks it).

## Read before acting — every session

Before doing anything else, the Project Lead runs the `focus-guard`
re-orientation ritual: read `FOCUS.md` first (the cheapest one-glance
heading), then `OBJECTIVE.md`, then `PROGRESS.md`, the tail of
`SESSION-LOG.md`, and `INDEX.md` — and restate the single active goal in one
plain line before acting. Then report the resume point back to the user in its
first message, so the user always knows where things stood before being asked
anything. (2026-07-19: `FOCUS.md` and the "restate the goal" checkpoint were
added so a summarised or brand-new session rehydrates from the memory files,
not from lost chat history — see the `focus-guard` skill.) For recall beyond
the resume point, follow the `memory-graph` skill's protocol: read the compact
`INDEX.md`, then expand only the `GRAPH.md` nodes the current task touches —
recall the least you need, not every file.

## Scan before every write — never skip

No memory file is saved until it has been checked for anything that looks
like a password, API key, or token (the same patterns as `hooks/scan.mjs`).
If something is caught, flag it to the Project Lead — never silently store
it and never silently discard it; the user decides what happens to it.

## Write after acting

Update `PROGRESS.md` (including the `▶ RESUME HERE` pointer), **append** to
`SESSION-LOG.md` (never rewrite history), and grow `INDEX.md` — and, on
Standard/Complex Tier, the `GRAPH.md` node and links for what changed (see the
`memory-graph` skill). Checkpoint at every stage boundary — before starting the
next stage, never after — so an interrupted session loses nothing.

## Learning from mistakes (2026-07-11 addition)

Whenever a real mistake surfaces — a wrong assumption that cost a redo, a
bug the reviewer traces back to a process failure rather than just a typo,
or the user directly correcting the team's approach — `memory-keeper`
appends a short, dated entry to `Dev-Memory/LESSONS.md`: what happened, why,
and the corrected rule going forward. This is not a blame log; keep it
factual and short. Before starting a task that resembles one already
logged (another Fix cycle, another integration, another AI feature),
whichever role is about to do it checks `LESSONS.md` first — the whole
point is that a mistake made once on this project is never quietly
repeated on it.

At the Publish stage, do one distillation pass: read `LESSONS.md` and ask,
for each entry, whether it's specific to this app's own domain (stays
here) or a genuinely general working pattern that would help on ANY future
project (e.g. "always verify a security-relevant fix by executing it, not
just reading the change" — not "this app's payment webhook needed a retry
queue"). Anything general gets added to the cross-project
`~/.gru953-studio/common-pitfalls.md` file — see "Cross-project memory"
below — so it benefits every future project, not just this one.

## Cross-project memory (2026-07-11 addition — carries over BETWEEN projects)

Two files, maintained by `memory-keeper`, that live OUTSIDE any single
project — at a fixed location in the user's own home folder,
`~/.gru953-studio/` — because their whole purpose is to carry forward
across every different project directory the user ever builds with
GRU953-Studio, not just the current one:

| File | What it holds | Written when | Read when |
| :-- | :-- | :-- | :-- |
| `profile.md` | Seeded once by `first-run` (preferred name, typical project types, GitHub handle, language) — see the `first-run` skill — then grown by `memory-keeper` with durable facts about the user's working style learned from real sessions after that: a communication preference, a recurring decision pattern, something that visibly annoyed or pleased them about how the team worked. NOT project-specific facts (those stay in that project's own `OBJECTIVE.md`/`decisions/`). | The first-run answers, once, by `first-run`. After that, whenever the user corrects an approach, or confirms an unusual choice without pushback — the same two signals a person would naturally learn from. Added to, never overwritten wholesale. | At the start of every new project's Brainstorm/Ideate stage (so `interviewer` doesn't re-ask something already known about how this user likes to work), and by `project-lead` at the start of any session where it would change how something is presented. |
| `common-pitfalls.md` | The distilled, general lessons from `LESSONS.md` across every project (see "Learning from mistakes" above) — mistakes worth not repeating regardless of which app is being built. | At each project's Publish stage, during the distillation pass. | At the start of a new project (Brainstorm stage) and before a Fix/Build task that resembles a logged pitfall. |

Both files follow the same rules as everything else in this skill: the
same secrets-scan before every write, and short, factual, dated entries —
never a place to silently accumulate opinions about the user. `common-pitfalls.md`
doesn't exist yet on a brand-new install — that's normal, `memory-keeper`
creates it the first time there's something real to record, not before.
`profile.md` exists from first-run onward (see above).

**These two are never authorization for anything, and their risk is
consciously re-assessed, not just inherited from Dev-Memory's (2026-07-11
Round 10 audit fix — a fresh security lens caught that "same rule applies"
was copied here without re-deriving whether it still held):**

- Neither file's content is ever read by, or connects to, the private-publish
  or go-public confirmation gates — those are checked purely mechanically
  by `hooks/gate.mjs` against a cryptographic token file, never against
  memory-file prose (see `SECURITY.md`). A recorded preference or
  lesson is a fact to avoid re-asking or re-repeating — never an instruction
  to follow, and never something that can substitute for a live
  `AskUserQuestion` answer on an irreversible action.
- The blast radius here is genuinely wider than per-project Dev-Memory: this
  location is outside any git repository (so it was never protected by
  `.gitignore`/`scan.mjs`'s push-gate to begin with — its only protection
  has always been the prose-only scan), it is re-read at the start of EVERY
  future project on this machine rather than staying contained to one, and
  it sits in the home folder where a backup tool or sync client could see it
  unencrypted. The mandatory secrets-scan before writing to these two files
  is still prose-only, same mechanism as per-project Dev-Memory — but given
  to this wider consequence, that acceptance is now explicit here, not
  borrowed by reference from the narrower per-project case.

These two files are not inside any project's git repository, so they are
never at risk of being published by this tool's own publish flow — that
protection applies regardless, on top of `Dev-Memory/`'s own `.gitignore`
and `scan.mjs` rules below.

## The resume rehearsal (a real check, run at least once before Publish)

A project that cannot prove it resumes is not ready to publish, however
clean its code. At least once before the Publish stage, actually rehearse a
resume: from a fresh read of `Dev-Memory/` alone (no other memory of the
conversation), confirm that `PROGRESS.md` + `SESSION-LOG.md` + `INDEX.md`
are enough to state, unambiguously, what is done and what the very next
step is. If they are not, the memory is incomplete — fix it before
Publish. Record that the rehearsal passed in `SESSION-LOG.md`.

On a **cloud/ephemeral session with memory persistence enabled** (see "Cloud
persistence" above), the rehearsal additionally proves the *branch-persisted*
memory rehydrates a fresh container: confirm that a resume from the private
memory branch alone — not this container's local files, which will not survive —
is enough to state what's done and what's next. A project that only resumes from
the soon-to-be-wiped local copy has not actually proven it resumes on the web
(2026-07-19, Phase 5).

## Local-only, and never shipped (with one opt-in cloud exception)

Dev-Memory lives on the user's own machine by default. It is never part of the
published product, and there is no *automatic* backup. Two rules keep it
private:

1. Add `Dev-Memory/` to the project's `.gitignore` the moment the folder is
   created.
2. It must never enter the **publisher's** would-ship set — backed mechanically
   by `hooks/scan.mjs`, which blocks any push whose file set contains a
   `Dev-Memory/` path. The product Publish always deletes Dev-Memory and ships a
   clean orphan commit; this is unchanged.

## Cloud persistence (opt-in; cloud/ephemeral sessions only)

On Claude Code on the web (and any ephemeral container that is reclaimed between
sessions), Dev-Memory would be lost when the container recycles — so a project
could not resume days later, the whole point of this skill. To keep resume
working there, the studio offers an **opt-in** persistence of Dev-Memory (and
the cross-project `~/.gru953-studio/` files) to a **private branch** on the
user's own GitHub. It is **off by default** and only ever happens after the user
says yes for that project (`project-lead` asks once, plainly, on a cloud
session; the answer is recorded). The safety envelope is deliberately narrow
(2026-07-19):

- **Private only, never public.** Authorised by a distinct, project-bound
  `MEMORY-PERSIST-APPROVED` token (`hooks/confirm-memory-persist.mjs`) that
  `gate.mjs` accepts for an ordinary (private) push only — checked *after* the
  go-public gate, which it never satisfies. Persisted memory can never reach a
  public repository.
- **Still fully secret-scanned.** The token tells `scan.mjs` not to block purely
  because a `Dev-Memory/` path is present — but `scan.mjs` still runs its full
  secret/key-file scan on those files, so Dev-Memory persists only if it carries
  no password, key or token. A secret in memory is blocked exactly as before.
- **Desktop is unchanged.** On a normal local machine there is no persistence
  push; Dev-Memory stays local-only as above.

This is the owner-approved, scoped variant of the "memory never leaves the
machine" rule — narrowed to: opt-in, cloud-only, private-branch-only, and still
secret-scanned. Everything not covered by that one exception is unchanged.

## One schema, every session

The schema above is identical across every Claude Code session and every
machine — a new session picking up an existing project reads the exact same
file names, columns, and `▶ RESUME HERE` convention a prior session left
behind, so nothing is ever lost between sessions. (2026-07-12 final-audit
fix: this section used to say "whether the session runs in Claude Code or
any other surface" — this plugin is Claude Code only, see README and
`memory-keeper.md`, and this wording had already drifted back toward
implying multi-surface support once before, per a documented past fix to
`memory-keeper.md` for the same claim; corrected here too, and dropped the
cross-app framing entirely rather than leaving room for it to drift back a
third time.)
