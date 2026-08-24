#!/usr/bin/env node
//
// Reproduction for X278 and X279 — one shape in two gates: a fixed list of words standing in for a
// structural fact, so the verdict depended on which word the author happened to use.
//
// X278, `verify-progress`. The done-claim sweep outside a table recognised only WORD spellings of
// completion, and stripped leading punctuation before matching — so `- [x] T1 habit CRUD` became
// `x] T1 habit CRUD` and matched nothing. Measured at the parent: a PROGRESS.md holding three
// `- [x]` bullets and no table returned **clean**, and the reason it printed was
// "every \"done\" row has a verified: cell" — over a file with no rows and no `verified:` cell at all.
// The one spelling the earlier reproduction happened to use, `- T1: done`, blocked correctly, so the
// test pinned one spelling of the defect rather than the defect.
//
// X279, `content-check`. A table was skipped whenever its first two columns were not on a synonym
// list. Measured at the parent: a CONTENT.md whose second table is headed
// `Artwork | Format | Source | Approved | Rights | Alt`, carrying an unapproved, unattributed image
// with no alt-text, returned **clean with assets: 1** — and the IDENTICAL table headed
// `Asset | Medium | …` BLOCKED and named that image.
//
// WHY THE X122 REPAIR DID NOT HOLD, and why this one is different. X122 widened the synonym list to
// tolerate a plural. Widening recognises one more spelling each time; the SKIP is what makes an
// unrecognised table invisible, and it was left standing. But a silent skip is still RIGHT for a
// table that has nothing to do with content — CONTENT.md may hold a `Draft | Reason` table, and
// blocking on that was a real false alarm this gate has already been burned by. So the question is
// not "is this a content table", which X122's own note rightly refused to guess at, but "does this
// table plainly CLAIM to be one while the gate cannot read it". The evidence is the content-specific
// columns: provenance, approval, rights, alt-text, path.
//
// THE THRESHOLD WAS CHOSEN AGAINST THE EXISTING CONTROLS RATHER THAN PICKED. Three or more such
// columns and no readable asset or medium column. `Model | Status` and `Licence | Status` each match
// two and are X122 controls that must stay silent; `Source | URL` matches one; `Draft | Reason` none.
// X279's table matches four. Cases G to J are those controls, kept here so the threshold cannot be
// loosened without them failing.
//
//   case                                                      required
//   A  three ticked boxes, no evidence                         BLOCKED
//   B  control: UNticked boxes                                 clean — an empty box claims nothing
//   C  a trailing tick                                         BLOCKED
//   D  control: plain bullets with no claim                     clean
//   E  control: an ordinary word containing an x                clean
//   F  a content table the gate cannot read                     BLOCKED, naming its headers
//   G-J control: the four X122 tables that must stay silent      clean
//   K  control: a well-formed register alone                     clean
//   L  control: both golden fixtures                            clean
//
// NOTHING IS EXECUTED beyond the two gates themselves, each run against a throwaway Dev-Memory.
//
// Usage:
//   node X278-X279-recogniser-boundary.mjs                # asserts the fixed state
//   node X278-X279-recogniser-boundary.mjs --expect-bug   # asserts the gaps

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

function run(hook, root) {
  const r = spawnSync(process.execPath, [join(HOOKS, hook), root], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(crashed or unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 220) };
  }
}

function withFile(name, body) {
  const dir = mkdtempSync(join(tmpdir(), 'x278-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', name), body, 'utf8');
  return dir;
}

const check = (id, hook, name, body, want, what) => {
  const dir = withFile(name, body);
  const v = run(hook, dir);
  rmSync(dir, { recursive: true, force: true });
  if (v.status !== want) {
    note(`case ${id}: ${what} -> ${v.status}, expected ${want}${v.raw ? ` (${v.raw})` : ''}`);
    return null;
  }
  console.log(`  ${id.padEnd(3)} ${what.padEnd(48)} ${want}`);
  return v;
};

// ---- A to E: X278, verify-progress ------------------------------------------------
check('A', 'verify-progress.mjs', 'PROGRESS.md',
  '# Progress\n\n- [x] T1 habit CRUD\n- [x] T2 check-in UI\n- [x] T3 streak counter\n',
  'BLOCKED', 'three ticked boxes, no evidence anywhere');
check('B', 'verify-progress.mjs', 'PROGRESS.md',
  '# Progress\n\n- [ ] T1 habit CRUD\n- [ ] T2 check-in UI\n',
  'clean', 'control: UNticked boxes claim nothing');
check('C', 'verify-progress.mjs', 'PROGRESS.md', '# Progress\n\n- T1 habit CRUD ✅\n',
  'BLOCKED', 'a trailing tick is still a done claim');
check('D', 'verify-progress.mjs', 'PROGRESS.md', '# Progress\n\n- T1 habit CRUD\n- T2 check-in UI\n',
  'clean', 'control: plain bullets, no claim made');
check('E', 'verify-progress.mjs', 'PROGRESS.md', '# Progress\n\n- Fixed the extra index problem\n',
  'clean', 'control: an ordinary word containing an x');

// ---- F to K: X279, content-check --------------------------------------------------
const GOOD =
  '# Content\n\n| Asset | Medium | Provenance | Approval | Rights | Alt-text |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n' +
  '| intro.md | text | written in-house | approved 2026-08-01 | owned | n/a |\n';

{
  const v = check('F', 'content-check.mjs', 'CONTENT.md',
    `${GOOD}\n## Artwork\n\n| Artwork | Format | Source | Approved | Rights | Alt |\n` +
      '| :-- | :-- | :-- | :-- | :-- | :-- |\n| hero.svg | image | scraped from the web | | | |\n',
    'BLOCKED', 'a content table the gate cannot read');
  if (v && !(v.problems || []).some((p) => /Artwork/.test(p))) {
    note(
      'case F: it blocks, but no problem quotes the headers it could not read, so the author is not ' +
        `told which table to rename: ${JSON.stringify(v.problems || []).slice(0, 200)}`,
    );
  }
}

for (const [i, headers] of ['Draft | Reason', 'Model | Status', 'Licence | Status', 'Source | URL'].entries()) {
  check(`${'GHIJ'[i]}`, 'content-check.mjs', 'CONTENT.md',
    `${GOOD}\n## Other\n\n| ${headers} |\n| :-- | :-- |\n| a | b |\n`,
    'clean', `control: X122's "${headers}" must stay silent`);
}
check('K', 'content-check.mjs', 'CONTENT.md', GOOD, 'clean', 'control: a well-formed register alone');

// ---- L: control — the golden fixtures --------------------------------------------
for (const [i, hook] of ['verify-progress.mjs', 'content-check.mjs'].entries()) {
  const v = run(hook, GOLDEN);
  if (v.status !== 'clean') {
    note(`control L${i + 1}: ${hook} is no longer clean on the golden fixture ("${v.status}")`);
  } else {
    console.log(`  L${i + 1}  control: ${hook.padEnd(43)} clean`);
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
  '\nPASS: a done claim is recognised however it is written, a content table the gate cannot read is ' +
    'reported rather than skipped, and every table that has nothing to do with content stays silent.',
);
