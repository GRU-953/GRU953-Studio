#!/usr/bin/env node
//
// Reproduction for X121 — a recorded asset that does not exist passes as `clean`.
//
// THE DEFECT, verified before this was written:
//
//     | totally-imaginary.svg | image | Gemini, prompt #1 | approved | AI-generated | An icon |
//     -> {"status":"clean","reason":"every recorded content asset has approval, provenance,
//         rights and (for media) alt-text","assets":1}   exit 0
//
// The reason string is technically true and practically meaningless. The gate checks that a
// row's other columns are filled in; it never checks that the asset exists. `grep -c
// readdirSync content-check.mjs` returns 0 — it reads one file and nothing else.
//
// WHY IT COULD NOT BE FIXED WHEN FIRST RAISED. Nothing said where assets live. CONTENT.md
// records names — `streak-flame-icon.svg` — with no path, no directory convention anywhere in
// skills/content-creation/SKILL.md, and rows that are not files at all (`onboarding-copy` is
// text). There was nothing to resolve a name against, and inventing a convention so a gate
// could be written would be the tail wagging the dog. It went to the owner as a decision.
//
// THE OWNER'S DECISION, 2026-08-15: a path in each register row. It handles text rows that are
// not files (empty path), works whatever layout a project uses, and imposes no folder rule.
//
// OPTIONAL, BUT ENFORCED WHEN PRESENT — and that is deliberate. Making the column mandatory
// would fail every register written before today, including the golden fixture that exists to
// prove this checker is awake. So a register without the column still passes; what changes is
// that its clean verdict now SAYS existence was not checked, instead of implying it was. A gate
// that cannot check something must say so rather than let its silence read as assurance — the
// lesson of X86, X99, X106 and X122, applied here.
//
//   case                                                      required
//   A  no Path column at all (the golden shape)                clean, and says existence UNCHECKED
//   B  Path column, file present                               clean
//   C  Path column, file MISSING                               FAILS   <- X121
//   D  Path column, text row with an empty path                clean   (text is not a file)
//   E  Path column, MEDIA row with an empty path               FAILS   (a media asset must say where it is)
//
// Case A is the control that keeps every existing project working. Case D is the control that
// stops this becoming a false-alarm generator for text content.
//
// Usage:
//   node X121-asset-existence.mjs                # asserts the FIXED state
//   node X121-asset-existence.mjs --expect-bug   # asserts the DEFECT is present

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

/** Build a project, optionally create real asset files, and run content-check. */
function verdict(contentMd, realFiles = []) {
  const dir = mkdtempSync(join(tmpdir(), 'x121-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), contentMd);
    for (const rel of realFiles) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, 'x');
    }
    const r = spawnSync(process.execPath, [join(HOOKS, 'content-check.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    try {
      const j = JSON.parse(out);
      return { status: j.status, problems: j.problems || [], json: j, code: r.status };
    } catch {
      return { status: 'unparsed', problems: [], json: {}, code: r.status, raw: out.slice(0, 200) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NO_PATH =
  '# Content Register\n\n' +
  '| Asset | Medium | Source | Approved | Rights | Alt |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  '| streak-icon.svg | image | Gemini prompt #2 | approved | AI-generated | Flame icon |\n';

const withPath = (assetPath, medium = 'image') =>
  '# Content Register\n\n' +
  '| Asset | Path | Medium | Source | Approved | Rights | Alt |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  `| streak-icon.svg | ${assetPath} | ${medium} | Gemini prompt #2 | approved | AI-generated | Flame icon |\n`;

// ---- A: the golden shape must keep working, and must admit what it did not check ----
const A = verdict(NO_PATH);
if (A.status !== 'clean') {
  die(`control A failed: a register with no Path column must still pass — every project written before today has this shape. Got ${A.status}: ${A.problems[0] || ''}`);
}
const admits = JSON.stringify(A.json).toLowerCase().includes('not verified') || A.json.assetExistenceChecked === false;
console.log(`  A  no Path column ......................... clean, existence-unchecked stated: ${admits ? 'yes' : 'NO'}`);

// ---- B: a path that resolves ------------------------------------------------
const B = verdict(withPath('assets/streak-icon.svg'), ['assets/streak-icon.svg']);
if (B.status !== 'clean') die(`control B failed: a recorded asset that EXISTS must pass. Got ${B.status}: ${B.problems[0] || ''}`);
console.log('  B  Path column, file present .............. clean   (as expected)');

// ---- C: the defect ----------------------------------------------------------
const C = verdict(withPath('assets/streak-icon.svg')); // file deliberately not created
const cCaught = C.status !== 'clean';
console.log(`  C  Path column, file MISSING .............. ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- X121'}`);

// ---- D: text rows are not files ---------------------------------------------
const D = verdict(
  '# Content Register\n\n' +
    '| Asset | Path | Medium | Source | Approved | Rights | Alt |\n| :-- | :-- | :-- | :-- | :-- | :-- | :-- |\n' +
    '| onboarding-copy |  | text | Claude | approved | original | — |\n',
);
if (D.status !== 'clean') {
  die(`control D failed: a TEXT row with no path must pass — in-app copy is not a file on disk. Got ${D.status}: ${D.problems[0] || ''}`);
}
console.log('  D  Path column, text row, empty path ...... clean   (as expected)');

// ---- E: a media row must say where it is ------------------------------------
const E = verdict(withPath('', 'image'));
const eCaught = E.status !== 'clean';
console.log(`  E  Path column, MEDIA row, empty path ..... ${eCaught ? 'BLOCKED' : 'clean  '}${eCaught ? '' : '  <- X121'}`);

const open = [];
if (!cCaught) open.push('C (a recorded asset that does not exist passes)');
if (!eCaught) open.push('E (a media row need not say where it is)');
if (!admits) open.push('A (a clean verdict does not admit existence went unchecked)');

if (expectBug) {
  if (open.length === 0) die('expected the X121 defect and found none. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nX121 REPRODUCED: ${open.join('; ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: a recorded asset must exist where it says it does, and a register that cannot be checked says so.');
  process.exit(0);
}

die(
  `X121 is OPEN — ${open.join(' and ')}. The gate verifies a row's paperwork and never that the ` +
    'asset exists. Fix: recognise a Path column, resolve every non-empty path against the project ' +
    'root, require one for media rows, and state plainly when a register carries no Path column ' +
    'at all so its clean verdict cannot be mistaken for a check that happened.',
);
