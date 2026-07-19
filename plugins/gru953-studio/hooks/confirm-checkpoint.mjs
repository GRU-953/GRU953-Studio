#!/usr/bin/env node
//
// confirm-checkpoint.mjs — writes the GRU953-Studio per-phase CHECKPOINT
// confirmation record that gate.mjs checks. Zero dependencies (Node stdlib).
//
// Added 2026-07-19 (Phase 3 — per-phase backup checkpoint commits, see the
// `checkpoint-commit` skill). A checkpoint pushes the app's code (never
// Dev-Memory) to a PRIVATE working branch at the end of each build phase, so
// work is backed up offsite progressively. gate.mjs blocks every push-capable
// command unless an authorisation token is recorded; this writes the checkpoint
// token so a checkpoint push is allowed — a PRIVATE push only.
//
// SECURITY (why this is a distinct, narrower token than publish):
//   * The token is sha256("studio-checkpoint:" + <studio root>) — project-bound
//     and different from the publish and go-public tokens, TTL-bounded by
//     gate.mjs exactly like them.
//   * It authorises an ORDINARY (private) push only. It does NOT satisfy the
//     go-public gate: gate.mjs checks go-public FIRST, against its own
//     separately-derived GO-PUBLIC-APPROVED token, so a checkpoint can never
//     make a repository public.
//   * scan.mjs still runs on every push regardless of any token, so a
//     checkpoint can never ship a secret or the private Dev-Memory folder.
//
// Run this only after the per-phase backup has been enabled/confirmed for this
// project (recorded during the phased-plan/warframe approval — see the
// `checkpoint-commit` skill) and the phase's quality gate is clean.
//
// Usage: node confirm-checkpoint.mjs [projectRoot]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { findStudioRoot } from './lib.mjs';

function main() {
  const start = process.argv[2] || process.cwd();
  const studioRoot = findStudioRoot(start);
  if (studioRoot === null) {
    process.stderr.write('confirm-checkpoint: no Dev-Memory folder found up the tree from ' + start + ' — nothing to confirm.\n');
    process.exit(1);
  }
  const token = crypto.createHash('sha256').update(`studio-checkpoint:${studioRoot}`).digest('hex');
  const record = path.join(studioRoot, 'Dev-Memory', 'CHECKPOINT-APPROVED');
  fs.writeFileSync(record, `STUDIO-CHECKPOINT-CONFIRMED:${token}\nISSUED:${Date.now()}\n`, 'utf8');
  process.stdout.write('confirm-checkpoint: recorded checkpoint confirmation for ' + studioRoot + '\n');
}

main();
