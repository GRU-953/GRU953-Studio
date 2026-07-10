#!/usr/bin/env node
//
// verify-progress.mjs — checks that every task marked "done" in
// Dev-Memory/PROGRESS.md actually carries a `verified: <command> → exit 0
// (YYYY-MM-DD)` (or the human-judged protocol equivalent) Notes cell.
//
// Added 2026-07-10 (gold-standard audit fix): the tester agent's own rule —
// "a task may only be marked done with a verified: line" — had no
// mechanical check at all; it rested entirely on the tester remembering to
// follow its own instructions. This script is that check. Run it manually
// (via the reviewer or security-compliance-auditor) before any Publish —
// it is intentionally NOT wired into hooks.json/PreToolUse, because "is
// this file well-formed" cannot be judged reliably from a single Bash call
// the way a push can; the publish-github skill documents it as a required
// manual step instead, the same pattern used for licence-scan.mjs.
//
// Usage: node verify-progress.mjs [projectRoot]
// Exit 0 = every "done" row has a verified: cell. Exit 1 = at least one
// does not (they are listed).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function main() {
  const root = process.argv[2] || process.cwd();
  const file = path.join(root, 'Dev-Memory', 'PROGRESS.md');
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ status: 'no PROGRESS.md found', file }));
    process.exit(0);
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const VERIFIED_RE = /verified:.*(→|->).*exit 0|verified:.*machine checks true|verified:.*user PASS/i;
  const problems = [];
  for (const line of lines) {
    if (!/^\|/.test(line)) continue; // only table rows
    const cells = line.split('|').map((c) => c.trim());
    const statusCell = cells.find((c) => /^(done)$/i.test(c));
    if (!statusCell) continue;
    if (!VERIFIED_RE.test(line)) {
      problems.push(line.trim());
    }
  }
  if (problems.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'every "done" row has a verified: cell' }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'BLOCKED', reason: '"done" rows missing a verified: cell', rows: problems }, null, 2));
  process.exit(1);
}

main();
