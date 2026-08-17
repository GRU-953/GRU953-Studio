#!/usr/bin/env node
//
// Reproduction for X217 — the fixture exemption is resolved against the wrong base directory for
// git-history findings, so pushing from a SUBDIRECTORY refuses this plugin's own committed
// fixture.
//
// THE DEFECT, measured rather than argued. `isOwnTestFixture(f)` decides whether a Dev-Memory path
// belongs to this plugin's own committed test fixture, and it resolves:
//
//     path.resolve(REPO, f)          where REPO = path.resolve(SESSION_DIR, resolvePushTree(...))
//
// For a plain `git push`, `resolvePushTree` falls back to SESSION_DIR — the directory the command
// was issued from. But the HISTORY scan takes its paths from `git diff`, which yields
// REPO-RELATIVE paths. From the repository root the two bases coincide and everything works. From
// a subdirectory they do not:
//
//     base = <repo>                                    'plugins/…/golden/Dev-Memory/INDEX.md'  EXEMPT
//     base = <repo>/plugins/gru953-studio/hooks        'plugins/…/golden/Dev-Memory/INDEX.md'  NOT exempt
//
// So the exemption silently stops applying, and a push issued from `hooks/` is refused because of
// the plugin's own test data. `repoToplevelForDiff` is already computed a few lines above the
// history scan for exactly this purpose; the exemption simply does not use it.
//
// HOW IT SURFACED, recorded because it matters more than the bug. It was latent until the X86 fix
// edited the golden fixture's INDEX.md, putting a Dev-Memory path into git history for the first
// time. Nothing was wrong with X86; it made a pre-existing gap reachable. My first explanation was
// that the history check did not consult the exemption at all — it does, at scan.mjs:1083 — and
// that guess was wrong. The measurement above is what settled it.
//
//   case                                                       required
//   A  a push from the REPOSITORY ROOT                          not refused (control: worked before)
//   B  a push from a SUBDIRECTORY                               not refused           <- X217
//   C  a real secret in the tree, from a subdirectory            DENIED (control: the scan still works)
//   D  a real project's tracked Dev-Memory, from a subdirectory  DENIED (control: the exemption is
//                                                                        for THIS plugin only)
//
// Controls C and D are the whole safety argument: an exemption that resolved too loosely would
// exempt any repository's private memory, which is the hole X22's own control B guards.
//
// Usage:
//   node X217-history-exemption-basedir.mjs                # asserts the FIXED state
//   node X217-history-exemption-basedir.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO_ROOT = join(HOOKS, '..', '..', '..');
const NODE = process.execPath;
const PUSH = ['git', 'push', 'origin', 'main'].join(' ');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Run scan.mjs as if the push were issued from `cwd`. */
function decide(cwd) {
  const v = refuseCrash(
    readDecision(NODE, join(HOOKS, 'scan.mjs'), { tool_name: 'Bash', tool_input: { command: PUSH }, cwd }),
    'X217',
    die,
  );
  return v.kind === 'silent' ? 'none' : v.decision;
}

// ---- A, B: this plugin's own tree, from two directories -------------------------
const A = decide(REPO_ROOT);
if (A === 'deny') {
  die(
    'control A failed: a push from the repository ROOT is refused. That worked before this finding ' +
      `existed, so either the fixture exemption has broken entirely or this tree carries a real ` +
      'secret — check which before reading anything into case B.',
  );
}
console.log(`  A  from the repository root ..................... ${A}   (control)`);

const B = decide(HOOKS);
const bRefused = B === 'deny';
console.log(`  B  from a subdirectory (hooks/) ................. ${bRefused ? 'deny' : B}${bRefused ? '   <- X217' : ''}`);

// ---- C, D: the scan must still refuse what it should, from that same subdirectory --
function foreignProject(build) {
  const dir = mkdtempSync(join(tmpdir(), 'x217-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** test\n');
  writeFileSync(join(dir, '.gitignore'), 'nothing-ignored\n');
  writeFileSync(join(dir, 'app.txt'), 'hello\n');
  build(dir);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
  return dir;
}

{
  const dir = foreignProject((d) =>
    writeFileSync(join(d, 'creds.txt'), 'aws_key = AKIA' + 'IOSFODNN7EXAMPLE\n'),
  );
  try {
    if (decide(join(dir, 'src', 'deep')) !== 'deny') {
      die('control C failed: a real secret must still be refused when the push comes from a subdirectory.');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('  C  a real secret, from a subdirectory ........... deny (control)');
}

{
  const dir = foreignProject(() => {});
  try {
    if (decide(join(dir, 'src', 'deep')) !== 'deny') {
      die(
        "control D failed: another project's tracked Dev-Memory must still be refused. The exemption " +
          'is for THIS plugin\'s committed fixture only; one that resolved loosely enough to exempt ' +
          "any repository's private memory would be the hole X22's control B guards.",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('  D  a foreign tracked Dev-Memory ................ deny (control)');
}

if (expectBug) {
  if (!bRefused) die('expected the X217 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log('\nX217 REPRODUCED: a push from a subdirectory is refused because of this plugin\'s own committed fixture.');
  process.exit(0);
}

if (!bRefused) {
  console.log("\nPASS: the fixture exemption holds from any directory, and a foreign project's memory is still refused.");
  process.exit(0);
}

die(
  'X217 is OPEN: a push from a subdirectory is refused over this plugin\'s own test fixture. The ' +
    'history scan takes REPO-RELATIVE paths from `git diff` but the exemption resolves them against ' +
    'SESSION_DIR, which is only the same thing when the command is issued from the repository root. ' +
    '`repoToplevelForDiff` is already computed just above the history scan.',
);
