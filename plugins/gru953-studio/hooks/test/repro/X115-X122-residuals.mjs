#!/usr/bin/env node
//
// Reproduction for the residuals of X115 and X122 — both found by a DEFEAT PROBE against the real
// gate, after both had been proposed for closure and both survived a reading of the fix.
//
// That method distinction is the point, and this register has now watched it hold twice. Every
// proposed closure backed only by a MUTATION TEST — varying the product code while holding the test
// input fixed — was later overturned. Every one backed by a NOVEL ADVERSARIAL INPUT held. X113 was
// probed the same way on the same day and survived; these two did not.
//
// X115's residual. The X115 fix added `statSync(root).isDirectory()`, which properly closed the "the
// directory does not EXIST" half. `dirEntries()` was untouched, and it was
// `try { readdirSync } catch { return [] }` — so a directory that exists, IS a directory, and simply
// cannot be READ yielded zero entries, produced zero manifests, and the scan fell through to
// `{"status":"clean"}` with exit 0. Two proven cases: the scan root itself unreadable while holding a
// package.json and a GPL-3.0 dependency; and, more dangerous, one unreadable SUBDIRECTORY while the
// root is fine, where the gate looks like it worked and simply never saw that subtree.
//
// FIFTH INSTANCE OF ONE SHAPE in this project — unreadable input reading as empty — after X113
// (verify-progress), X118 (docs-consistency), X281 and X283 (memory-integrity). Five is not a
// coincidence; `try { … } catch { return [] }` is what the habit looks like, and case C exists so the
// next person who writes it in this file trips over a test.
//
// X122's residual. The X279 repair reports a table that plainly claims to be a content register —
// three or more content-specific columns and no readable asset or medium column. That threshold was
// chosen against X122's own controls so it cannot fire on `Model | Status`. But a table with only ONE
// OR TWO content columns and unreadable asset headers is genuinely ambiguous: indistinguishable from
// an unrelated table by its headers alone. It was still skipped in SILENCE while the verdict affirmed
// that every recorded asset had approval, provenance and rights.
//
// THE FIX IS NOT A LOWER THRESHOLD, which would fire on the controls. Silence is the defect, not the
// skip. Every skipped table is now NAMED in the verdict, blocking nothing — so a reader of a clean
// result can see which tables were not read and judge for themselves. Case E asserts that an unrelated
// table is still not blocked while still being named.
//
//   case                                                      required
//   A  licence-scan: the scan ROOT unreadable                   BLOCKED, saying so
//   B  licence-scan: one unreadable SUBDIRECTORY                BLOCKED — the dangerous case
//   C  control: everything readable                             not blocked for this reason
//   D  content-check: an ambiguous table is NAMED               listed in tablesSkipped
//   E  control: an unrelated table is named but not blocked      clean, and listed
//   F  control: a register with no skipped tables                clean, empty list
//   G  control: the real project                                 unchanged
//
// Usage:
//   node X115-X122-residuals.mjs                # asserts the fixed state
//   node X115-X122-residuals.mjs --expect-bug   # asserts the residuals

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO = join(HOOKS, '..', '..', '..');

const problems = [];
const note = (s) => problems.push(s);

function run(hook, root) {
  const r = spawnSync(process.execPath, [join(HOOKS, hook), root], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(crashed or unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 200) };
  }
}

// ---- A to C: licence-scan and the unreadable directory ---------------------------
function licenceFixture(makeUnreadable) {
  const dir = mkdtempSync(join(tmpdir(), 'x115r-'));
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"t","dependencies":{}}\n', 'utf8');
  writeFileSync(join(dir, 'sub', 'package.json'), '{"name":"s"}\n', 'utf8');
  if (makeUnreadable) chmodSync(join(dir, makeUnreadable), 0o000);
  return dir;
}
const blockedForUnreadable = (v) =>
  v.status === 'BLOCKED' && /could not be read/i.test(String(v.reason || ''));

{
  const dir = licenceFixture('.');
  const v = run('licence-scan.mjs', dir);
  chmodSync(dir, 0o755);
  if (!blockedForUnreadable(v)) {
    note(`case A: an unreadable scan ROOT -> ${v.status} (${String(v.reason || '').slice(0, 80)}), expected BLOCKED for being unreadable`);
  } else {
    console.log('  A  licence-scan: the scan root unreadable ..... BLOCKED, saying so');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = licenceFixture('sub');
  const v = run('licence-scan.mjs', dir);
  chmodSync(join(dir, 'sub'), 0o755);
  if (!blockedForUnreadable(v)) {
    note(
      `case B: one unreadable SUBDIRECTORY with a readable root -> ${v.status}. This is the dangerous ` +
        'case: the gate looks like it worked and simply never saw that subtree',
    );
  } else {
    console.log('  B  licence-scan: one unreadable subdirectory .. BLOCKED');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = licenceFixture(null);
  const v = run('licence-scan.mjs', dir);
  if (blockedForUnreadable(v)) {
    note(`control C: everything readable was blocked for being unreadable — a false alarm: ${JSON.stringify(v).slice(0, 160)}`);
  } else {
    console.log(`  C  control: everything readable .............. not blocked for this (${v.status})`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- D to F: content-check names every table it skips ---------------------------
const GOOD =
  '# Content\n\n| Asset | Medium | Provenance | Approval | Rights | Alt-text |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n| intro.md | text | in-house | approved | owned | n/a |\n';

function contentFixture(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x122r-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), GOOD + (extra || ''), 'utf8');
  return dir;
}
const skipped = (v) => (Array.isArray(v.tablesSkipped) ? v.tablesSkipped : null);

{
  // Two content columns only — below the reporting threshold, and ambiguous by design.
  const dir = contentFixture(
    '\n## Artwork\n\n| Artwork | Format | Approved | Rights |\n| :-- | :-- | :-- | :-- |\n| hero.svg | image | | |\n',
  );
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (list === null) {
    note('case D: the verdict carries no tablesSkipped list at all, so a skipped table is still silent');
  } else if (!list.some((h) => /Artwork/.test(h))) {
    note(`case D: the ambiguous table was skipped and NOT named: ${JSON.stringify(list)}`);
  } else {
    console.log('  D  content-check: an ambiguous table ......... named in tablesSkipped');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = contentFixture('\n## Models\n\n| Model | Status |\n| :-- | :-- |\n| gpt | ok |\n');
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (v.status !== 'clean') {
    note(`control E: an unrelated table blocked the gate (${v.status}) — that is the false alarm X122 was already burned by`);
  } else if (!list || !list.some((h) => /Model/.test(h))) {
    note(`control E: it stays clean, correctly, but the unrelated table is not named either: ${JSON.stringify(list)}`);
  } else {
    console.log('  E  control: an unrelated table ............... named, not blocked');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = contentFixture('');
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (v.status !== 'clean' || !Array.isArray(list) || list.length !== 0) {
    note(`control F: a register with nothing to skip -> ${v.status}, tablesSkipped=${JSON.stringify(list)}, expected clean and empty`);
  } else {
    console.log('  F  control: nothing skipped ................. clean, empty list');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- G: control — the real project --------------------------------------------
for (const hook of ['licence-scan.mjs', 'content-check.mjs']) {
  const v = run(hook, REPO);
  if (v.status !== 'clean') {
    note(`control G: ${hook} is no longer clean on this project ("${v.status}")`);
  } else {
    console.log(`  G  control: ${hook.padEnd(34)} clean`);
  }
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
  '\nPASS: a directory that cannot be read is never reported as clean, and no content table is ever ' +
    'skipped without the verdict naming it.',
);
