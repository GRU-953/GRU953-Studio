#!/usr/bin/env node
//
// Reproduction for quality-gate D1 (High) and D7 (Medium), adjudicated 2026-08-15.
//
// D1 — A SECOND DEFINITION-OF-DONE TABLE IS SKIPPED IN SILENCE.
// The status column is recognised by `find(/^status$/i)` and nothing else. A second table
// headed `| Item | Result | Evidence |` — recording a re-run that FAILED — has no column
// this gate calls Status, so it is skipped entirely and the gate reports clean. The first
// table's presence suppresses the "no Definition-of-Done table" failure, so nothing is said
// at all. This is exactly the X122 shape, one gate along: a register nobody can read, sitting
// beside one that can.
//
// D7 — A PLACEHOLDER WITH A TRAILING EXCUSE PASSES AS EVIDENCE.
// PLACEHOLDER_RE is whole-cell anchored, so `tbd` is caught and
// `tbd - will attach the proof after the demo` is not. The second is the one that actually
// gets written, and it is the same claim with an apology attached.
//
// THE DISCRIMINATOR, and why it is not simply "starts with a placeholder word".
// Measured before writing the fix: `none of the tests failed` currently passes, and it MUST
// keep passing — it is an ordinary English sentence reporting a real result. So the prefix
// rule applies only to words that cannot begin a genuine sentence of evidence:
//
//     tbd, tbc, todo, pending, placeholder    -> prefix-matched (an excuse may follow)
//     none, n/a, dashes, ellipsis             -> whole-cell only (they start real sentences)
//
// Control E holds that exact sentence, so a future tightening cannot quietly break it.
//
//   case                                                     required
//   A  a complete passing DoD table                           clean   (control)
//   B  + a second table | Item | Result | Evidence | failing   BLOCKED <- D1
//   C  evidence "tbd"                                         BLOCKED (control: it works)
//   D  evidence "tbd - will attach the proof after the demo"   BLOCKED <- D7
//   E  evidence "none of the tests failed"                     clean   (control: a real sentence)
//
// Usage:
//   node X143-quality-gate-recognition.mjs                # asserts the FIXED state
//   node X143-quality-gate-recognition.mjs --expect-bug   # asserts the DEFECTS are present

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

function verdict(qualityGate) {
  const dir = mkdtempSync(join(tmpdir(), 'x143-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'QUALITY-GATE.md'), qualityGate);
    const r = spawnSync(process.execPath, [join(HOOKS, 'quality-gate.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    try {
      const j = JSON.parse(out);
      return { status: j.status, problems: j.problems || [], code: r.status };
    } catch {
      return { status: 'unparsed', problems: [], code: r.status, raw: out.slice(0, 200) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = `# Quality Gate

| Item | Status | Evidence |
| :-- | :-- | :-- |
| acceptance criteria proven | pass | \`npm run accept\` -> exit 0 |
| tests pass | pass | \`npm test\` -> exit 0 |
| independent code review | pass | reviewed by a second reader, no open findings |
| security and licence clean | pass | \`npm audit\` -> 0 vulnerabilities |
| accessibility | n/a | no user interface in this change |
| documentation updated | pass | README section added |
| reproducible build | pass | \`npm run build\` -> exit 0 |
`;

const withEvidence = (ev) => GOOD.replace('| tests pass | pass | `npm test` -> exit 0 |', `| tests pass | pass | ${ev} |`);

// ---- A: the baseline must pass -----------------------------------------------
const A = verdict(GOOD);
if (A.status !== 'clean') die(`control A failed: a complete passing table must be clean, got ${A.status}: ${A.problems[0] || ''}`);
console.log('  A  a complete passing DoD table ................. clean   (control)');

// ---- B: D1 -------------------------------------------------------------------
const B = verdict(
  GOOD + '\n## Re-run after the fix\n\n| Item | Result | Evidence |\n| :-- | :-- | :-- |\n| Automated tests | fail | npm test -> exit 1, 3 failing |\n',
);
const bCaught = B.status !== 'clean';
console.log(`  B  + a second table headed "Result", failing .... ${bCaught ? 'BLOCKED' : 'clean  '}${bCaught ? '' : '  <- D1'}`);

// ---- C: the placeholder check demonstrably works -----------------------------
const C = verdict(withEvidence('tbd'));
if (C.status === 'clean') die('control C failed: a bare "tbd" as evidence must be caught — the placeholder check is not working at all.');
console.log('  C  evidence "tbd" .............................. BLOCKED (control)');

// ---- D: D7 -------------------------------------------------------------------
const D = verdict(withEvidence('tbd - will attach the proof after the demo'));
const dCaught = D.status !== 'clean';
console.log(`  D  evidence "tbd - will attach ..." ............. ${dCaught ? 'BLOCKED' : 'clean  '}${dCaught ? '' : '  <- D7'}`);

// ---- E: an ordinary sentence must survive ------------------------------------
const E = verdict(withEvidence('none of the tests failed'));
if (E.status !== 'clean') {
  die(
    `control E failed: "none of the tests failed" was rejected as a placeholder. It is an ordinary ` +
      `English sentence reporting a real result, and treating every cell that STARTS with a ` +
      `placeholder word as a placeholder is exactly that mistake: ${E.problems[0] || ''}`,
  );
}
console.log('  E  evidence "none of the tests failed" ......... clean   (control)');

const open = [];
if (!bCaught) open.push('D1 (a second DoD table is skipped in silence)');
if (!dCaught) open.push('D7 (a placeholder with an excuse attached passes)');

if (expectBug) {
  if (open.length === 0) die('expected the quality-gate defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nREPRODUCED: ${open.join(' and ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: every Definition-of-Done table is read, an excuse does not turn a placeholder into evidence, and real sentences survive.');
  process.exit(0);
}

die(
  `OPEN — ${open.join(' and ')}. The status column is recognised as /^status$/i and nothing else, ` +
    'and PLACEHOLDER_RE is whole-cell anchored so an excuse appended to "tbd" escapes it. ' +
    'Fix: accept the ordinary synonyms for a status column, and prefix-match only the ' +
    'placeholder words that cannot begin a genuine sentence.',
);
