#!/usr/bin/env node
//
// confirm-memory-persist.mjs — writes the GRU953-Studio memory-persistence
// authorisation that scan.mjs and gate.mjs check. Zero dependencies.
//
// Added 2026-07-19 (Phase 4 — cloud/web support, see the `dev-memory` skill's
// "Cloud persistence" section). On an ephemeral cloud/web container, a project's
// private Dev-Memory is lost when the container is recycled unless it is saved
// to the user's own GitHub. This token authorises pushing Dev-Memory to a
// PRIVATE branch so a project resumes across sessions — OPT-IN per project, only
// after the user says yes.
//
// SECURITY — this is the narrowest possible relaxation of the "Dev-Memory never
// ships" guard, and it relaxes NOTHING else:
//   * With this token present, scan.mjs stops auto-denying purely because a
//     Dev-Memory path is in the push — but it STILL runs the full secret/key-file
//     scan on those files, so Dev-Memory can be pushed only if it contains no
//     secret and no key file. "Private only, still secret-scanned."
//   * gate.mjs accepts this token for an ORDINARY (private) push only; it is
//     checked AFTER the go-public gate and never satisfies it, so persisted
//     memory can never be pushed to a PUBLIC repository.
//   * The token is sha256("studio-memory-persist:" + <studio root>) — project-
//     bound and distinct from the publish/go-public/checkpoint tokens — and
//     TTL-bounded by the same 60-minute window.
//   * The product Publish path is unchanged: it still deletes Dev-Memory and
//     ships a clean orphan commit. This token governs only the separate,
//     opt-in memory-persistence push to a private branch.
//
// Usage: node confirm-memory-persist.mjs [projectRoot]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { findStudioRoot } from './lib.mjs';

function main() {
  const start = process.argv[2] || process.cwd();
  const studioRoot = findStudioRoot(start);
  if (studioRoot === null) {
    process.stderr.write('confirm-memory-persist: no Dev-Memory folder found up the tree from ' + start + ' — nothing to confirm.\n');
    process.exit(1);
  }
  const token = crypto.createHash('sha256').update(`studio-memory-persist:${studioRoot}`).digest('hex');
  const record = path.join(studioRoot, 'Dev-Memory', 'MEMORY-PERSIST-APPROVED');
  fs.writeFileSync(record, `STUDIO-MEMORY-PERSIST-CONFIRMED:${token}\nISSUED:${Date.now()}\n`, 'utf8');
  process.stdout.write('confirm-memory-persist: recorded memory-persistence authorisation for ' + studioRoot + '\n');
}

main();
