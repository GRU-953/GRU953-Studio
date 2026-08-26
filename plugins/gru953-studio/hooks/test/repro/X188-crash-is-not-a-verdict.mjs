#!/usr/bin/env node
//
// Reproduction for X188 (High, P6 convergence round 2, adjudicated 16 August 2026) — a
// reproduction cannot tell a gate that CRASHED from a gate that BLOCKED, so a shipped crash
// passes a green suite.
//
// THE DEFECT, and it is not hypothetical. Every reproduction in this directory judged a gate
// one of two ways:
//
//     try { JSON.parse(out).status } catch { 'unparsed' }   ... then   status !== 'clean'
//     r.status === 0 ? 'clean' : 'blocked'                             (the exit code alone)
//
// A crash satisfies both. It exits non-zero and prints no parseable status, so it reads as
// "the gate objected" — which is the answer a reproduction is usually hoping for.
//
// On 15 August 2026 a ReferenceError shipped in quality-gate.mjs, one of the seven blocking
// Publish pre-flight checks:
//
//     ReferenceError: problems is not defined
//         at parseRows (quality-gate.mjs:268:11)
//
// X144's own reproduction printed `D  a blank-Item row recording exit code 1 ....... BLOCKED`
// and then `PASS`, exiting 0. Twelve gates and 489 unit tests stayed green through it. The
// reproduction certified a fix while the thing it guarded was throwing.
//
// WHY THE CRASH MUST BE CONDITIONAL, which is the whole reason this defect survived.
// A gate that throws on EVERY input is caught: the reproduction's own controls stop passing,
// and the run fails (confusingly, but it fails). The crash that actually shipped fired only on
// one table shape. The controls used ordinary tables, sailed through, and only the target case
// hit the throwing branch — where "not clean" is exactly what the case wants to see. So this
// reproduction injects a crash the same way: on one fixture, not on all of them.
//
//   case                                                          required
//   A  X144 against a healthy copy of the gate                     PASS    (control: the
//                                                                           harness reaches it)
//   B  X144 against a gate that throws on the D fixture ONLY       REFUSED <- X188
//   C  that same gate, run directly on the D fixture               exit non-zero, no stdout
//                                                                          (control: this is
//                                                                           the shape that used
//                                                                           to read as BLOCKED)
//   D  X144's controls still pass under that crash                 true    (control: proves the
//                                                                           crash is conditional,
//                                                                           not total)
//
// Case C is what makes case B mean anything. Without it, "the reproduction failed" could be a
// reproduction that fails for any reason at all; C shows the gate is producing precisely the
// non-zero-exit-and-silence that the old reading called a block.
//
// Usage:
//   node X188-crash-is-not-a-verdict.mjs                # asserts the FIXED state
//   node X188-crash-is-not-a-verdict.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeMeasuredGate } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// The table shape X144 case D uses: a continuation row with a blank Item cell recording a
// failure. The injected crash fires on this and on nothing else.
const TRIGGER = '|  | fail |';

const DENT = `# Quality Gate

| Item | Status | Evidence |
| :-- | :-- | :-- |
| acceptance criteria proven | pass | \`npm run accept\` -> exit 0 |
|  | fail | e2e suite: exit code 1, 3 failing |
`;

/**
 * A throwaway copy of the hooks tree. When `conditional` is set, quality-gate.mjs is made to
 * throw a ReferenceError for a QUALITY-GATE.md containing TRIGGER, and to behave normally for
 * every other input.
 */
function hooksCopy(conditional) {
  const dir = mkdtempSync(join(tmpdir(), 'x188-'));
  const h = join(dir, 'hooks');
  cpSync(HOOKS, h, { recursive: true });
  if (conditional) {
    const p = join(h, 'quality-gate.mjs');
    const src = readFileSync(p, 'utf8');
    // Insert after the last import so the module's own imports are already bound.
    const imports = [...src.matchAll(/^import .*?;\s*$/gm)];
    const at = imports.length
      ? imports[imports.length - 1].index + imports[imports.length - 1][0].length
      : 0;
    const inject = `
// --- injected by X188's reproduction; not part of the product ---
import { readFileSync as __x188read } from 'node:fs';
import { join as __x188join } from 'node:path';
{
  const __root = process.argv[2];
  if (__root) {
    let __t = '';
    try {
      __t = __x188read(__x188join(__root, 'Dev-Memory', 'QUALITY-GATE.md'), 'utf8');
    } catch {
      __t = '';
    }
    if (__t.includes(${JSON.stringify(TRIGGER)})) __x188_no_such_function();
  }
}
// --- end injection ---
`;
    writeFileSync(p, src.slice(0, at) + inject + src.slice(at));
  }
  return { dir, h };
}

/** Run X144's reproduction inside a given hooks copy. */
function runX144(h) {
  const r = spawnSync(NODE, [join(h, 'test', 'repro', 'X144-row-judged-whole.mjs')], {
    encoding: 'utf8',
    cwd: join(h, 'test', 'repro'),
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const REFUSAL = 'must not treat that as a verdict';

// ---- A: the harness reaches X144 at all --------------------------------------
const healthy = hooksCopy(false);
let A;
try {
  A = runX144(healthy.h);
} finally {
  rmSync(healthy.dir, { recursive: true, force: true });
}
if (A.code !== 0) {
  die(
    'control A failed: X144 does not pass against an UNMODIFIED copy of the hooks tree, so ' +
      `nothing below can be trusted — the copy itself is broken, not the reader.\n${A.out.slice(-400)}`,
  );
}
console.log('  A  X144 against a healthy copy .................. PASS    (control)');

// ---- B, C, D: the conditional crash ------------------------------------------
const crashing = hooksCopy(true);
let B;
let C;
let dControlsHeld;
try {
  // C first: show the gate produces exactly the shape that used to read as a block.
  const proj = mkdtempSync(join(tmpdir(), 'x188p-'));
  // Measured record — see writeMeasuredGate in _verdict.mjs. What this reproduction needs from
  // the fixture is a gate that RUNS and prints; whether its verdict is clean or blocked is not
  // what is under test here (a crash versus a verdict is).
  writeMeasuredGate(proj, DENT);
  const g = spawnSync(NODE, [join(crashing.h, 'quality-gate.mjs'), proj], { encoding: 'utf8' });
  C = { code: g.status, stdout: `${g.stdout || ''}`, stderr: `${g.stderr || ''}` };
  rmSync(proj, { recursive: true, force: true });

  B = runX144(crashing.h);
  // D: the controls inside X144 (cases A, B and C of that file) must still have run and
  // passed, or the crash was not conditional and case B proves nothing.
  dControlsHeld = B.out.includes('a complete passing table');
} finally {
  rmSync(crashing.dir, { recursive: true, force: true });
}

if (!(C.code !== 0 && C.stdout.trim() === '')) {
  die(
    'control C failed: the injected crash did not produce a non-zero exit with empty stdout, ' +
      `so it is not the shape this finding is about (exit=${C.code}, stdout=${JSON.stringify(C.stdout.slice(0, 120))}). ` +
      'Re-check the injection before reading anything into case B.',
  );
}
if (!/ReferenceError/.test(C.stderr)) {
  die(`control C failed: expected a ReferenceError on stderr, got:\n${C.stderr.slice(0, 300)}`);
}
console.log(
  '  C  the crashing gate, run directly ............. exit non-zero, stdout empty (control)',
);

if (!dControlsHeld) {
  die(
    "control D failed: X144's own controls did not run, so the injected crash was TOTAL rather " +
      'than conditional. A total crash is caught by any reproduction; this finding is about the ' +
      'conditional one, and the case must be built that way to mean anything.',
  );
}
console.log(
  "  D  X144's own controls still ran ............... true    (the crash is conditional)",
);

const refused = B.code !== 0 && B.out.includes(REFUSAL);
console.log(
  `  B  X144 against the crashing gate ............... ${refused ? 'REFUSED' : `exit ${B.code}, verdict taken`}${refused ? '' : '  <- X188'}`,
);

if (expectBug) {
  if (refused) {
    die(
      'expected the X188 defect and did not find it: the reproduction refused the crash. If this ' +
        'was fixed, delete this --expect-bug branch deliberately rather than leaving a case that ' +
        'can no longer detect anything.',
    );
  }
  console.log(
    `\nX188 REPRODUCED: X144 exited ${B.code} on a gate that threw, treating the crash as a verdict.`,
  );
  process.exit(0);
}

if (refused) {
  console.log(
    '\nPASS: a gate that throws is named as a crash and refused; it can no longer be read as a block.',
  );
  process.exit(0);
}

die(
  `X188 is OPEN: quality-gate.mjs threw a ReferenceError and X144 exited ${B.code} without ` +
    'naming it. A crash exits non-zero and prints no parseable status, which is indistinguishable ' +
    'from a refusal under both of the readings this directory used — `status !== "clean"` and ' +
    '`exitCode === 0 ? clean : blocked`. Fix: read the verdict through _verdict.mjs, which ' +
    'classifies clean / blocked / silent / crash, and refuse to reason about a crash.',
);
