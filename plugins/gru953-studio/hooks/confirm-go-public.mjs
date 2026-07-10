#!/usr/bin/env node
//
// confirm-go-public.mjs — writes the GRU953-Studio "go public" confirmation
// record that gate.mjs checks separately from the private-publish record.
// Zero dependencies (Node stdlib only).
//
// Added 2026-07-10 (gold-standard audit fix): "private first, then a
// separate explicit step to go public" was previously enforced by prose
// only. Run this ONLY after the user has explicitly confirmed, via its OWN
// AskUserQuestion pop-up (distinct from the private-publish confirmation),
// that they want to make the repository public. It writes
// `Dev-Memory/GO-PUBLIC-APPROVED` containing
// `STUDIO-GO-PUBLIC-CONFIRMED:<token>`, where `<token>` is
// sha256("studio-go-public:" + <studio root>) — a different derivation
// (different prefix) from the private-publish token, so confirming a
// private publish never accidentally also authorises going public.
//
// Usage: node confirm-go-public.mjs [projectRoot]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { findStudioRoot } from './lib.mjs';

function main() {
  const start = process.argv[2] || process.cwd();
  const studioRoot = findStudioRoot(start);
  if (studioRoot === null) {
    process.stderr.write('confirm-go-public: no Dev-Memory folder found up the tree from ' + start + ' — nothing to confirm.\n');
    process.exit(1);
  }
  const token = crypto.createHash('sha256').update(`studio-go-public:${studioRoot}`).digest('hex');
  const record = path.join(studioRoot, 'Dev-Memory', 'GO-PUBLIC-APPROVED');
  fs.writeFileSync(record, `STUDIO-GO-PUBLIC-CONFIRMED:${token}\n`, 'utf8');
  process.stdout.write('confirm-go-public: recorded go-public confirmation for ' + studioRoot + '\n');
}

main();
