#!/usr/bin/env node
//
// Reproduction for verify-progress D6 (adjudicated 2026-08-15) — a task table torn in two by
// a blank line has its first row below the tear consumed as a HEADER, so a completion claim
// there is never evidence-checked.
//
// THE DEFECT. The scanner ends a table at a blank line, then resumes looking for a header —
// and any pipe-led line qualifies. So in:
//
//     | ID | Task | Status | Evidence |
//     | :-- | :-- | :-- | :-- |
//     | T1 | Build login | done | verified: `npm test` -> exit 0 |
//                                                     <- one stray blank line
//     | T5 | Payments | done | tbd |
//
// the T5 line becomes the header of a new table with no rows. It claims completion with a
// placeholder for evidence, and nothing checks it. The gate reports clean.
//
// Proven to be the tear, not the row: the IDENTICAL T5 line with no blank line above it
// blocks. Control C below holds that comparison, because a defect that cannot be attributed
// is not a defect that has been understood.
//
// WHAT THIS DOES *NOT* DO, and why. It does not read the orphan as a data row. That means
// deciding a pipe-led line is data rather than a heading, and guessing is what produced a
// false-alarm regression in this codebase earlier today. It is REPORTED instead, on a
// measured signal: a fragment with exactly as many columns as a real task table above it,
// carrying a completion claim and no Status column of its own, is a torn table. A genuine
// table headed `| Task | Done | Notes |` has no such predecessor to match, so it is untouched
// — control D holds exactly that shape.
//
//   case                                                          required
//   A  a healthy single table                                      clean   (control)
//   B  an unevidenced done row, torn off by a blank line            BLOCKED <- D6
//   C  the same row with NO blank line above it                     BLOCKED (control: attribution)
//   D  a standalone table legitimately headed | Task | Done |       clean   (control: no false alarm)
//   E  a blank line between two HEALTHY halves                      clean   (control: tears are not defects)
//
// Usage:
//   node X142-torn-progress-table.mjs                # asserts the FIXED state
//   node X142-torn-progress-table.mjs --expect-bug   # asserts the DEFECT is present

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

function verdict(progress) {
  const dir = mkdtempSync(join(tmpdir(), 'x142-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'PROGRESS.md'), progress);
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'verify-progress.mjs'), [dir]), 'X142-torn-progress-table.mjs', die);
    return { status: v.status, problems: v.problems, code: v.code, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HDR = '# Progress\n\n| ID | Task | Status | Evidence |\n| :-- | :-- | :-- | :-- |\n';
const GOOD = '| T1 | Build login | done | verified: `npm test` -> exit 0 (2026-08-15) |\n';
const UNEVIDENCED = '| T5 | Payments | done | tbd |\n';

// ---- Controls ----------------------------------------------------------------
const A = verdict(HDR + GOOD);
if (A.status !== 'clean') die(`control A failed: a healthy table must pass, got ${A.status}`);
console.log('  A  a healthy single table ....................... clean   (control)');

const C = verdict(HDR + GOOD + UNEVIDENCED);
if (C.status === 'clean') die('control C failed: an unevidenced done row inside the table must be caught — the gate is not working at all.');
console.log('  C  the same row, NO blank line above it ......... BLOCKED (control: attribution)');

// ---- The defect --------------------------------------------------------------
const B = verdict(HDR + GOOD + '\n' + UNEVIDENCED);
const caught = B.status !== 'clean';
console.log(`  B  the row torn off by a blank line ............. ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- D6'}`);

// ---- Control D: a legitimate table with a "Done" column must not be flagged ---
const D = verdict('# Progress\n\n| Task | Done | Notes |\n| :-- | :-- | :-- |\n| Ship it | yes | all good |\n');
if (D.status !== 'clean') {
  die(
    `control D failed: a standalone table headed "| Task | Done | Notes |" was reported ${D.status}. ` +
      'A column NAMED Done is not a torn fragment, and flagging it would be a false alarm on an ' +
      `ordinary table: ${JSON.stringify(D.problems).slice(0, 200)}`,
  );
}
console.log('  D  standalone | Task | Done | Notes | .......... clean   (control)');

// ---- Control G: an ORDINARY SECOND TABLE must not be eaten -------------------
// P6 round 1, finding L2 — a regression this file's own control D missed.
//
// D covers a table headed `| Task | Done | Notes |` with NO predecessor, which is the case
// that cannot fire. With a real task table above it, all three torn-fragment conditions are
// satisfied by a perfectly ordinary second table: no Status column, the same column count,
// and a cell reading "Done" — which X139 had just widened into a completion word hours
// earlier. Its HEADER line was then consumed as a data row and reported as a done row with
// no evidence, blocking a checkpoint and a Publish with a message naming a header as a row.
//
// The discriminator is markdown's own: a line followed by a separator row IS a header. A
// torn continuation row never has one beneath it.
{
  // The column counts must MATCH for the torn-fragment condition to fire at all — an earlier
  // draft of this control used a 4-column first table against a 3-column second and therefore
  // proved nothing. This is the round's own verified fixture: three columns either side.
  const legitimate =
    '# Progress\n\n| Task | Status | Notes |\n| :-- | :-- | :-- |\n' +
    '| T1 build the parser | done | verified: `npm test` -> exit 0 (2026-08-15) |\n' +
    '\n## Phase 2 checklist\n\n| Task | Done | Notes |\n| :-- | :-- | :-- |\n' +
    '| T3 draft the docs | no | in progress |\n';
  const v = verdict(legitimate);
  if (v.status !== 'clean') {
    die(
      'control G failed: an ordinary second table headed "| Task | Done | Notes |", following a ' +
        'real task table, was reported ' + v.status + '. Its header is being eaten as a data row — ' +
        'the P6 round 1 L2 regression. A line followed by a separator row is a HEADER: ' +
        JSON.stringify(v.problems).slice(0, 200),
    );
  }
  console.log('  G  an ordinary second table, WITH a predecessor . clean   (control: P6 L2)');
}

// ---- Control E: a tear between two HEALTHY halves is not a defect -------------
const E = verdict(HDR + GOOD + '\n' + '| T2 | Build logout | done | verified: `npm test` -> exit 0 (2026-08-15) |\n');
if (E.status !== 'clean') {
  die(
    `control E failed: a blank line between two properly evidenced rows was reported ${E.status}. ` +
      'A tear is only worth reporting when something below it goes unchecked; reporting every ' +
      `tear would make this gate noisy on healthy files: ${JSON.stringify(E.problems).slice(0, 200)}`,
  );
}
console.log('  E  a tear between two HEALTHY halves ............ clean   (control)');

if (expectBug) {
  if (caught) die('expected the D6 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log('\nD6 REPRODUCED: a blank line hides a completion claim from the gate that exists to check it.');
  process.exit(0);
}

if (caught) {
  console.log('\nPASS: a torn table is reported, an ordinary Done column is not, and a healthy tear stays quiet.');
  process.exit(0);
}

die(
  'D6 is OPEN: a blank line ends the table and the next pipe-led line is consumed as a HEADER, ' +
    'so its completion claim is never evidence-checked. Control C proves the tear is the cause. ' +
    'Fix: report a fragment that has the same width as a real task table above it, carries a ' +
    'completion claim, and has no Status column of its own.',
);
