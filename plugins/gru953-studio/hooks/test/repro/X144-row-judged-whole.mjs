#!/usr/bin/env node
//
// Reproduction for quality-gate D2, D3 and D4 (adjudicated 2026-08-15) — one shape:
//
//     the row is judged by ONE cell, so a failure recorded in any other cell is invisible.
//
//   D3  the contradiction check reads the EVIDENCE cell only, so a status cell reading
//       "pass, but 3 still failing" passes — PASS_RE is prefix-anchored and matches "pass".
//   D4  idx.evidence takes the FIRST matching column, so with
//       | Item | Status | Evidence | Notes | a Notes cell reading "re-run today: exit code 1"
//       is never read at all.
//   D2  `if (!item) continue;` drops any row with a blank Item cell BEFORE anything is read,
//       so a continuation row `|  | fail | e2e suite: exit code 1, 3 failing |` vanishes.
//
// THE CONSTRAINT THAT SHAPES THE FIX, and it is not obvious from the findings.
// A fix on 2026-08-05 deliberately NARROWED this check to the evidence cell, because
// CONTRADICTION_RE ran against the whole raw row and the word "Regression" in an item's NAME
// — `| Regression tests | pass | \`npm test\` -> exit 0 |` — wrongly blocked a green row.
//
// So "scan the whole row" would reintroduce a defect someone already fixed. The rule instead
// is: scan every cell EXCEPT the item's name. The name is a label; every other cell is a
// claim. Control E holds that exact regression row so this cannot be undone by accident.
//
//   case                                                          required
//   A  a complete passing table                                    clean   (control)
//   B  status cell "pass, but 3 still failing"                      BLOCKED <- D3
//   C  a 4th column "Notes" recording exit code 1                   BLOCKED <- D4
//   D  a blank-Item row recording "exit code 1, 3 failing"          BLOCKED <- D2
//   E  an item NAMED "Regression tests", genuinely green            clean   (control: the 08-05 fix)
//   F  a blank-Item spacer row saying nothing alarming              clean   (control: no false alarm)
//
// Usage:
//   node X144-row-judged-whole.mjs                # asserts the FIXED state
//   node X144-row-judged-whole.mjs --expect-bug   # asserts the DEFECTS are present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function verdict(qg) {
  const dir = mkdtempSync(join(tmpdir(), 'x144-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'QUALITY-GATE.md'), qg);
    const r = spawnSync(process.execPath, [join(HOOKS, 'quality-gate.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    try {
      const j = JSON.parse(out);
      return { status: j.status, problems: j.problems || [] };
    } catch {
      return { status: 'unparsed', problems: [], raw: out.slice(0, 200) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HDR = '# Quality Gate\n\n| Item | Status | Evidence |\n| :-- | :-- | :-- |\n';
const ROWS =
  '| acceptance criteria proven | pass | `npm run accept` -> exit 0 |\n' +
  '| tests pass | pass | `npm test` -> exit 0 |\n' +
  '| independent code review | pass | reviewed by a second reader |\n' +
  '| security and licence clean | pass | `npm audit` -> 0 vulnerabilities |\n' +
  '| accessibility | n/a | no user interface in this change |\n' +
  '| documentation updated | pass | README section added |\n' +
  '| reproducible build | pass | `npm run build` -> exit 0 |\n';

const A = verdict(HDR + ROWS);
if (A.status !== 'clean') die(`control A failed: a complete passing table must be clean, got ${A.status}: ${A.problems[0] || ''}`);
console.log('  A  a complete passing table ..................... clean   (control)');

// ---- D3 ----------------------------------------------------------------------
const B = verdict(HDR + ROWS.replace('| tests pass | pass |', '| tests pass | pass, but 3 still failing |'));
const bCaught = B.status !== 'clean';
console.log(`  B  status "pass, but 3 still failing" ........... ${bCaught ? 'BLOCKED' : 'clean  '}${bCaught ? '' : '  <- D3'}`);

// ---- D4 ----------------------------------------------------------------------
const HDR4 = '# Quality Gate\n\n| Item | Status | Evidence | Notes |\n| :-- | :-- | :-- | :-- |\n';
const ROWS4 = ROWS.split('\n').filter(Boolean).map((r) => `${r} — |`).join('\n') + '\n';
const C = verdict(
  HDR4 + ROWS4.replace('| tests pass | pass | `npm test` -> exit 0 | — |', '| tests pass | pass | `npm test` -> exit 0 | re-run today: exit code 1, 3 failing |'),
);
const cCaught = C.status !== 'clean';
console.log(`  C  a 4th "Notes" column recording exit code 1 ... ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- D4'}`);

// ---- D2 ----------------------------------------------------------------------
const D = verdict(HDR + ROWS + '|  | fail | e2e suite: exit code 1, 3 failing |\n');
const dCaught = D.status !== 'clean';
console.log(`  D  a blank-Item row recording exit code 1 ....... ${dCaught ? 'BLOCKED' : 'clean  '}${dCaught ? '' : '  <- D2'}`);

// ---- E: the 2026-08-05 fix must survive --------------------------------------
const E = verdict(HDR + ROWS.replace('| tests pass | pass |', '| Regression tests | pass |'));
if (E.status !== 'clean') {
  die(
    'control E failed: an item NAMED "Regression tests", genuinely green, was blocked. A fix on ' +
      '2026-08-05 narrowed this check to the evidence cell for exactly that reason, and scanning ' +
      `the whole row would undo it: ${E.problems[0] || ''}`,
  );
}
console.log('  E  item named "Regression tests", green ......... clean   (control: the 08-05 fix)');

// ---- F: an ordinary spacer row must not be flagged ---------------------------
const F = verdict(HDR + ROWS + '|  |  | (spacer row) |\n');
if (F.status !== 'clean') {
  die(`control F failed: a blank-Item spacer row saying nothing alarming was blocked: ${F.problems[0] || ''}`);
}
console.log('  F  a blank-Item spacer row ...................... clean   (control)');

const open = [];
if (!bCaught) open.push('D3 (status cell unscanned)');
if (!cCaught) open.push('D4 (extra columns unread)');
if (!dCaught) open.push('D2 (blank-Item rows dropped)');

if (expectBug) {
  if (open.length === 0) die('expected these defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nREPRODUCED: ${open.join(', ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: every cell but the item\'s name is a claim and is read; the name is still only a label.');
  process.exit(0);
}

die(
  `OPEN — ${open.join(', ')}. The contradiction check reads one cell, so a failure recorded ` +
    'anywhere else is invisible. Fix: scan every cell EXCEPT the item name — the name is a label, ' +
    'every other cell is a claim — and stop dropping a row before its cells are read.',
);
