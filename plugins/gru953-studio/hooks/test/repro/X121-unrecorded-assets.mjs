#!/usr/bin/env node
//
// Reproduction for X121's remaining half — `content-check` read the register and never looked at the
// folder, so a file nobody recorded was invisible.
//
// The gate checked the paperwork of every asset RECORDED: approval, provenance, rights, alt-text, and
// (since the first half of X121) that the recorded path resolves to a file that exists. It never asked
// the opposite question. Measured before this: a project recording one asset, with an extra
// `assets/UNRECORDED-scraped-from-web.png` on disk that no row mentions, returned
// `{"status":"clean","assets":1,"assetExistenceChecked":true}` — and the verdict did not even say
// enumeration had not been attempted.
//
// WHY THIS SAT OPEN AS AN OWNER DECISION RATHER THAN A GATE FIX. Nothing said where a project's
// generated files live, so there was no folder to look in. The register's own note recorded that the
// enumeration half "CANNOT be fixed as written" for that reason, and sent it to the owner.
//
// THE CONVENTION CHOSEN, 2026-08-24: use the Path column, warn on strays. The directories inspected
// are exactly those a recorded Path already points into. That needs no new configuration, imposes no
// folder layout, and cannot be wrong about a folder nobody mentioned — which is what cases D and C
// exist to hold. A project that records `assets/hero.png` gets `assets/` looked at; a project that
// records no paths at all is inspected nowhere, which is the pre-existing disclosed state.
//
//   case                                                      required
//   A  a stray file in a folder a recorded path points into     BLOCKED, naming the file
//   B  control: only recorded files in that folder              clean
//   C  control: a register with NO Path column                  clean — nothing to enumerate from
//   D  control: a stray in a folder no path points into         clean — never inspected
//   E  control: a sub-directory inside a watched folder         clean — not an asset, not walked
//   F  control: a recorded file that does NOT exist             still BLOCKED (X121's first half)
//   G  control: the golden fixture and this project             clean
//
// Case D is the one that makes this a convention rather than a project-wide scan. Case E stops it
// growing into one by accident: a nested directory is not a shipped asset and is not descended into.
//
// NOTHING IS WRITTEN outside a throwaway directory, and the gate is read-only.
//
// Usage:
//   node X121-unrecorded-assets.mjs                # asserts the fixed state
//   node X121-unrecorded-assets.mjs --expect-bug   # asserts the gap

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const GOLDEN = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden');
const REPO = join(HOOKS, '..', '..', '..');

const problems = [];
const note = (s) => problems.push(s);

const REGISTER_WITH_PATH = [
  '# Content',
  '',
  '| Asset | Medium | Path | Provenance | Approval | Rights | Alt-text |',
  '| :-- | :-- | :-- | :-- | :-- | :-- | :-- |',
  '| hero.png | image | assets/hero.png | drawn in-house | approved 2026-08-01 | owned | the hero |',
  '',
].join('\n');

const REGISTER_NO_PATH = [
  '# Content',
  '',
  '| Asset | Medium | Provenance | Approval | Rights | Alt-text |',
  '| :-- | :-- | :-- | :-- | :-- | :-- |',
  '| intro.md | text | written in-house | approved 2026-08-01 | owned | n/a |',
  '',
].join('\n');

function project({ register, files = [], dirs = [], elsewhere = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'x121-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), register, 'utf8');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const f of files) writeFileSync(join(dir, 'assets', f), 'x', 'utf8');
  for (const d of dirs) mkdirSync(join(dir, 'assets', d), { recursive: true });
  if (elsewhere.length) {
    mkdirSync(join(dir, 'downloads'), { recursive: true });
    for (const f of elsewhere) writeFileSync(join(dir, 'downloads', f), 'x', 'utf8');
  }
  return dir;
}

function verdict(root) {
  const r = spawnSync(process.execPath, [join(HOOKS, 'content-check.mjs'), root], {
    encoding: 'utf8',
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(crashed or unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 220) };
  }
}

const expect = (id, root, want, what, extra) => {
  const v = verdict(root);
  rmSync(root, { recursive: true, force: true });
  if (v.status !== want) {
    note(`case ${id}: ${what} -> ${v.status}, expected ${want}${v.raw ? ` (${v.raw})` : ''}`);
    return null;
  }
  if (extra) {
    const bad = extra(v);
    if (bad) {
      note(`case ${id}: ${bad}`);
      return null;
    }
  }
  console.log(`  ${id.padEnd(3)} ${what.padEnd(52)} ${want}`);
  return v;
};

// ---- A: the stray ---------------------------------------------------------------
expect(
  'A',
  project({ register: REGISTER_WITH_PATH, files: ['hero.png', 'scraped.jpg'] }),
  'BLOCKED',
  'a stray file in a folder a path points into',
  (v) =>
    (v.problems || []).some((p) => /scraped\.jpg/.test(p))
      ? null
      : `it blocks, but no problem names the stray file: ${JSON.stringify(v.problems || []).slice(0, 180)}`,
);

// ---- B to E: the controls that keep this a convention, not a scan ---------------
expect(
  'B',
  project({ register: REGISTER_WITH_PATH, files: ['hero.png'] }),
  'clean',
  'control: only recorded files present',
);
expect(
  'C',
  project({ register: REGISTER_NO_PATH, files: ['never-mentioned.png'] }),
  'clean',
  'control: a register with NO Path column',
);
expect(
  'D',
  project({ register: REGISTER_WITH_PATH, files: ['hero.png'], elsewhere: ['random.zip'] }),
  'clean',
  'control: a stray where no path points',
);
expect(
  'E',
  project({ register: REGISTER_WITH_PATH, files: ['hero.png'], dirs: ['thumbs'] }),
  'clean',
  'control: a sub-directory is not an asset',
);

// ---- F: control — the first half of X121 must still hold ----------------------
expect(
  'F',
  project({ register: REGISTER_WITH_PATH, files: [] }),
  'BLOCKED',
  'control: a recorded file that does not exist',
);

// ---- G: control — the real projects ------------------------------------------
for (const [i, root] of [GOLDEN, REPO].entries()) {
  const v = verdict(root);
  if (v.status !== 'clean') {
    note(
      `control G${i + 1}: ${i === 0 ? 'the golden fixture' : 'this project'} is no longer clean ` +
        `("${v.status}"): ${JSON.stringify(v.problems || []).slice(0, 180)}`,
    );
  } else {
    console.log(
      `  G${i + 1}  control: ${(i === 0 ? 'the golden fixture' : 'this project').padEnd(46)} clean`,
    );
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
  '\nPASS: a file sitting in a folder the register points into but recorded by no row is reported, ' +
    'and a folder the register never mentions is never inspected.',
);
