#!/usr/bin/env node
//
// Reproduction for X192 and X193 (both High, P6 convergence round 2) — two defects in
// traceability-check.mjs, one on each side of the same shared table reader.
//
// ---------------------------------------------------------------------------------------
// X192 — the same fix landed for REQUIREMENTS.md and not for PROGRESS.md.
//
// parseTable() returns three warnings about tables it could not read with confidence:
// `mismatchedFragments` (a later table whose columns differ, so its rows would be read against
// the WRONG columns), `orphanedFragments` (a table torn in two, so the rows below the tear go
// unchecked), and `ragged` on any row whose cell count disagrees with its header.
//
// The REQUIREMENTS branch consumes all three — that was finding X138 / P6-L3, fixed in round 1.
// The PROGRESS branch consumes none of them. Same file, same function, same defect, fixed once.
// Measured from the project's own golden fixture, which is clean at baseline:
//
//     a mismatched later table in REQUIREMENTS.md  -> BLOCKED
//     the identical defect in PROGRESS.md          -> clean, 0 problems
//
// It matters because PROGRESS.md's ID column is what the dangling-reference and scope-creep
// checks match against. Read a later fragment positionally against the first table's headers
// and the ids come out of whatever column happens to sit at that index.
//
// ---------------------------------------------------------------------------------------
// X193 — a repeated header is called "different columns" because of its styling.
//
// `mismatched` compares header cells by RAW join:
//
//     matching.slice(1).filter((t) => t.headerCells.join(' ') !== headers.join(' '))
//
// but every other consumer of those same headers resolves them through deEmphasise() and a
// case-insensitive regex (see col(), and :265). So a second section repeating the FIRST
// section's header in bold, or in a different case, is reported as a table whose columns
// differ — a false alarm on a healthy file, in a blocking Publish check. Measured against the
// golden fixture's own header:
//
//     | ID | Requirement | Phase | Tasks | Verification | Status |   repeated verbatim  -> quiet
//     the same header in **bold**                                                      -> FLAGGED
//     the same header in UPPERCASE                                                     -> FLAGGED
//     genuinely reordered columns                                                      -> FLAGGED (correct)
//
//   case                                                      required
//   A  the golden fixture, untouched                           clean   (control: baseline)
//   B  a mismatched later table in REQUIREMENTS.md             BLOCKED (control: works already)
//   C  the identical defect in PROGRESS.md                     BLOCKED <- X192
//   D  a ragged row in PROGRESS.md whose id DOES trace         BLOCKED <- X192
//   E  the golden header repeated VERBATIM                     clean   (control)
//   F  the golden header repeated in **bold**                  clean   <- X193
//   G  the golden header repeated in UPPERCASE                 clean   <- X193
//   H  a genuinely REORDERED header                            BLOCKED (control: must still fire)
//
// Controls B, E and H are what stop this from being satisfied by a gate that has simply gone
// quiet, or by one that flags everything.
//
// Usage:
//   node X192-X193-traceability-progress-and-headers.mjs                # asserts the FIXED state
//   node X192-X193-traceability-progress-and-headers.mjs --expect-bug   # asserts the DEFECTS

import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const GOLDEN = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Run traceability-check against the golden fixture, optionally mutated. Golden is used rather
 * than a hand-built project because it is the negative control the whole gate suite already
 * relies on: a baseline that is clean for reasons nobody has to argue about.
 */
function verdict(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x192-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    cpSync(GOLDEN, join(dir, 'Dev-Memory'), { recursive: true });
    if (mutate) mutate(join(dir, 'Dev-Memory'));
    const v = refuseCrash(
      readGate(NODE, join(HOOKS, 'traceability-check.mjs'), [dir]),
      'X192-X193',
      die,
    );
    return { status: v.status, problems: v.problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MISMATCH_SAYS = 'columns differ';
const RAGGED_SAYS = 'different number of cells';

const goldenReq = readFileSync(join(GOLDEN, 'REQUIREMENTS.md'), 'utf8');
const goldenProg = readFileSync(join(GOLDEN, 'PROGRESS.md'), 'utf8');
const reqHeader = goldenReq.split('\n').find((l) => /^\s*\|/.test(l));
const firstTaskId = (goldenProg.match(/^\|\s*(T\d+)\s*\|/m) || [])[1];
if (!reqHeader || !firstTaskId)
  die(
    `cannot read the golden fixture's own shape (header=${reqHeader}, id=${firstTaskId}) — the fixture changed and this reproduction must be re-read before it is trusted.`,
  );

const sepFor = (header) =>
  `|${header
    .split('|')
    .filter((s) => s.trim())
    .map(() => ' :-- ')
    .join('|')}|`;
const appendTable = (file, header, row) => (dm) =>
  appendFileSync(join(dm, file), `\n## A later phase\n\n${header}\n${sepFor(header)}\n${row}\n`);

// ---- A: baseline ---------------------------------------------------------------
const A = verdict(null);
if (A.status !== 'clean')
  die(
    `control A failed: the golden fixture must be clean at baseline, got ${A.status}: ${A.problems[0] || ''}`,
  );
console.log('  A  the golden fixture, untouched ............... clean   (control)');

// ---- B: the branch that already works -------------------------------------------
const B = verdict(
  appendTable(
    'REQUIREMENTS.md',
    '| Requirement | ID | Tasks | Verification |',
    '| a later need | R90 | T1 | T1 |',
  ),
);
if (!B.problems.some((p) => String(p).includes(MISMATCH_SAYS))) {
  die(
    `control B failed: a mismatched later table in REQUIREMENTS.md must be reported — that branch was fixed in round 1, so if it is quiet the shared reader has broken: ${B.problems[0] || ''}`,
  );
}
console.log('  B  a mismatched later table in REQUIREMENTS.md . BLOCKED (control)');

// ---- C: X192 --------------------------------------------------------------------
const C = verdict(
  appendTable(
    'PROGRESS.md',
    '| Task | ID | Status | Evidence |',
    `| a later task | ${firstTaskId} | done | proof |`,
  ),
);
const cCaught = C.problems.some((p) => String(p).includes(MISMATCH_SAYS));
console.log(
  `  C  the identical defect in PROGRESS.md ......... ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- X192'}`,
);

// ---- D: X192, the ragged half ---------------------------------------------------
// The id is one the fixture already has, so the row cannot be caught incidentally by the
// scope-creep check — which is exactly how this looked "blocked" on a first, sloppier reading.
const D = verdict((dm) =>
  appendFileSync(join(dm, 'PROGRESS.md'), `| ${firstTaskId} | a short row |\n`),
);
const dCaught = D.problems.some((p) => String(p).includes(RAGGED_SAYS));
console.log(
  `  D  a ragged PROGRESS row whose id DOES trace ... ${dCaught ? 'BLOCKED' : 'clean  '}${dCaught ? '' : '  <- X192'}`,
);

// ---- C2: X197 — the false alarm the FIRST version of the X192 fix carried in ----------
// P6 round 3 found that reporting a mismatch for EVERY later table containing an id-ish column
// blocked a perfectly healthy PROGRESS.md: an ordinary "## Notes" table headed
// | Task | Owner | Note | matched on "Task", was merged, and was then reported as columns that
// differ. A torn fragment of a table has the SAME number of columns, because it is the same
// table; a different width is a separate table and must be left alone.
const NOTES_TABLE = (dm) =>
  appendFileSync(
    join(dm, 'PROGRESS.md'),
    '\n## Notes\n\n| Task | Owner | Note |\n| :-- | :-- | :-- |\n| T1 | me | went fine |\n',
  );
const C2 = verdict(NOTES_TABLE);
if (C2.problems.some((p) => String(p).includes(MISMATCH_SAYS))) {
  die(
    'control C2 failed: an ordinary "## Notes" table of a DIFFERENT width was reported as a ' +
      'column mismatch. It cannot be a positional continuation of a four-column task table, so ' +
      `it is a separate table and must be left alone (finding X197): ${C2.problems.find((p) => String(p).includes(MISMATCH_SAYS))}`,
  );
}
console.log('  C2 an ordinary "## Notes" table of another width  clean   (control: X197)');

// ---- E, F, G, H: header matching -------------------------------------------------
const repeatHeader = (header) => (dm) => {
  const p = join(dm, 'REQUIREMENTS.md');
  writeFileSync(
    p,
    `${readFileSync(p, 'utf8')}\n## A later phase\n\n${header}\n${sepFor(header)}\n| R90 | a later need | 2 | T1 | T1 | done |\n`,
  );
};
const flagged = (v) => v.problems.some((p) => String(p).includes(MISMATCH_SAYS));

const E = verdict(repeatHeader(reqHeader));
if (flagged(E))
  die(
    `control E failed: a later section repeating the header VERBATIM must not be called a column mismatch: ${E.problems.find((p) => String(p).includes(MISMATCH_SAYS))}`,
  );
console.log('  E  the header repeated verbatim ................ clean   (control)');

const boldHeader = reqHeader.replace(/\|\s*([^|]+?)\s*(?=\|)/g, (m, c) => `| **${c.trim()}** `);
const F = verdict(repeatHeader(boldHeader));
const fFalseAlarm = flagged(F);
console.log(
  `  F  the same header in **bold** ................. ${fFalseAlarm ? 'FLAGGED' : 'clean  '}${fFalseAlarm ? '  <- X193' : ''}`,
);

const G = verdict(repeatHeader(reqHeader.toUpperCase()));
const gFalseAlarm = flagged(G);
console.log(
  `  G  the same header in UPPERCASE ................ ${gFalseAlarm ? 'FLAGGED' : 'clean  '}${gFalseAlarm ? '  <- X193' : ''}`,
);

const H = verdict(repeatHeader('| Requirement | ID | Verification | Tasks | Status | Phase |'));
if (!flagged(H)) {
  die(
    'control H failed: a GENUINELY reordered header must still be reported. Normalising the ' +
      'comparison must remove styling differences only — if it also swallows a real column ' +
      'reordering, this fix has replaced a false alarm with a false clean, which is worse.',
  );
}
console.log('  H  a genuinely reordered header ................ BLOCKED (control)');

const open = [];
if (!cCaught) open.push('X192 (PROGRESS mismatched fragments unreported)');
if (!dCaught) open.push('X192 (PROGRESS ragged rows unreported)');
if (fFalseAlarm) open.push('X193 (a bold header is called a column mismatch)');
if (gFalseAlarm) open.push('X193 (an uppercase header is called a column mismatch)');

// ---- I, J: RE-OPENED 2026-08-18 — the SYNONYM axis, wrong in both directions ----
//
// Cases E, F, G and H vary the header's DECORATION and ORDER. None varies a synonym — and the
// register row for X193 describes the defect as "in bold or in a different case", so the controls
// encode the author's own description of it rather than the dimension the defect lives on. On the
// synonym axis both halves of this function were wrong, in opposite directions.
//
// I: a FALSE ALARM. `Task` where the first table said `Tasks` was reported as columns that "would
// be read against the WRONG columns". They would not: traceability-check.mjs:457 resolves the task
// column with /^(tasks?|task ?ids?|task ?refs?)$/i, so both land on index 3 and every row is read
// identically. The comparison claimed to normalise "exactly as the reader does" while comparing
// text for equality where the reader uses a regex alternation.
const synonymReqHeader = reqHeader.replace(/\bTasks\b/, 'Task');
if (synonymReqHeader === reqHeader) {
  die(
    "case I cannot be exercised: the golden REQUIREMENTS.md header no longer contains 'Tasks', so " +
      'this reproduction is testing nothing. Re-read the fixture and choose a synonym it does use.',
  );
}
const I = verdict(repeatHeader(synonymReqHeader));
const iWrong = flagged(I);
console.log(
  `  I  a SYNONYM header (Task for Tasks) .......... ${iWrong ? 'BLOCKED  <- X193' : 'clean   '}`,
);
if (iWrong && !expectBug) {
  die(
    'case I: `Task` where the first table said `Tasks` was reported as a column mismatch, but the ' +
      'reader resolves both to the same column, so every row is read identically. A false alarm in a ' +
      `blocking Publish check: ${I.problems.find((p) => String(p).includes(MISMATCH_SAYS))}`,
  );
}

// J: a FALSE CLEAN, and the worse direction. A later PROGRESS.md table headed with synonyms MATCHED
// the register's id test (on "Task ID"), then FAILED belongsToThisRegister on name overlap — so it
// was filtered out of `fragments`, and excluded from `orphaned` because that collects only tables
// NOT in `matching`. It fell through both nets and vanished, carrying two `done` rows that trace to
// no requirement. The same two rows under canonical headers block with both scope-creep problems.
const J = verdict((dm) =>
  appendFileSync(
    join(dm, 'PROGRESS.md'),
    '\n## Phase 3\n\n| Task ID | Description | State | Comment |\n| :-- | :-- | :-- | :-- |\n' +
      '| T90 | Rewrite the auth layer | done | shipped |\n| T91 | Add analytics SDK | done | shipped |\n',
  ),
);
const jSilent = J.status === 'clean';
console.log(
  `  J  a synonym-headed PROGRESS table ............ ${jSilent ? 'clean   <- X192' : 'BLOCKED'}`,
);
if (jSilent && !expectBug) {
  die(
    'case J: a later PROGRESS.md table the reader could not merge was dropped in SILENCE, taking two ' +
      'done rows traceable to no requirement with it. A table this register cannot read with ' +
      'confidence must be reported, which is what X192 was about in the first place.',
  );
}

if (expectBug) {
  if (open.length === 0)
    die(
      'expected these defects and found none. If they were fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(`\nREPRODUCED: ${open.join('; ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log(
    '\nPASS: both tables are held to the same standard, and a header is compared the way the gate itself reads it.',
  );
  process.exit(0);
}

die(
  `OPEN — ${open.join('; ')}. The PROGRESS branch ignores the three warnings the REQUIREMENTS ` +
    'branch consumes, and the header comparison uses a raw join while every other consumer of ' +
    'those same cells goes through deEmphasise() and a case-insensitive match.',
);
