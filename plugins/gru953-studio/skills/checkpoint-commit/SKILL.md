---
name: checkpoint-commit
description: The per-phase backup — at the end of each build phase, commit the app's code (never Dev-Memory) to a private working branch and push, after the phase's quality gate, secret scan and licence scan pass. Keeps work backed up offsite progressively without weakening the security-first Publish gates or ever making anything public. Use at each phase boundary once the phase is green. The final Publish remains the separate, clean, confirmed release.
---

# Checkpoint Commit

## Why this exists

User-directed (2026-07-19): "upon successful development after each phase, commit
everything to GitHub so everything is properly backed up." Long builds shouldn't
risk losing a phase of work to a lost machine or a recycled container. This skill
adds a **per-phase offsite backup** — a commit and push of the app's code to a
**private working branch** — while keeping every existing safety guarantee
intact. Plain-English rule is as set in the `studio` skill.

## What a checkpoint is (and is not)

- It **is**: a commit of the app's source at a clean phase boundary, pushed to a
  **private** working branch on the user's own GitHub, as a progressive backup.
- It is **not** the Publish. Publish stays exactly as it was — the separate,
  explicit, confirmed act that produces the clean release (its own orphan commit,
  Dev-Memory deleted, its own token). A checkpoint never replaces or triggers it.

## The guarantees it keeps (nothing is weakened)

1. **Dev-Memory never ships.** `Dev-Memory/` stays `.gitignore`d and is blocked
   from any push by `scan.mjs` — a checkpoint pushes app code only, never the
   private planning memory.
2. **No secrets.** `scan.mjs` runs on every push regardless of any token, so a
   checkpoint can never ship a secret or key file.
3. **Private only, never public.** A checkpoint is authorised by a dedicated,
   project-bound `CHECKPOINT-APPROVED` token (`hooks/confirm-checkpoint.mjs`),
   which `gate.mjs` accepts for an ordinary (private) push **only**. Going public
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
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/confirm-checkpoint.mjs"` from the project
   root (the user enables per-phase backup once, at the phased-plan/warframe
   approval — see `warframe-prototype`; this records that consent for the phase's
   push). The token is TTL-bounded and private-only.
4. Commit with a clear per-phase message and push to the **private working
   branch** (never the default branch's public release path). `scan.mjs` +
   `gate.mjs` allow it because the tree is clean and the checkpoint token is
   present; anything unclean fails closed.
5. Record the checkpoint in `Dev-Memory/SESSION-LOG.md` and the recall index.

## Reused machinery (no duplication)

- Push safety: the existing `hooks/scan.mjs` (secret/Dev-Memory block) and
  `hooks/gate.mjs` (token gate) — extended in v3.8.0 only to accept the distinct
  checkpoint token for a private push, leaving the go-public gate untouched.
- Licence safety: the existing `hooks/licence-scan.mjs`.
- Confirmation: `hooks/confirm-checkpoint.mjs`, a sibling of `confirm-publish.mjs`
  / `confirm-go-public.mjs`.

## Who applies this

- **security-compliance-auditor** confirms the scans/quality gate before the
  checkpoint.
- **publisher** (or on Tiny Tier, the `project-lead`'s delegate) runs the
  checkpoint commit/push to the private work branch.
- **memory-keeper** logs the checkpoint. **project-lead** never lets a checkpoint
  proceed on a phase whose quality gate is not clean, and never treats it as a
  substitute for the confirmed Publish.
