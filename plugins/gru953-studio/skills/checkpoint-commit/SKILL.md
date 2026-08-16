---
name: checkpoint-commit
description: The per-phase backup — at the end of each build phase, commit the app's code (never Dev-Memory) to the project's `development` branch and push, after the phase's quality gate, secret scan and licence scan pass. Keeps work backed up offsite progressively without weakening the security-first Publish gates or ever making anything public. Use at each phase boundary once the phase is green. The final Publish remains the separate, clean, confirmed release.
---

# Checkpoint Commit

## Why this exists

User-directed (2026-07-19): "upon successful development after each phase, commit
everything to GitHub so everything is properly backed up." Long builds shouldn't
risk losing a phase of work to a lost machine or a recycled container. This skill
adds a **per-phase offsite backup** — a commit and push of the app's code to a
**`development` branch** — while keeping every existing safety guarantee
intact. Plain-English rule is as set in the
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
   now Claude Code's own permission prompt. Going public
   still requires the separate `GO-PUBLIC-APPROVED` token, checked first — a
   checkpoint can never change visibility to public.
4. **Quality first.** A checkpoint is taken only after the phase's `quality-gate`
   (Definition of Done) is clean and the `security-compliance-auditor`'s
   secret/vulnerability/**licence** scans pass — a broken phase is never backed
   up as if it were done.

## The protocol (per phase, once the phase is green)

1. Confirm the phase's quality gate is clean (`quality-gate.mjs`) and the licence
   scan passes (`licence-scan.mjs`).
2. Ensure `Dev-Memory/` is `.gitignore`d; stage the app's code only.
3. Record the per-phase backup authorisation: run
   nothing — the confirmation script was removed on 2026-08-16 (X214) and a
   checkpoint is now an ordinary private push, authorised by the permission
   prompt. From the project
   root (the user enables per-phase backup once, at the phased-plan/warframe
   approval — see `warframe-prototype`; this records that consent for the phase's
   push). The token is TTL-bounded and private-only.
4. Commit with a clear per-phase message and push to the **private working
   `development` branch** (never `main`, which carries only released versions —
   see "Two branches, always" below). `scan.mjs` +
   `gate.mjs` allow it because the tree is clean and the checkpoint token is
   present; anything unclean fails closed.
5. Record the checkpoint in `Dev-Memory/SESSION-LOG.md` and the recall index.

## Reused machinery (no duplication)

- Push safety: `hooks/scan.mjs` (secret/Dev-Memory block). The token gate that
  sat beside it was removed on 2026-08-16 (X214) — extended in v3.8.0 only to accept the distinct
  checkpoint token for a private push, leaving the go-public gate untouched.
- Licence safety: the existing `hooks/licence-scan.mjs`.
- Confirmation: `confirm-checkpoint.mjs` (removed 2026-08-16, finding X214), a sibling of `confirm-publish.mjs`
  / `confirm-go-public.mjs`.

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
   `development` needs the same `CHECKPOINT-APPROVED` token it always did, and
   going public still needs its own separate `GO-PUBLIC-APPROVED` token. This
   rule organises the work; it does not loosen a single gate.
5. **If the user prefers different names**, say so plainly and use theirs — this
   is the owner's default for their own projects, not a law about git.
