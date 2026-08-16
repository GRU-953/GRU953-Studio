#!/usr/bin/env node
//
// Reproduction for the shared-table-reader build — the adjudicated cluster inside
// X138–X173, covering traceability-check D1, D2, D3, D5, D6 and D9.
//
// WHY ONE REPRODUCTION FOR SIX FINDINGS. They are not six defects. They are one cause:
// `traceability-check.mjs` carries its OWN private table parser, and that parser stops
// early in six different ways. `lib.mjs`'s shared `parseTables()` — already used by
// content-check and quality-gate — has none of these faults except the fenced-code one.
// The fix is to make the shared reader fence-aware and move this gate onto it, so the six
// close together and no seventh way of stopping early can be invented per gate.
//
// Each case below still carries its own fixture and its own defect, so no finding rests on
// another's evidence.
//
// EVERY FIXTURE FOLLOWS THE SAME RULE: the input the parser drops contains something the
// gate exists to catch — a requirement marked Met with placeholder verification, a live
// requirement with no task, or a task nobody asked for. If the gate returns clean, that
// defect went unexamined. A parser complaint alone is not enough; the DEFECT must be found.
//
//   case                                                          required
//   D1  REQUIREMENTS.md split into two tables                      the 2nd table is read
//   D5  PROGRESS.md split into two tables                          the 2nd table is read
//   D2  one row written without its leading pipe                   that row is read
//   D6  a stray blank line inside the matrix                       rows below it are read
//   D3  a ```markdown fenced EXAMPLE table above the real matrix   the example is ignored, the real matrix read
//   D9  a row with an unescaped pipe (a shifted, ragged row)       reported, not silently mis-read
//   OK  a correct, single-table project                            clean  (control)
//
// The control matters as much as the six: this gate blocking a healthy project would be far
// worse than the defects, and every one of today's parser changes is a candidate for exactly
// that mistake — one was made and reverted earlier today.
//
// Usage:
//   node X138-shared-table-reader.mjs                # asserts the FIXED state
//   node X138-shared-table-reader.mjs --expect-bug   # asserts the DEFECTS are present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const REQ_HDR = '| ID | Requirement | Tasks | Verification | Status |\n| :-- | :-- | :-- | :-- | :-- |\n';
const PROG_HDR = '| ID | Task | Status | Evidence |\n| :-- | :-- | :-- | :-- |\n';
const GOOD_REQ = REQ_HDR + '| R1 | User can log in | T1 | verified: login suite green | met |\n';
const GOOD_PROG = PROG_HDR + '| T1 | Build login | done | verified: npm test -> 12 passing |\n';
const FOCUS = '# Focus\n\n**Active phase:** 1\n';

/** Run traceability-check on a project and return its verdict. */
function verdict(requirements, progress) {
  const dir = mkdtempSync(join(tmpdir(), 'x138-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'REQUIREMENTS.md'), '# Requirements\n\n' + requirements);
    writeFileSync(join(dir, 'Dev-Memory', 'PROGRESS.md'), '# Progress\n\n' + progress);
    writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), FOCUS);
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'traceability-check.mjs'), [dir]), 'X138-shared-table-reader.mjs', die);
    return { status: v.status, problems: v.problems, code: v.code, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- The control, first: a healthy project must stay clean --------------------
const OK = verdict(GOOD_REQ, GOOD_PROG);
if (OK.status !== 'clean') {
  die(
    `CONTROL FAILED: a correct single-table project was reported ${OK.status}. Blocking a healthy ` +
      `project is worse than any defect below: ${OK.problems[0] || ''}`,
  );
}
console.log('  OK  a correct single-table project ................ clean   (control)');

// ---- The six cases -----------------------------------------------------------
// Each hides "R9 | Audit trail | (no task) | tbd | met" — a requirement marked met with
// placeholder verification AND no task — or an untraced task, in the dropped region.
const HIDDEN_REQ = '| R9 | Audit trail |  | tbd | met |\n';
const HIDDEN_TASK = '| T9 | Add an unrequested extra screen | done | verified: shipped |\n';

const CASES = [
  {
    key: 'D1  REQUIREMENTS split into two tables',
    req: GOOD_REQ + '\n## Phase 2 — non-functional\n\n' + REQ_HDR + HIDDEN_REQ,
    prog: GOOD_PROG,
  },
  {
    key: 'D5  PROGRESS split into two tables',
    req: GOOD_REQ,
    prog: GOOD_PROG + '\n## Phase 2\n\n' + PROG_HDR + HIDDEN_TASK,
  },
  {
    key: 'D6  a stray blank line inside the matrix',
    req: GOOD_REQ + '\n' + HIDDEN_REQ,
    prog: GOOD_PROG,
  },
  {
    key: 'D3  a fenced EXAMPLE table above the real matrix',
    req: '```markdown\n' + REQ_HDR + '| R0 | example row | T0 | verified: example | met |\n```\n\n' + GOOD_REQ + HIDDEN_REQ,
    prog: GOOD_PROG,
  },
];

const open = [];
for (const c of CASES) {
  const v = verdict(c.req, c.prog);
  const caught = v.status !== 'clean';
  console.log(`  ${c.key.padEnd(46)} ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- dropped, unexamined'}`);
  if (!caught) open.push(c.key.split(' ')[0]);
}

// D9: a ragged row must be REPORTED, not silently mis-read into the wrong columns.
{
  const ragged = GOOD_REQ + '| R9 | Audit trail | T1 | T2 | met | tbd |\n';
  const v = verdict(ragged, GOOD_PROG);
  const caught = v.status !== 'clean';
  console.log(`  D9  a ragged row (unescaped pipe) .............. ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- silently mis-read'}`);
  if (!caught) open.push('D9');
}

// ---- D7: a later section that REORDERS its columns must not be trusted --------
// P6 round 1, finding L3 — a guard that was written and never wired up.
//
// Merging every matching table means later rows are read positionally against the FIRST
// table's headers. The hazard was seen and a guard written for it — mismatchedFragments —
// and then nothing ever read it. So a REQUIREMENTS.md whose second section swaps two column
// positions has its rows silently judged against the wrong columns, and a requirement marked
// "met" with an empty Verification cell passes as clean. Rows in that section are not ragged
// against their OWN header, so the ragged check does not fire either.
//
// The byte-identical row in a canonically-ordered section BLOCKS, which is what makes this a
// false clean rather than a difference of opinion.
{
  const REORDERED_HDR = '| ID | Requirement | Tasks | Status | Verification |\n| :-- | :-- | :-- | :-- | :-- |\n';
  const v = verdict(
    GOOD_REQ + '\n## Phase 2\n\n' + REORDERED_HDR + '| R9 | the user can log out | T9 | met |  |\n',
    GOOD_PROG + '| T9 | Build logout | done | verified: `npm test` -> exit 0 (2026-08-15) |\n',
  );
  const caught = v.status !== 'clean';
  console.log(`  D7  a later section that REORDERS its columns .. ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- P6 L3'}`);
  if (!caught) open.push('D7');
}

// ---- D2: DELIBERATELY NOT FIXED, and checked so the decision cannot rot -------
// A row written without its leading pipe, inside an otherwise piped table, is still
// dropped. Reading it would mean deciding that a pipe-bearing line IS data — and this
// codebase already carries finding F6, where exactly that rule read the prose line
// "Notes: filtered with `grep -v warn | head -20`." as a malformed row and blocked a
// healthy project with advice that was simply wrong.
//
// A false alarm on ordinary prose is worse than this gap, and an equivalent guess caused a
// regression here earlier the same day. So it stays open, disclosed in RESIDUALS.md.
//
// This case is asserted in its CURRENT state rather than left unmentioned. If someone
// later teaches the parser to read these rows, this assertion fails and they must come
// here, read the reasoning, and change the decision on purpose.
{
  const v = verdict(GOOD_REQ + 'R9 | Audit trail |  | tbd | met |\n', GOOD_PROG);
  const stillOpen = v.status === 'clean';
  console.log(`  D2  a row without its leading pipe ............. ${stillOpen ? 'clean  ' : 'BLOCKED'}  <- KNOWN GAP, disclosed`);
  if (!stillOpen) {
    die(
      'D2 now blocks. That may be an improvement, but it may also be the F6 false alarm ' +
        'returning — a pipe inside ordinary prose read as a malformed row. Re-read the note ' +
        'above this check, confirm prose with a pipe is still safe, then update RESIDUALS.md ' +
        'and this assertion deliberately.',
    );
  }
}

if (expectBug) {
  if (open.length === 0) die('expected the parser defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nREPRODUCED: ${open.length} of 6 — ${open.join(', ')} dropped input containing a real defect.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: every table, row and region is read, fenced examples are ignored, and a healthy project stays clean.');
  process.exit(0);
}

die(
  `OPEN — ${open.join(', ')}. traceability-check carries its own table parser that stops early in ` +
    'six different ways, so input holding a real defect is dropped and the gate reports clean. ' +
    "Fix: make lib.mjs's shared parseTables() fence-aware and move this gate onto it.",
);
