#!/usr/bin/env node
//
// Reproduction for X122 — a content table whose key headers are mistyped is skipped in
// silence, so every asset in it goes unchecked while the verdict stays `clean`.
//
// FIRST, A CORRECTION TO THE DIAGNOSIS. X122 was recorded as "content-check silently
// skips a table whose headers it doesn't recognise — and a test pins that silence as
// correct", citing hooks.test.mjs:3964. That overstated it. The test at that line asserts
// that appending an UNRELATED table (`| Draft | Reason |`, under "## Rejected drafts")
// must not cause a spurious BLOCK — and that is a legitimate requirement, added after a
// real false-block where a second table's rows were checked against the first table's
// columns. The test defends correct behaviour and is kept.
//
// THE REAL DEFECT, which is narrower and survives that correction. The skip is:
//
//     if (found.asset === -1 && found.medium === -1) continue;  // not a content table
//
// It cannot tell "a table about something else" from "a content table with a typo in its
// headers". So a register holding a good table AND a second one headed
// `| Assets | Media | … |` — plural, the single most likely slip — passes as clean with
// the second table's assets never examined at all. The first table sets sawContentTable,
// so the existing "no recognisable content table" failure never fires either.
//
// THE FIX, SECOND ATTEMPT — and the first one was wrong.
//
// The first fix GUESSED: it flagged any table matching two or more of the six content
// columns while lacking asset/medium. An adversarial pass then showed that guess blocking
// SEVEN of thirteen realistic auxiliary tables — `| Model | Status |`, `| Licence | Status |`,
// `| Caption | Status |`, `| Origin | Status |`, `| By | Status |`, `| Usage | Status |` —
// every one a false alarm on an ordinary content register, and this gate is one of the
// seven blocking pre-flight checks, so each would stop a release. Two independent refuters
// confirmed all seven were clean before the change, so all seven were regressions.
//
// It is reverted. The precise fix is to tolerate the PLURAL in the recogniser:
//
//     asset:  /^(assets?|names?|files?|items?)$/i
//     medium: /^(mediums?|media|types?|kinds?)$/i
//
// A mistyped register is then simply RECOGNISED, and its rows are validated on their
// merits — so it now fails naming the real problems ("not approved", "no rights note")
// rather than on a heuristic's opinion about what a table looks like. Recognition beats
// guessing, and it cannot raise a false alarm, because a table that is not a content table
// still matches nothing.
//
// The lesson, recorded because it cost a regression: before adding a heuristic to catch a
// mis-spelling, ask whether the RECOGNISER can simply be made to accept it.
//
//   case                                                          required
//   A  a correct register                                          clean    (control)
//   B  correct register + "## Rejected drafts | Draft | Reason |"   clean    (control — the existing test)
//   C  correct register + a references table | Source | URL |       clean    (control)
//   F  correct register + | Model | Status |                        clean    (control — the regression)
//   G  correct register + | Licence | Status |                      clean    (control — the regression)
//   D  correct register + | Assets | Media | Source | Approved |...  FAILS   <- X122
//   E  ONLY a mistyped table, no correct one                        FAILS    (control)
//
// F and G matter most. They are the exact shapes the first fix broke, and they are held
// here so that a future "improvement" reaching again for a looks-like-a-table heuristic
// fails loudly instead of quietly stopping a release on a healthy register.
//
// Usage:
//   node X122-mistyped-content-table.mjs                # asserts the FIXED state
//   node X122-mistyped-content-table.mjs --expect-bug   # asserts the DEFECT is present

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

const GOOD_TABLE =
  '# Content Register\n\n' +
  '| Asset | Medium | Source | Approved | Rights | Alt |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  '| welcome-copy | text | Claude (prompt: greet) | approved | original content | n/a |\n';

// The realistic slip: both key headers pluralised, everything else correct. Its single
// row is missing approval AND rights, so if the table were examined it must BLOCK.
const MISTYPED_TABLE =
  '\n## Icons\n' +
  '| Assets | Media | Source | Approved | Rights | Alt |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  '| hero-icon.svg | image | Gemini prompt #4 | | | |\n';

const UNRELATED_TABLE = '\n## Rejected drafts\n| Draft | Reason |\n| :-- | :-- |\n| hero-v1 | too busy |\n';
const REFERENCES_TABLE = '\n## References\n| Source | URL |\n| :-- | :-- |\n| Gemini docs | https://example.invalid |\n';

/** Write a CONTENT.md and return content-check's parsed verdict. */
function verdict(contentMd) {
  const dir = mkdtempSync(join(tmpdir(), 'x122-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), contentMd);
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(
      readGate(NODE, join(HOOKS, 'content-check.mjs'), [dir]),
      'X122-mistyped-content-table.mjs',
      die,
    );
    return { status: v.status, problems: v.problems, code: v.code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- Controls that must stay clean -------------------------------------------
const A = verdict(GOOD_TABLE);
if (A.status !== 'clean') die(`control A failed: a correct register must be clean, got ${A.status} (${A.problems[0] || ''})`);
console.log('  A  a correct register ................................ clean   (as expected)');

const B = verdict(GOOD_TABLE + UNRELATED_TABLE);
if (B.status !== 'clean') {
  die(
    `control B failed: an unrelated "Rejected drafts" table caused ${B.status}. That is a false ` +
      `block, and hooks.test.mjs already forbids it: ${B.problems[0] || ''}`,
  );
}
console.log('  B  + an unrelated | Draft | Reason | table ........... clean   (as expected)');

const C = verdict(GOOD_TABLE + REFERENCES_TABLE);
if (C.status !== 'clean') {
  die(
    `control C failed: a references table matching ONE content column caused ${C.status}. The ` +
      `threshold must be 2 or more, or ordinary tables become false blocks: ${C.problems[0] || ''}`,
  );
}
console.log('  C  + a | Source | URL | references table ............. clean   (as expected)');

// ---- Control E: a register with ONLY a mistyped table already failed ----------
const E = verdict('# Content Register\n' + MISTYPED_TABLE);
if (E.status === 'clean') {
  die('control E failed: a register whose ONLY table is mistyped must not be clean — that path already worked.');
}
console.log('  E  ONLY a mistyped table ............................. BLOCKED (as expected)');

// ---- The defect --------------------------------------------------------------
const REGRESSION_TABLES = {
  'F  + | Model | Status |': '\n## Models used\n| Model | Status |\n| :-- | :-- |\n| gemini-2.5 | current |\n',
  'G  + | Licence | Status |': '\n## Licences\n| Licence | Status |\n| :-- | :-- |\n| CC-BY | cleared |\n',
};
for (const [name, table] of Object.entries(REGRESSION_TABLES)) {
  const v = verdict(GOOD_TABLE + table);
  if (v.status !== 'clean') {
    die(
      `control ${name} failed: an ordinary auxiliary table caused ${v.status}. This is the exact ` +
        `regression the first X122 fix introduced — this gate is a blocking pre-flight check, so a ` +
        `false alarm here stops a release on a healthy register: ${v.problems[0] || ''}`,
    );
  }
  console.log(`  ${name} .......................... clean   (as expected)`);
}

const D = verdict(GOOD_TABLE + MISTYPED_TABLE);
const caught = D.status !== 'clean';
console.log(`  D  a good register + a MISTYPED content table ........ ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- X122'}`);

if (expectBug) {
  if (caught) {
    die(
      'expected the X122 defect and did not find it: a mistyped content table alongside a good one ' +
        'is now reported. If it was fixed, delete this --expect-bug branch deliberately rather than ' +
        'leaving a reproduction that can no longer detect anything.',
    );
  }
  console.log('\nX122 REPRODUCED: a mistyped content table is skipped in silence and its assets go unchecked.');
  process.exit(0);
}

if (caught) {
  console.log(
    '\nPASS: a content table with mistyped headers is reported, while genuinely unrelated tables ' +
      'are still ignored without complaint.',
  );
  process.exit(0);
}

die(
  'X122 is OPEN: `if (found.asset === -1 && found.medium === -1) continue;` cannot tell a table ' +
    'about something else from a content table with a typo in its headers, so `| Assets | Media |` ' +
    "— the likeliest slip — passes with every asset in it unexamined, and the first table's " +
    'presence suppresses the "no recognisable content table" failure. ' +
    'Fix: skip only tables matching FEWER THAN TWO content columns; report the rest.',
);
