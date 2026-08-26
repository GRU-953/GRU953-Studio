#!/usr/bin/env node
//
// Reproduction for X195 (High, P6 convergence round 2) — the gate reports that it checked
// every asset exists, when it checked only some of them.
//
// THE DEFECT, and why it is the exact promise this field was added to keep.
//
// Finding X121 added an optional Path column plus a disclosure field, because a clean verdict
// that silently omitted an existence check read as assurance. content-check.mjs's own comment
// says so: the column "stays optional so every register written before today keeps working;
// what changes is that its clean verdict now admits the gap instead of implying coverage."
//
// The flag is computed:
//
//     const assetExistenceChecked = rows.some((row) => row.idx.path !== -1);
//
// `.some`, over rows drawn from EVERY table in the register. A register grouped by medium —
// "## Artwork" with a Path column, "## Sound" without — therefore reports
//
//     "assetExistenceChecked": true
//     "every recorded content asset has approval, provenance, rights, (for media) alt-text,
//      and a file where it says it is"
//
// while the sound assets were never resolved to anything at all. The sentence is a positive
// false statement, made by the field whose entire purpose is to stop silence being mistaken
// for a check. Grouping a register by medium is the ordinary way to write one.
//
// WHAT THIS FIX DELIBERATELY DOES NOT DO. It does not start blocking. The Path column is
// optional by design, and a register that omits it everywhere is clean today and stays clean —
// control A holds that. Making a partial register fail would break every register written
// before X121 landed, which is precisely what the optionality was for. What changes is that
// the gate stops claiming coverage it does not have, and says how far the check reached.
//
//   case                                                       required
//   A  no Path column anywhere                                  clean, checked=false  (control)
//   B  a Path column on every row, files present                clean, checked=true   (control)
//   C  a Path table beside a Path-less one, files present        clean, checked=FALSE  <- X195
//   D  a Path column on every row, file MISSING                 BLOCKED (control: the
//                                                                        existence check works)
//   E  case C again                                              still clean (control: this
//                                                                        fix must not block)
//
// Controls B and D are what stop the fix from being "always report false": B proves a fully
// path-carrying register can still honestly claim coverage, and D proves the underlying check
// still fires.
//
// Usage:
//   node X195-existence-disclosure.mjs                # asserts the FIXED state
//   node X195-existence-disclosure.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const NO_PATH =
  '| Asset | Medium | Provenance | Approval | Rights | Alt-text |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  '| menu-loop.mp3 | audio | composed in-house | approved | owned | a looping menu theme |\n';

const WITH_PATH = (p) =>
  '| Asset | Medium | Provenance | Approval | Rights | Alt-text | Path |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  `| banner.png | image | drawn in-house | approved | owned | a banner | ${p} |\n`;

/** Build a project with `contentMd`, optionally creating real asset files first. */
function verdict(contentMd, realFiles = []) {
  const dir = mkdtempSync(join(tmpdir(), 'x195-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), contentMd);
    for (const rel of realFiles) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), 'x');
    }
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'content-check.mjs'), [dir]), 'X195', die);
    return {
      status: v.status,
      checked: v.json.assetExistenceChecked,
      reason: String(v.json.reason || ''),
      problems: v.problems,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ASSET = 'assets/banner.png';

// ---- A: no Path column anywhere ------------------------------------------------
const A = verdict(`# Content\n\n${NO_PATH}`);
if (A.status !== 'clean' || A.checked !== false) {
  die(
    `control A failed: a register with no Path column must be clean and admit it checked nothing, got ${A.status}/checked=${A.checked}`,
  );
}
console.log('  A  no Path column anywhere ..................... clean, checked=false  (control)');

// ---- B: a Path column on every row ---------------------------------------------
const B = verdict(`# Content\n\n${WITH_PATH(ASSET)}`, [ASSET]);
if (B.status !== 'clean' || B.checked !== true) {
  die(
    `control B failed: a register whose every row carries a Path, with the file present, must be ` +
      `clean and may honestly claim coverage, got ${B.status}/checked=${B.checked}: ${B.problems[0] || ''}. ` +
      'A fix that simply always reports false would fail here, and would make the field useless.',
  );
}
console.log('  B  a Path column on every row, file present .... clean, checked=true   (control)');

// ---- F: X195 RE-OPENED 2026-08-18 — the column is present, the CELLS are empty ----
//
// Every control above varies whether the COLUMN exists. None varies whether the CELL holds
// anything. So the repair of 2026-08-16 could count rows whose TABLE carries a Path column —
// `row.idx.path !== -1` — rather than rows actually resolved to a file, and every control still
// passed. Measured on 2026-08-18: a register of two text assets, Path column present on both
// rows, both cells empty, reported assetExistenceChecked: true, assetsExistenceChecked: 2 and
// "a file where it says it is" after ZERO filesystem checks.
//
// That is the original X195 defect verbatim, and L16 besides: a count no independent count
// supports. An in-app text asset with no path is legitimately unresolvable — text is copy, not a
// file — but it is not a CHECK either, and reporting it as one is the whole thing this field
// exists to prevent.
const F_TABLE = [
  '| Asset | Medium | Provenance | Approval | Rights | Alt-text | Path |',
  '| :-- | :-- | :-- | :-- | :-- | :-- | :-- |',
  '| onboarding-copy | text | Claude 2026-07-19 | approved | original | \u2014 | \u2014 |',
  '| menu-label | text | Claude 2026-07-19 | approved | original | \u2014 | \u2014 |',
].join('\n');
const F = verdict(`# Content\n\n${F_TABLE}\n`);
const fWrong = F.checked === true;
console.log(
  `  F  a Path column with EMPTY cells ............. ${F.status}, checked=${F.checked}${fWrong ? '   <- X195' : ''}`,
);
if (fWrong && !expectBug) {
  die(
    'case F: every Path CELL is empty and the gate still claims assetExistenceChecked=true, so it ' +
      'reports a check it never made. Count rows actually RESOLVED to a file, not rows whose table ' +
      'happens to carry a Path column.',
  );
}

// ---- C: X195 --------------------------------------------------------------------
const C = verdict(`# Content\n\n${NO_PATH}\n## Later additions\n\n${WITH_PATH(ASSET)}`, [ASSET]);
const cOverclaims = C.checked === true;
console.log(
  `  C  a Path table beside a Path-less one .......... ${C.status}, checked=${C.checked}${cOverclaims ? '   <- X195' : ''}`,
);
if (cOverclaims) console.log(`         it says: "${C.reason.slice(0, 120)}..."`);

// ---- D: the existence check itself still fires ---------------------------------
const D = verdict(`# Content\n\n${WITH_PATH('assets/GONE.png')}`);
if (D.status === 'clean') {
  die(
    'control D failed: a Path naming a file that does not exist must still block — if it does not, the existence check is gone and case C would pass for the wrong reason.',
  );
}
console.log('  D  a Path naming a missing file ................ BLOCKED (control)');

// ---- E: this fix must not start blocking ---------------------------------------
if (C.status !== 'clean') {
  die(
    `control E failed: the mixed register must stay CLEAN. The Path column is optional by design, ` +
      'and making a partial register fail would break every register written before X121 landed — ' +
      `the defect here is the gate's honesty, not its strictness: ${C.problems[0] || ''}`,
  );
}
console.log(
  '  E  the mixed register is still clean ........... clean   (control: not a new block)',
);

if (expectBug) {
  if (!cOverclaims)
    die(
      'expected the X195 over-claim and did not find it. If it was fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(
    '\nX195 REPRODUCED: the gate reported assetExistenceChecked=true for a register whose sound assets were never resolved to a file.',
  );
  process.exit(0);
}

if (!cOverclaims) {
  console.log(
    '\nPASS: the gate claims an existence check only when it actually made one, and still says so when it did.',
  );
  process.exit(0);
}

die(
  'X195 is OPEN: assetExistenceChecked is computed with `rows.some(...)`, so one table carrying a ' +
    'Path column makes the whole register report that every asset was resolved to a file. Fix: ' +
    'claim coverage only when EVERY row could be checked, and say how far the check reached when ' +
    'it could not.',
);
