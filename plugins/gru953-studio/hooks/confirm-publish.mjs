#!/usr/bin/env node
//
// confirm-publish.mjs — writes the GRU953-Studio publish confirmation record
// that gate.mjs checks. Zero dependencies (Node stdlib only).
//
// Run this ONLY after the user has explicitly confirmed, in this session,
// that they want to publish (the AskUserQuestion pop-up at the Publish
// stage, or /studio-publish). It writes `Dev-Memory/PUBLISH-APPROVED`
// containing the line `STUDIO-PUBLISH-CONFIRMED:<token>`, where `<token>` is
// sha256("studio-publish:" + <studio root>) — the same derivation gate.mjs
// uses to check it.
//
// Usage: node confirm-publish.mjs [projectRoot]
// projectRoot defaults to the current working directory. The directory must
// already contain (or be inside) a `Dev-Memory` folder.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { findStudioRoot } from './lib.mjs';

function main() {
  const start = process.argv[2] || process.cwd();
  const studioRoot = findStudioRoot(start);
  if (studioRoot === null) {
    process.stderr.write('confirm-publish: no Dev-Memory folder found up the tree from ' + start + ' — nothing to confirm.\n');
    process.exit(1);
  }
  const token = crypto.createHash('sha256').update(`studio-publish:${studioRoot}`).digest('hex');
  const record = path.join(studioRoot, 'Dev-Memory', 'PUBLISH-APPROVED');
  // 2026-07-12 Round 7 audit fix (real TOCTOU gap, found by direct code
  // reading — no unlinkSync/rmSync of this file exists ANYWHERE in the
  // codebase; deletion was prose-only, in the publish skill's own steps
  // for the AGENT to remember). A durable file with no expiry means one
  // confirmation silently authorises every LATER push-capable command in
  // this project — a crash before cleanup, a differently-worded future
  // skill revision, or a maintenance session that never loads the publish
  // skill all leave it valid indefinitely. Stamping an issue time and
  // having gate.mjs enforce a bounded window (defense in depth alongside
  // the still-recommended explicit delete) closes the "valid forever"
  // failure mode without breaking the legitimate multi-command publish
  // sequence (push, tag, release create, release upload), which normally
  // completes in well under the window.
  fs.writeFileSync(record, `STUDIO-PUBLISH-CONFIRMED:${token}\nISSUED:${Date.now()}\n`, 'utf8');
  process.stdout.write('confirm-publish: recorded publish confirmation for ' + studioRoot + '\n');
}

main();
