#!/usr/bin/env node
//
// Reproduction for X281 — a Dev-Memory holding memory files and NO INDEX.md reported clean, because
// two functions each skipped on the stated ground that the other one covered it.
//
// `memory-integrity.mjs` is the gate that says whether a project's recall memory is sound. The
// product's own dev-memory skill has a session read `INDEX.md` FIRST; a memory file absent from it
// cannot be recalled at all. So an absent index is not a cosmetic gap — it is the whole recall path
// missing.
//
// Two functions, each deferring to the other:
//
//   checkIndex()            `if (text === null) return;  // no structured index yet — nothing to validate`
//   checkIndexCoversFiles() `catch { return; }           // a missing INDEX.md is already reported by checkIndex`
//
// The second comment was false. Measured before the fix: a Dev-Memory containing seven memory files
// (CONTENT, FOCUS, GRAPH, OBJECTIVE, PROGRESS, QUALITY-GATE, REQUIREMENTS) and no INDEX.md returned
// `{"status":"clean"}` with ZERO problems and exit 0.
//
// FOURTH TIME THIS PROJECT HAS FOUND THE SAME SHAPE — absent input reading as a clean pass — after
// X113 (verify-progress: "no PROGRESS.md found" exits 0), X115 (licence-scan: no manifest directories
// reads as clean) and X118 (docs-consistency: the whole version block sits inside a null check). It
// was fixed in three gates and missed in the fourth, in the one place where two functions could each
// point at the other.
//
// Found by adjudicating X120, whose transcribed claim ("memory-integrity is purely one-directional")
// turned out to be FIXED — the inverse-index check exists and blocks — with this sitting underneath it.
//
//   case                                                        required
//   A  memory files present, INDEX.md absent                     BLOCKED, and the message says why
//   B  control: an EMPTY Dev-Memory with no index                clean — not a false alarm
//   C  control: the golden fixture                               clean, unchanged
//   D  control: an unindexed file when INDEX.md EXISTS           still BLOCKED (X120's own half)
//   E  control: an UNREADABLE INDEX.md                           still BLOCKED, and not via this path
//
// Control B is the one that stops this being an over-fix. A Dev-Memory that exists but holds nothing
// is a project that has not started writing memory yet, not a broken one. Blocking that would fire on
// the most ordinary first-run state there is, and a gate that does this gets switched off (L5).
//
// Control E matters because the original code caught BOTH failures in one `catch`. Splitting them must
// not lose the unreadable case, which was already handled elsewhere and correctly blocks.
//
// Usage:
//   node X281-missing-recall-index.mjs                # asserts the fixed state
//   node X281-missing-recall-index.mjs --expect-bug   # asserts the defect

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const GOLDEN = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden');

const problems = [];
const note = (s) => problems.push(s);

function verdict(root) {
  const r = spawnSync(process.execPath, [join(HOOKS, 'memory-integrity.mjs'), root], {
    encoding: 'utf8',
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 200) };
  }
}

// A Dev-Memory carrying real memory files, with the index optionally removed.
function fixture(withIndex) {
  const dir = mkdtempSync(join(tmpdir(), 'x281-'));
  cpSync(join(GOLDEN, 'Dev-Memory'), join(dir, 'Dev-Memory'), { recursive: true });
  if (!withIndex) rmSync(join(dir, 'Dev-Memory', 'INDEX.md'), { force: true });
  return dir;
}

// ---- A: memory files present, no index -------------------------------------------
{
  const dir = fixture(false);
  const v = verdict(dir);
  if (v.status !== 'BLOCKED') {
    note(
      `case A: a Dev-Memory holding memory files and NO INDEX.md returned "${v.status}" with ` +
        `${(v.problems || []).length} problem(s). The recall index a session reads first is absent, so ` +
        'nothing in that memory can be recalled, and the gate whose whole job is recall soundness ' +
        'said nothing was wrong.',
    );
  } else if (!(v.problems || []).some((p) => /no INDEX\.md/i.test(p))) {
    note(
      'case A: it blocks, but no problem names the missing INDEX.md, so the reason a reader is given ' +
        `does not match the defect: ${JSON.stringify(v.problems || []).slice(0, 200)}`,
    );
  } else {
    console.log('  A  memory files, no index .................... BLOCKED, and it says why');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- B: control — an empty Dev-Memory must NOT be blocked -----------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x281b-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  const v = verdict(dir);
  if (v.status !== 'clean') {
    note(
      `control B: an EMPTY Dev-Memory with no index returned "${v.status}". A project that has not ` +
        'started writing memory is not a broken project, and blocking the most ordinary first-run ' +
        'state there is would be the false alarm that gets a gate switched off',
    );
  } else {
    console.log('  B  control: an empty Dev-Memory .............. clean, no false alarm');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- C: control — the golden fixture stays clean --------------------------------
{
  const v = verdict(GOLDEN);
  if (v.status !== 'clean') {
    note(`control C: the golden fixture is no longer clean ("${v.status}") — the fix has a false positive`);
  } else {
    console.log('  C  control: the golden fixture ............... clean');
  }
}

// ---- D: control — X120's own half must still hold ------------------------------
{
  const dir = fixture(true);
  writeFileSync(join(dir, 'Dev-Memory', 'UNINDEXED-NOTES.md'), '# notes\n\nnot in the index\n', 'utf8');
  const v = verdict(dir);
  if (v.status !== 'BLOCKED') {
    note(
      `control D: a file absent from an EXISTING INDEX.md no longer blocks ("${v.status}"). That is ` +
        'X120\'s own half — the inverse-index check — and splitting the guard must not have cost it',
    );
  } else {
    console.log('  D  control: unindexed file, index present .... still BLOCKED');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- E: control — an unreadable index must still block, by its own path --------
{
  const dir = fixture(false);
  // a directory where the file should be: readable as an entry, unreadable as a file
  mkdirSync(join(dir, 'Dev-Memory', 'INDEX.md'), { recursive: true });
  const v = verdict(dir);
  if (v.status !== 'BLOCKED') {
    note(
      `control E: an UNREADABLE INDEX.md returned "${v.status}". The original code caught the missing ` +
        'and the unreadable case in one `catch`; splitting them must not have lost this one',
    );
  } else {
    console.log('  E  control: an unreadable index .............. still BLOCKED');
  }
  try {
    rmdirSync(join(dir, 'Dev-Memory', 'INDEX.md'));
  } catch {
    /* best effort */
  }
  rmSync(dir, { recursive: true, force: true });
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nPASS: a Dev-Memory with memory files and no recall index is refused, an empty one is not, and ' +
    'both halves the original single catch was covering still block.',
);
