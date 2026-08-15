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
// THE DISCRIMINATOR. A mistyped content table still matches most of its OTHER columns —
// Source, Approved, Rights, Alt — while an unrelated table matches none of them. So:
//
//     0 or 1 recognised content columns, no asset/medium  -> genuinely unrelated, skip
//     2 or more, but no asset/medium                      -> a content table with a typo, REPORT
//
// The threshold is 2 rather than 1 deliberately: a references table headed
// `| Source | URL |` matches exactly one, and must not be dragged in.
//
//   case                                                          required
//   A  a correct register                                          clean    (control)
//   B  correct register + "## Rejected drafts | Draft | Reason |"   clean    (control — the existing test)
//   C  correct register + a references table | Source | URL |       clean    (control — threshold)
//   D  correct register + | Assets | Media | Source | Approved |…   FAILS    <- X122
//   E  ONLY a mistyped table, no correct one                        FAILS    (control — already worked)
//
// Controls B and C are the ones that make this fix safe rather than merely strict: a gate
// that blocked on any unfamiliar table would be a false-block generator, which is the
// defect this file's own history is full of.
//
// Usage:
//   node X122-mistyped-content-table.mjs                # asserts the FIXED state
//   node X122-mistyped-content-table.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
    const r = spawnSync(NODE, [join(HOOKS, 'content-check.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    let status = 'unparsed';
    let problems = [];
    try {
      const j = JSON.parse(out);
      status = j.status;
      problems = j.problems || [];
    } catch {
      /* leave as unparsed */
    }
    return { status, problems, code: r.status };
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
