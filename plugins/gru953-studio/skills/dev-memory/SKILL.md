---
name: dev-memory
description: The plain-text memory system that makes every GRU953-Studio project resumable — in the same session or a brand-new one, days later. Defines the exact files, the ▶ RESUME HERE pointer, the secrets-scan-before-write rule, the resume rehearsal, and the rule that memory is local-only and never ships. Use at the start and end of every session, after every stage or task, and whenever the studio needs to read or write project memory. The memory-keeper role performs the reads and writes; this skill is the protocol it follows.
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
| `ARCHITECTURE.md` | The chosen stack, components, data flow, interface contracts, decisions, and deliberate omissions (written by `architect`). |
| `PROGRESS.md` | The task table. Its **Status** column (`todo` / `doing` / `done` / `blocked`) is the single source of truth. Each `done` row carries the tester's `verified:` evidence cell. |
| `SESSION-LOG.md` | An append-only diary — one entry per session/stage. Never edited or deleted, only added to. |
| `INDEX.md` | A short, growing map of what is where, so a long project stays navigable. |
| `decisions/*.md` | One small dated note per load-bearing decision (stack choices, Tier changes, the roster baseline — `*roster*.md` — and anything a future session must not re-litigate). |
| `UNBUILT.md` | The append-only ledger of things deliberately **not** built (owned by `scope-guardian`), so a cut idea is never silently re-proposed. |
| `PUBLISH-APPROVED` | Written by `confirm-publish.mjs` only after the user confirms publishing; read by `gate.mjs`. Deleted after a successful publish. |
| `GO-PUBLIC-APPROVED` | Written by `confirm-go-public.mjs` only after the separate "go public" confirmation; read by `gate.mjs`. |
| `LESSONS.md` | (2026-07-11 addition) An append-only log of real mistakes made on THIS project and what to do differently — see "Learning from mistakes" below. Distinct from `SESSION-LOG.md` (a diary of what happened) and `UNBUILT.md` (things deliberately cut): this is specifically things that went WRONG and the corrected rule going forward. |

## The ▶ RESUME HERE pointer

`PROGRESS.md` always contains exactly one line beginning `▶ RESUME HERE`,
pointing at the next thing to do. It is a **human-friendly hint** — if it
ever disagrees with the Status column, the Status column wins (the next
task is the first `todo`/`doing` row whose dependencies are all `done`; a
`blocked` row is never picked until a human unblocks it).

## Read before acting — every session

Before doing anything else, the Project Lead reads, in this order:
`PROGRESS.md`, the tail of `SESSION-LOG.md`, then `INDEX.md` — then reports
the resume point back to the user in its first message, so the user always
knows where things stood before being asked anything.

## Scan before every write — never skip

No memory file is saved until it has been checked for anything that looks
like a password, API key, or token (the same patterns as `hooks/scan.mjs`).
If something is caught, flag it to the Project Lead — never silently store
it and never silently discard it; the user decides what happens to it.

## Write after acting

Update `PROGRESS.md` (including the `▶ RESUME HERE` pointer), **append** to
`SESSION-LOG.md` (never rewrite history), and grow `INDEX.md`. Checkpoint
at every stage boundary — before starting the next stage, never after — so
an interrupted session loses nothing.

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
  memory-file prose (see `governance/SECURITY.md`). A recorded preference or
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

## Local-only, and never shipped

Dev-Memory lives **only** on the user's own machine. There is no GitHub
mirror and no automatic backup — if the user wants an offsite copy, that is
their own general backup routine, not something this tool does (confirmed
with the user; earlier drafts wrongly described a mirror that was never
built). Two rules keep it private:

1. Add `Dev-Memory/` to the project's `.gitignore` the moment the folder is
   created.
2. It must never enter the publisher's would-ship set — backed mechanically
   by `hooks/scan.mjs`, which blocks any push whose file set contains a
   `Dev-Memory/` path.

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
