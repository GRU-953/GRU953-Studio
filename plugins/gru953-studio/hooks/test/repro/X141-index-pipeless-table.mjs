#!/usr/bin/env node
//
// Reproduction for memory-integrity D9 (High, adjudicated 2026-08-15) — an INDEX.md written
// without outer pipes is validated in no respect at all, and reported clean.
//
// THE DEFECT. checkIndex() walks lines itself and enters table mode only on a line beginning
// with a pipe:
//
//     if (!/^\s*\|/.test(line)) { inTable = false; whereCol = -1; continue; }
//
// Outer pipes are OPTIONAL in GitHub-flavoured markdown. These two render identically:
//
//     | What | Where |            What | Where
//     | :-- | :-- |               :-- | :--
//     | the plan | PLAN.md |       the plan | PLAN.md
//
// The second is never recognised, so every row is skipped and the gate reports
// "recall index and knowledge graph are internally consistent" about an index whose entries
// point at files that do not exist. That is this gate's entire job.
//
// THIS IS THE THIRD PRIVATE PARSER FOUND IN THE SAME SWEEP, and the third with a fault the
// shared reader does not have. `lib.mjs`'s parseTables() has recognised pipe-less tables
// since it was written — traceability-check was moved onto it earlier today, and this is the
// same move for the same reason. The fix is a deletion.
//
//   case                                                      required
//   A  a piped index pointing at a missing file                BLOCKED (control: it works)
//   B  a piped index pointing at a real file                   clean   (control)
//   C  a PIPE-LESS index pointing at a missing file            BLOCKED <- D9
//   D  a pipe-less index pointing at a real file               clean   (control: no false alarm)
//   E  a table with no recognisable Where column               BLOCKED (control: already reported)
//
// Control D matters: recognising these tables must not start flagging healthy ones. Control E
// guards the behaviour a 2026-07-29 fix added deliberately — an unrecognised header is
// reported, not skipped — so moving parsers must not lose it.
//
// Usage:
//   node X141-index-pipeless-table.mjs                # asserts the FIXED state
//   node X141-index-pipeless-table.mjs --expect-bug   # asserts the DEFECT is present

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

/** Write an INDEX.md, optionally create the file it points at, and run the gate. */
function verdict(index, realFile) {
  const dir = mkdtempSync(join(tmpdir(), 'x141-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'INDEX.md'), index);
    if (realFile) writeFileSync(join(dir, 'Dev-Memory', realFile), '# real\n');
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X141-index-pipeless-table.mjs', die);
    return { status: v.status, problems: v.problems, code: v.code, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const piped = (target) =>
  `# Index\n\n| What | Where |\n| :-- | :-- |\n| the plan | ${target} |\n`;
// The same table with outer pipes omitted — valid GFM, renders identically.
const pipeless = (target) => `# Index\n\nWhat | Where\n:-- | :--\nthe plan | ${target}\n`;

// ---- Controls on the recognised form -----------------------------------------
const A = verdict(piped('GONE.md'));
if (A.status === 'clean') die('control A failed: a piped index pointing at a missing file must be caught — the gate is not working at all.');
console.log('  A  piped index -> missing file .................. BLOCKED (control)');

const B = verdict(piped('REAL.md'), 'REAL.md');
if (B.status !== 'clean') die(`control B failed: a piped index pointing at a real file must pass, got ${B.status}: ${B.problems[0] || ''}`);
console.log('  B  piped index -> real file ..................... clean   (control)');

// ---- The defect --------------------------------------------------------------
const C = verdict(pipeless('GONE.md'));
const caught = C.status !== 'clean';
console.log(`  C  PIPE-LESS index -> missing file .............. ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- D9'}`);

// ---- Control D: recognising them must not flag healthy ones -------------------
const D = verdict(pipeless('REAL.md'), 'REAL.md');
if (D.status !== 'clean') {
  die(
    `control D failed: a pipe-less index pointing at a REAL file was reported ${D.status}. ` +
      `Recognising these tables must not start flagging healthy ones: ${D.problems[0] || ''}`,
  );
}
console.log('  D  pipe-less index -> real file ................. clean   (control)');

// ---- Control E: an unrecognised header must still be reported -----------------
// A 2026-07-29 fix made this a problem rather than a silent skip. Moving parsers must not
// quietly undo it.
const E = verdict('# Index\n\n| Thing | Notes |\n| :-- | :-- |\n| the plan | see below |\n');
if (E.status === 'clean') {
  die('control E failed: a table with no recognisable Where column must still be reported — a 2026-07-29 fix made that deliberate, and this change must not undo it.');
}
console.log('  E  no recognisable Where column ................. BLOCKED (control)');

if (expectBug) {
  if (caught) die('expected the D9 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log('\nD9 REPRODUCED: a pipe-less INDEX.md is validated in no respect and reported clean.');
  process.exit(0);
}

if (caught) {
  console.log('\nPASS: an index is checked whichever way its table is written, and healthy ones still pass.');
  process.exit(0);
}

die(
  'D9 is OPEN: checkIndex enters table mode only on a line starting with a pipe, but outer ' +
    'pipes are optional in GitHub-flavoured markdown, so a perfectly ordinary index is skipped ' +
    'entirely and its stale references go unreported. ' +
    "Fix: delete the private walk and read through lib.mjs's shared parseTables(), which has " +
    'handled pipe-less tables since it was written.',
);
