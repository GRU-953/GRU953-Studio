---
name: checkpoint-commit
description: The per-phase backup — at the end of each build phase, commit the app's code (never Dev-Memory) to the project's `development` branch and push, after the phase's quality gate, secret scan and licence scan pass. Keeps the app's code backed up offsite progressively — when the user has enabled stage-by-stage backup at the warframe gate and GitHub is connected — without weakening the security-first Publish gates or ever making anything public. Never covers `Dev-Memory/`, which by design never leaves the machine. Use at each phase boundary once the phase is green. The final Publish remains the separate, clean, confirmed release.
---

# Checkpoint Commit

## Why this exists

User-directed (2026-07-19): "upon successful development after each phase, commit
everything to GitHub so everything is properly backed up." Long builds shouldn't
risk losing a phase of work to a lost machine or a recycled container. This skill
adds a **per-phase offsite backup** — a commit and push of the app's code to a
**`development` branch** — while keeping every existing safety guarantee
intact. **Two limits, stated here because the public wording used to omit both
(2026-08-23, X182):** it happens only if the user turned it on at the warframe
gate and GitHub is connected, and it covers the app's code only — `Dev-Memory/`
is `.gitignore`d by design and is never pushed, so the planning notebook is not
protected by this and never was. Plain-English rule is as set in the
`operating-charter` skill.

## What a checkpoint is (and is not)

- It **is**: a commit of the app's source at a clean phase boundary, pushed to the
  project's **`development`** branch on the user's own GitHub, as a progressive
  backup. The repository is private until an explicit, separate go-public step,
  so this is a private push in the ordinary case.
- It is **not** the Publish. Publish stays exactly as it was — the separate,
  explicit, confirmed act that produces the clean release (its own orphan commit,
  Dev-Memory deleted, its own token). A checkpoint never replaces or triggers it.

## The guarantees it keeps (nothing is weakened)

1. **Dev-Memory never ships.** `Dev-Memory/` stays `.gitignore`d and is blocked
   from any push by `scan.mjs` — a checkpoint pushes app code only, never the
   private planning memory.
2. **No secrets.** `scan.mjs` runs on every push regardless of any token, so a
   checkpoint can never ship a secret or key file.
3. **Private only, never public.** A checkpoint is an ordinary private push.
   It used to require a project-bound token; that layer was removed on
   2026-08-16 (X214) because a file-based token cannot establish that a person
   agreed — anything the hook can read, an agent can write.  Authorisation is
   now Claude Code's own permission prompt. **Corrected 2026-08-18 (X226): the
   rest of this guarantee was false.** It read "Going public still requires the
   separate `GO-PUBLIC-APPROVED` token, checked first — a checkpoint can never
   change visibility to public." That token and the go-public gate were removed
   on 2026-08-16 by X214 along with everything else in this layer, so **nothing
   mechanical stops a visibility change**; the only thing in the way is Claude
   Code's own permission prompt, the same as for any other command. A checkpoint
   is still an ordinary private push because that is what the protocol below
   does — not because anything checks it.
4. **Quality first.** A checkpoint is taken only after the phase's `quality-gate`
   (Definition of Done) is clean and the `security-compliance-auditor`'s
   secret/vulnerability/**licence** scans pass — a broken phase is never backed
   up as if it were done.

## The protocol (per phase, once the phase is green)

1. MEASURE the Definition of Done, then confirm it:
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/dod.mjs" .` runs each dimension and records
   its real exit code under `Dev-Memory/evidence/`, regenerating
   `Dev-Memory/QUALITY-GATE.md` from the results; `quality-gate.mjs` then confirms
   nothing is missing from that record. Run them in that order — running only the
   second one grades a table rather than the software, which is how a checkpoint
   could be taken on work that had never been built. Then confirm the licence scan
   passes (`licence-scan.mjs`).
2. Ensure `Dev-Memory/` is `.gitignore`d; stage the app's code only.
3. Record the per-phase backup authorisation: run
   nothing — the confirmation script was removed on 2026-08-16 (X214) and a
   checkpoint is now an ordinary private push, authorised by the permission
   prompt. From the project
   root (the user enables per-phase backup once, at the phased-plan/warframe
   approval — see `warframe-prototype`; this records that consent for the phase's
   push). **Corrected 2026-08-18 (X226):** this read "The token is TTL-bounded and private-only" — an orphaned tail of the removed layer. There is no token.
4. **First check that there is somewhere to push to, and say so plainly if there
   is not (2026-08-23, X182).** This skill described a "progressive offsite
   backup" while never mentioning a remote at all — and nothing in the product
   creates the project's GitHub repository outside Publish (`gh repo create`
   appears only in `publish-github` and `first-run`). Publish is the LAST step, so
   for the whole of a long build — exactly the case this skill exists for — the
   push had nowhere to go. If no remote is configured, do not report a backup:
   tell the user in one plain sentence that this phase is committed **on this
   computer only**, and offer to set up the private repository now. A silent
   local-only commit reported as a backup is the failure this finding is about.
5. Commit with a clear per-phase message and push to the **private working
   `development` branch** (never `main`, which carries only released versions —
   see "Two branches, always" below). `scan.mjs` raises no objection because
   the tree is clean; anything unclean fails closed. **Corrected 2026-08-17
   (X219):** this read "`scan.mjs` + `gate.mjs` allow it ... and the checkpoint
   token is present". `gate.mjs` and the checkpoint token were removed on
   2026-08-16 by finding X214, so neither is consulted. Note also that
   `scan.mjs` never *allows* anything — finding no secrets is an absence of
   objection, not an approval (X1), and it is the only push-safety hook left.
6. Record the checkpoint in `Dev-Memory/SESSION-LOG.md` and the recall index.

## Reused machinery (no duplication)

- Push safety: `hooks/scan.mjs` (secret/Dev-Memory block) is now the whole of it.
  The token gate that sat beside it was removed on 2026-08-16 (X214). **Corrected
  2026-08-18 (X226):** the rest of this bullet dangled after that removal, still
  describing the gate being "extended in v3.8.0 only to accept the distinct
  checkpoint token for a private push, leaving the go-public gate untouched" — a
  clause about a gate that no longer exists, left attached to the sentence saying
  it was deleted.
- Licence safety: the existing `hooks/licence-scan.mjs`.
- Confirmation: `confirm-checkpoint.mjs`, a sibling of `confirm-publish.mjs`
  and `confirm-go-public.mjs` — all four minters removed on 2026-08-16, finding
  X214. A checkpoint now needs no token.

  **Unattended, a checkpoint does not happen at all (2026-08-27).** A checkpoint
  PUSHES, and an unattended v7 run never pushes — it produces a finished, tested,
  local repository and stops. So the correct behaviour with nobody present is to
  commit locally, record in `Dev-Memory/decisions/` that offsite backup was not
  enabled, and carry on. This step used to read "ask the user, and wait", which
  an unattended run cannot do; and `command-centre/SKILL.md` already stated the
  never-pushes rule, so the two contradicted each other.

## Who applies this

- **security-compliance-auditor** confirms the scans/quality gate before the
  checkpoint.
- **publisher** (or on Tiny Tier, the `project-lead`'s delegate) runs the
  checkpoint commit/push to the `development` branch.
- **memory-keeper** logs the checkpoint. **project-lead** never lets a checkpoint
  proceed on a phase whose quality gate is not clean, and never treats it as a
  substitute for the confirmed Publish.

## Two branches, always (2026-08-10, owner-directed)

Every project GRU953-Studio touches — including GRU953-Studio itself — uses
exactly two long-lived branches, and the distinction is about what a branch
*means* rather than where work happens to sit:

| Branch | What it holds |
| :-- | :-- |
| **`main`** | Only the final, tested, stable, optimised released version. Nothing arrives here except through a completed Publish. |
| **`development`** | Everything else: building, testing, fixing, improving, updating. Every checkpoint lands here. |

Practical consequences, so this is a rule with teeth rather than a preference:

1. **A checkpoint never touches `main`.** It is a backup of work in progress, and
   `main` is by definition not work in progress.
2. **`main` only ever moves at Publish**, which is the separate, explicitly
   confirmed act described in `publish-github` — its own orphan commit, with
   `Dev-Memory/` deleted.
3. **At first publish, both branches are created**, so a project never has a
   `development` commit with nowhere to be released from, and never a `main` with
   no place to work.
4. **Push safety is now the secret scan alone.** `gate.mjs` (removed 2026-08-16, finding X214) authorised a push by
   the recorded confirmation token, not by which branch is being pushed —
   verified, not assumed, when this rule was written. So a checkpoint to
   `development` needs no token at all, and neither does going public — the
   `CHECKPOINT-APPROVED` and `GO-PUBLIC-APPROVED` tokens were both removed on
   2026-08-16 by X214 (corrected 2026-08-18, X226; this sentence restated the
   false version a second time, 74 lines after the file itself said the layer
   was gone). This
   rule organises the work; it does not loosen a single gate.
5. **If the user prefers different names**, say so plainly and use theirs — this
   is the owner's default for their own projects, not a law about git.
