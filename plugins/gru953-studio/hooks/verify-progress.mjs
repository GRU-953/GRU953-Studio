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
import { splitPipeCells } from './lib.mjs';

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
  // 2026-07-21 Round 11 audit fix (fail-open on unrecognised table shape,
  // medium): this hook is the SOLE mechanical enforcer of "a task may only be
  // marked done with a verified: line", yet it used to fail OPEN whenever it
  // could not name the Status column — silently returning clean and shipping a
  // done-but-unverified task. Two gaps: (1) it matched the header cell only as
  // the exact bare word `status`, so a bolded `**Status**`, a synonym `State`,
  // or a composite `Task Status` header made the column unfindable → every row
  // skipped → clean; (2) it required a leading pipe, so a pipe-less GFM table
  // (outer pipes omitted — valid, renders on GitHub) never entered table mode at
  // all → clean. Its four sibling publish gates (quality-gate,
  // traceability-check, …) all fail CLOSED on the same ambiguity; this one now
  // does too. Fixes: broaden Status detection (strip emphasis, accept
  // Status/State incl. a composite last word), recognise pipe-less GFM tables
  // (a header line immediately followed by a separator row), and fail CLOSED
  // when a task table carries a "done" cell but no identifiable Status column.
  //
  // De-emphasise a header cell (strip surrounding **bold**/__bold__/*italic*/
  // _italic_/`code`), then treat it as the Status column if its LAST word is
  // "status" or "state" — so "Status", "**Status**", "`State`", "Task Status"
  // and "Build State" all qualify. "Progress" is deliberately NOT a synonym: a
  // Progress column may hold "100%" rather than a status word, and accepting it
  // could shadow a real Status column and re-open a false-clean.
  const deEmphasise = (c) => c.replace(/^[\s*_`]+/, '').replace(/[\s*_`]+$/, '');
  const isStatusHeader = (c) => {
    const w = deEmphasise(c).toLowerCase().split(/\s+/).filter(Boolean);
    const last = w[w.length - 1];
    return last === 'status' || last === 'state';
  };
  // A table row is any non-blank line containing a pipe (covers both the piped
  // `| a | b |` form and the pipe-less `a | b` form); a blank or pipe-less line
  // ends the table.
  const looksLikeRow = (l) => l.trim() !== '' && l.includes('|');

  const problems = [];      // "done" rows carrying no verified: evidence
  const unidentified = [];  // task table(s) with a "done" cell but no Status column (fail CLOSED)

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    // A GFM table header is a non-blank, non-separator line with at least one
    // pipe that is EITHER immediately followed by a separator row (true GFM —
    // works with or without outer pipes) OR itself starts with a leading pipe
    // (a piped table, as before). This is what lets pipe-less tables be seen.
    const isHeader =
      header.trim() !== '' &&
      header.includes('|') &&
      !SEPARATOR_ROW_RE.test(header) &&
      (SEPARATOR_ROW_RE.test(next) || /^\s*\|/.test(header));
    if (!isHeader) continue;

    const statusColumnIndex = splitPipeCells(header).map((c) => c.trim()).findIndex(isStatusHeader);
    let sawDoneUnknown = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const row = lines[j];
      if (!looksLikeRow(row)) break; // a blank / pipe-less line ends the table
      if (SEPARATOR_ROW_RE.test(row)) continue; // the `| :-- | :-- |` divider
      const cells = splitPipeCells(row).map((c) => c.trim());
      if (statusColumnIndex === -1) {
        // Status column unidentifiable: fail CLOSED if any cell claims "done" —
        // the exact ambiguity this gate exists to catch. A table with no "done"
        // cell makes no completion claim, so it is left alone (no false block).
        if (cells.some((c) => /^done\b/i.test(c))) sawDoneUnknown = true;
        continue;
      }
      // 2026-07-11 Round 7 fix: "starts with the word done" (tolerates "Done ✅",
      // "Done.", "DONE!") while rejecting "undone"/"donee".
      const statusCell = cells[statusColumnIndex];
      if (!statusCell || !/^done\b/i.test(statusCell)) continue;
      if (!VERIFIED_RE.test(row) || CONTRADICTION_RE.test(row)) problems.push(row.trim());
    }
    if (statusColumnIndex === -1 && sawDoneUnknown) unidentified.push(header.trim());
    i = j - 1; // resume after this table (the for-loop's i++ advances to j)
  }

  if (problems.length === 0 && unidentified.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'every "done" row has a verified: cell' }, null, 2));
    process.exit(0);
  }
  const out = { status: 'BLOCKED' };
  if (problems.length) {
    out.reason = '"done" rows missing a verified: cell';
    out.rows = problems;
  }
  if (unidentified.length) {
    if (!out.reason) out.reason = 'a task table has a "done" row but no identifiable Status column — cannot verify';
    out.unidentifiedStatusColumn = unidentified;
    out.hint = 'Name the completion column "Status" (or "State") so "done" rows can be checked for verified: evidence. Failing closed.';
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

main();
