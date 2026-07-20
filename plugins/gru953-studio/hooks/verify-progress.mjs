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
  // 2026-07-12 audit fix (MAJOR false-clean, found by execution): matching
  // anywhere on the line let a Notes cell that honestly documents an OLD
  // passing run (e.g. "verified: ... exit 0 on the old build, but the
  // current build now fails with exit 1 and has not been re-verified")
  // satisfy this regex, since "exit 0" appears somewhere in the cell —
  // reported clean despite the row itself saying it's currently broken.
  // Anchoring the whole test to the END of the line (after optional
  // trailing whitespace/table-cell padding) means only a `verified:` clause
  // that is the row's FINAL claim counts — a stale claim followed by a
  // later "but now fails" no longer matches.
  const VERIFIED_RE = /verified:.*(→|->).*exit 0|verified:.*machine checks true|verified:.*user PASS/i;
  // 2026-07-12 audit fix (MAJOR false-clean, found by execution): VERIFIED_RE
  // only checks that its pattern appears SOMEWHERE on the line, so a Notes
  // cell that honestly documents an OLD passing run alongside a NEW,
  // currently-failing one ("verified: ... exit 0 on the old build, but the
  // current build now fails with exit 1 and has not been re-verified")
  // still satisfied it — reported clean despite the row itself saying it's
  // currently broken. Anchoring VERIFIED_RE to end-of-line was considered
  // and rejected: this project's OWN real Dev-Memory has legitimate
  // multi-clause "done" rows where "exit 0" is deliberately not the last
  // clause (e.g. "...→ exit 0; pushed c9d8b50; gh release view v2.0.1 → not
  // draft, zip attached (2026-07-11)."), and an end-anchor would have
  // wrongly blocked those. Instead, a genuine "this is currently broken"
  // contradiction anywhere in the same row invalidates an otherwise-passing
  // VERIFIED_RE match — a row can honestly narrate old history, but not
  // also claim to be currently failing/unverified and still count as done.
  const CONTRADICTION_RE = /\b(exit[ \t]+[1-9]\d*|now[ \t]+fails?|currently[ \t]+(broken|failing)|has(?:n'?t| not)[ \t]+(?:yet[ \t]+)?been[ \t]+(?:re-?)?verified|not[ \t]+(?:yet[ \t]+)?verified|still[ \t]+fail(?:s|ing)?)\b/i;
  const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
  const problems = [];
  // 2026-07-12 audit fix (MAJOR false-block, found by execution): this used
  // to check EVERY cell in a row via .find(cell => /^done\b/i.test(cell)),
  // not specifically the Status column — a genuinely in-progress task whose
  // Notes cell simply started with the word "Done" ("Done except manual QA
  // still pending, no verification yet") was misclassified as a completed
  // row and blocked for lacking evidence it was never expected to have,
  // even though its actual Status cell plainly said "In Progress". Each
  // markdown table's own header row is now used to find that table's
  // Status column index once; only that specific cell is checked for data
  // rows in that table. `inTable`/`statusColumnIndex` reset whenever a
  // non-`|` line ends a table, so a file with more than one table (a
  // different column order in each) is handled correctly rather than
  // reusing the first table's column index everywhere.
  let inTable = false;
  let statusColumnIndex = null;
  for (const line of lines) {
    // 2026-07-21 audit fix: was `/^\|/` (pipe must be the very first character),
    // the sole outlier — all five sibling gate hooks use `/^\s*\|/`. A markdown
    // table indented 1-3 spaces (which GFM still renders) never entered `inTable`,
    // so verify-progress checked zero rows and returned clean — a false-clean in
    // the very gate that exists to stop an unverified "done". Now tolerates
    // leading whitespace, matching the siblings and SEPARATOR_ROW_RE above.
    if (!/^\s*\|/.test(line)) {
      inTable = false;
      statusColumnIndex = null;
      continue;
    }
    const cells = line.split('|').map((c) => c.trim());
    if (!inTable) {
      // this is a new table's header row
      inTable = true;
      statusColumnIndex = cells.findIndex((c) => /^status$/i.test(c));
      continue;
    }
    if (SEPARATOR_ROW_RE.test(line)) continue; // the `| :-- | :-- |` header divider
    if (statusColumnIndex === null || statusColumnIndex === -1) continue; // this table has no Status column
    // 2026-07-11 Round 7 audit fix (real, found by execution): the exact
    // `/^(done)$/i` match required the status cell to be the literal string
    // "done" and nothing else. A perfectly plausible real edit — "Done ✅",
    // "Done.", "DONE!" — no longer equals "done" exactly, so the row was
    // silently skipped even with zero verified-evidence text: the exact
    // failure mode this whole script exists to catch. Loosened to "starts
    // with the word done", tolerating trailing decoration, while still
    // rejecting a genuinely different word like "undone" (doesn't start
    // with "done") or "donee" (the word-boundary after "done" isn't met).
    const statusCell = cells[statusColumnIndex];
    if (!statusCell || !/^done\b/i.test(statusCell)) continue;
    if (!VERIFIED_RE.test(line) || CONTRADICTION_RE.test(line)) {
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
