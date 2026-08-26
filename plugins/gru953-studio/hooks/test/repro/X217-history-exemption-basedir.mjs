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
import { readDecision, refuseCrash, asStudioProject } from './_verdict.mjs';

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

/**
 * Run scan.mjs as if the push were issued from `cwd`, returning the decision AND the reason.
 *
 * The reason is not decoration. `scan.mjs` has two quite different ways to refuse a push — a
 * secret/key-file finding in the would-ship set, and "Dev-Memory/ is not excluded by .gitignore" —
 * and they are worded distinctly. A control that reads only `deny` cannot tell which one fired, so
 * it proves whichever thing the author already believed. That is the X188 defect (a check that
 * cannot distinguish two causes reports the wrong one) reappearing inside a control, and the first
 * version of controls C and D below had exactly it: their repository carried a TRACKED Dev-Memory,
 * so both refused for that reason and neither said anything about secret detection at all. Measured
 * and corrected the same day.
 */
function decide(cwd) {
  const v = refuseCrash(
    readDecision(NODE, join(HOOKS, 'scan.mjs'), {
      tool_name: 'Bash',
      tool_input: { command: PUSH },
      cwd,
    }),
    'X217',
    die,
  );
  return {
    decision: v.kind === 'silent' ? 'none' : v.decision,
    reason: (v.reason || '').replace(/\s+/g, ' '),
  };
}

// The two refusal wordings, so a control can say WHICH rule fired rather than merely that one did.
const SECRET_REASON = /secrets, key files/i;
const GITIGNORE_REASON = /not excluded by \.gitignore/i;

// ---- A, B: this plugin's own tree, from two directories -------------------------
// 2026-08-26, X366. Cases A and B run `scan.mjs` against THIS repository, and `scan.mjs` steps aside
// entirely — no decision at all — when `findStudioRoot()` finds no `Dev-Memory/` at or above the cwd
// (scan.mjs:947 -> lib.mjs:384). `Dev-Memory/` is gitignored, so on CI both came back `none`,
// `bRefused` was false, and case B — the whole subject of this file — 'passed' because the code under
// test was never reached. This file's own header states that hazard for controls C and D ('a probe
// repository must have a Dev-Memory/ folder or nothing is measured at all') and then failed to apply
// it to A and B. Exactly the X347 mechanism: one gate, two honest answers, and the test pinning
// whichever the environment happens to give.
//
// `asStudioProject` creates the directory when it is absent and removes only what it created, so both
// cases are now exercised everywhere. `engaged` is reported rather than assumed: if the hook could not
// be engaged, that is said out loud instead of read as a pass.
const [A, B, engaged] = asStudioProject(REPO_ROOT, (on) => [decide(REPO_ROOT), decide(HOOKS), on]);
if (!engaged) {
  // `die`, not a soft note, and in BOTH directions: if the hook could not be engaged then neither
  // case measured anything, and a reproduction that measured nothing must never report success.
  die(
    'cases A and B: there is no `Dev-Memory/` at or above this checkout and one could not be ' +
      'created, so scan.mjs stood aside and neither case measured anything. That is not a pass.',
  );
}
if (A.decision === 'deny') {
  die(
    'control A failed: a push from the repository ROOT is refused. That worked before this finding ' +
      `existed, so either the fixture exemption has broken entirely or this tree carries a real ` +
      `secret — check which before reading anything into case B. Reason given: ${A.reason}`,
  );
}
console.log(`  A  from the repository root ..................... ${A.decision}   (control)`);

const bRefused = B.decision === 'deny';
console.log(
  `  B  from a subdirectory (hooks/) ................. ${B.decision}${bRefused ? '   <- X217' : ''}`,
);

// ---- C, D: the scan must still refuse what it should, from that same subdirectory --
//
// `scan.mjs` stands aside entirely outside a studio project ("Not a studio project: never
// interfere"), so a probe repository must have a Dev-Memory/ folder or nothing is measured at all —
// which is how the first version of these controls came to prove nothing. Whether that folder is
// GITIGNORED is then the switch that separates the two refusal causes:
//   ignored -> the project is a studio project, the gitignore rule is satisfied, and the only thing
//              left to refuse is the secret. Used by control C.
//   tracked -> the gitignore rule fires on its own, with no secret needed. Used by control D.
function studioProject({ ignoreDevMemory, secret }) {
  const dir = mkdtempSync(join(tmpdir(), 'x217-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** test\n');
  writeFileSync(join(dir, '.gitignore'), ignoreDevMemory ? '/Dev-Memory/\n' : 'nothing-ignored\n');
  writeFileSync(join(dir, 'app.txt'), 'hello\n');
  if (secret) writeFileSync(join(dir, 'creds.txt'), `aws_key = '${'AKIA' + 'IOSFODNN7EXAMPLE'}'\n`);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
  return dir;
}

function control(label, opts, wantReason, whyItMatters) {
  const dir = studioProject(opts);
  let got;
  try {
    got = decide(join(dir, 'src', 'deep'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (got.decision !== 'deny') {
    die(`${label} failed: expected deny, got ${got.decision}. ${whyItMatters}`);
  }
  if (!wantReason.test(got.reason)) {
    die(
      `${label} refused, but for the WRONG REASON — so it does not test what it claims. Wanted a ` +
        `reason matching ${wantReason}, got: ${got.reason.slice(0, 200)}`,
    );
  }
  return got;
}

control(
  '  control C',
  { ignoreDevMemory: true, secret: true },
  SECRET_REASON,
  'A real secret must still be refused when the push comes from a subdirectory; without this, case B ' +
    'could be produced by a scan that refuses nothing at all.',
);
console.log('  C  a real secret, from a subdirectory ........... deny, for the secret (control)');

control(
  '  control D',
  { ignoreDevMemory: false, secret: false },
  GITIGNORE_REASON,
  "Another project's private memory must still be refused. The exemption is for THIS plugin's " +
    "committed fixture only; one resolved loosely enough to exempt any repository's Dev-Memory would " +
    "be the hole X22's own control B guards.",
);
console.log('  D  a foreign, unignored Dev-Memory ............. deny, for Dev-Memory (control)');

if (expectBug) {
  if (!bRefused)
    die(
      'expected the X217 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(
    "\nX217 REPRODUCED: a push from a subdirectory is refused because of this plugin's own committed fixture.",
  );
  process.exit(0);
}

if (!bRefused) {
  console.log(
    "\nPASS: the fixture exemption holds from any directory, and a foreign project's memory is still refused.",
  );
  process.exit(0);
}

die(
  "X217 is OPEN: a push from a subdirectory is refused over this plugin's own test fixture. The " +
    'history scan takes REPO-RELATIVE paths from `git diff` but the exemption resolves them against ' +
    'SESSION_DIR, which is only the same thing when the command is issued from the repository root. ' +
    '`repoToplevelForDiff` is already computed just above the history scan.',
);
