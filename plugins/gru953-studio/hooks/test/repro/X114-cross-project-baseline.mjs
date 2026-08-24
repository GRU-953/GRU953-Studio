#!/usr/bin/env node
//
// Reproduction for X114 — roster-check can judge one project's roster against another
// project's baseline, and report `clean`.
//
// THE DEFECT. The two roots are defaulted independently:
//
//     const pluginRoot   = process.argv[2] || path.resolve(here, '..');  // the plugin
//     const devMemoryRoot = process.argv[3] || process.cwd();            // wherever you stand
//
// Two roots is correct by design — an installed plugin lives outside the project whose
// baseline governs it. What is not correct is defaulting them independently, because a
// bare invocation then pairs "the plugin next to this script" with "any file matching
// /roster/i under the current directory", and nobody has asserted that those belong
// together.
//
// BOTH DIRECTIONS ARE REACHABLE, and the second is why this is High:
//
//   foreign baseline of 5   -> BLOCKED "38 roles, exceeding the last recorded baseline of 5"
//                              a false block: noisy, and a gate that cries wolf gets ignored
//   foreign baseline of 90  -> clean, recordedBaseline 90
//                              a FALSE CLEAN: the plugin could grow from 38 to 89 unnoticed,
//                              measured against a number belonging to another project entirely
//
// WHY THE FIX IS "MAKE THE CALLER SAY" RATHER THAN A CLEVERER RULE. Nothing in the data
// distinguishes a legitimate pairing from an accidental one. A project baseline may
// legitimately exceed the plugin's own ROSTER.md — that is exactly what it is for, to
// record a deliberate addition with its reason. So comparing the two numbers cannot
// settle it, and neither can "is the plugin inside the project", because for an installed
// plugin it never is.
//
// What CAN be distinguished is whether anybody asserted the pairing. If both roots were
// given, the caller asserted it. If both were defaulted, nobody did — and a foreign
// baseline is then being used by accident. So a defaulted cross-project pairing is
// refused, with the exact command to run instead.
//
//   case                                                          required
//   A  the product repo, roots given explicitly                    clean   (control)
//   B  no baseline anywhere, bare invocation                       clean   (control — ROSTER.md)
//   C  a foreign baseline of 90, bare invocation                   FAILS   <- X114 (false clean)
//   D  a foreign baseline of 5, bare invocation                    FAILS   (already blocked, but for the wrong reason)
//   E  the same foreign baseline, roots given explicitly           clean   (control — the caller asserted it)
//
// Control E is the one that keeps this fix honest: naming both roots must still work, or
// the fix would simply have broken the documented invocation.
//
// Usage:
//   node X114-cross-project-baseline.mjs                # asserts the FIXED state
//   node X114-cross-project-baseline.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const PLUGIN = join(HOOKS, '..');
const gate = join(HOOKS, 'roster-check.mjs');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Run roster-check from `cwd` with `args`, and return its parsed verdict. */
function run(args, cwd) {
  // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
  // let this reproduction reason about it. See _verdict.mjs.
  const v = refuseCrash(
    readGate(process.execPath, gate, args, { cwd }),
    'X114-cross-project-baseline.mjs',
    die,
  );
  return { ...v.json, status: v.status, code: v.code, raw: v.raw.slice(0, 300) };
}

/** A throwaway project carrying a roster baseline that has nothing to do with this plugin. */
function foreignProject(count, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'x114-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory', 'decisions'), { recursive: true });
    writeFileSync(
      join(dir, 'Dev-Memory', 'decisions', '2026-08-01-roster-baseline.md'),
      `# Roster baseline for an unrelated project\n\nrole count: ${count}\n`,
    );
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- Controls that must keep working -----------------------------------------
const A = run([PLUGIN, join(PLUGIN, '..', '..')], PLUGIN);
if (A.status !== 'clean')
  die(
    `control A failed: the documented invocation must stay clean, got ${A.status} — ${A.reason || A.raw || ''}`,
  );
console.log('  A  roots given explicitly, product repo ........... clean   (as expected)');

const B = foreignProject(0, () => {
  const empty = mkdtempSync(join(tmpdir(), 'x114-empty-'));
  try {
    return run([], empty);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
// 2026-08-24, X280, on the owner's decision. This control asserted that a BARE invocation falls
// back safely to the plugin's own ROSTER.md and passes. That fallback is gone, and deliberately:
// X280 established that all four shipped callers ran it bare, so the safety X114 added — the caller
// asserting both roots — was never exercised in the product at all. A check whose safety depends on
// an argument nobody passes has never been safe, so the bare form now REFUSES rather than guessing.
//
// The control is therefore inverted, not deleted: what must hold is that bare is refused, and that
// the refusal says what to type. Cases C and D below still assert that a foreign baseline is never
// silently adopted, which is X114's own subject and is unaffected.
if (B.status === 'clean') {
  die(
    'control B failed: a BARE invocation returned clean. It must refuse and say which two roots to ' +
      `name (X280), because without them it counts one tree's agents against another's baseline: ${JSON.stringify(B)}`,
  );
}
if (!/both roots|roster-check needs/i.test(String(B.reason || ''))) {
  die(
    `control B failed: it refuses, but the reason does not tell the caller what to pass: ${JSON.stringify(B.reason)}`,
  );
}
console.log('  B  bare invocation .............................. refused, and says what to pass');

// ---- The defect: a foreign baseline, silently adopted ------------------------
const C = foreignProject(90, (dir) => run([], dir));
const cCaught = C.status !== 'clean';
console.log(
  `  C  bare, foreign baseline of 90 (> 38 roles) ..... ${cCaught ? 'FAILS  ' : 'clean  '}${cCaught ? '' : '<- X114, a FALSE CLEAN'}`,
);

const D = foreignProject(5, (dir) => run([], dir));
const dCaught =
  D.status !== 'clean' && /explicit|both roots|cross-project/i.test(String(D.reason || ''));
console.log(
  `  D  bare, foreign baseline of 5 ................... ${D.status !== 'clean' ? 'blocked' : 'clean  '}${dCaught ? ' (for the right reason)' : ' (for the WRONG reason)'}`,
);

// ---- Control E: naming both roots must still work ----------------------------
const E = foreignProject(90, (dir) => run([PLUGIN, dir], dir));
if (E.status !== 'clean') {
  die(
    `control E failed: naming both roots explicitly must still work — the caller asserted the ` +
      `pairing. Got ${E.status}: ${E.reason || ''}`,
  );
}
console.log('  E  same foreign baseline, roots given explicitly .. clean   (as expected)');

if (expectBug) {
  if (cCaught)
    die(
      'expected the X114 false clean and did not find it. If it was fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(
    '\nX114 REPRODUCED: a foreign project baseline of 90 silently governs this plugin, so growth to 89 would pass.',
  );
  process.exit(0);
}

if (cCaught && dCaught) {
  console.log(
    '\nPASS: a baseline pairing nobody asserted is refused, and naming both roots still works.',
  );
  process.exit(0);
}

die(
  `X114 is OPEN. ${cCaught ? '' : 'A foreign baseline of 90 was adopted silently, so real scope creep in this plugin would read as clean. '}` +
    `${dCaught ? '' : 'A foreign baseline of 5 blocks, but for the wrong reason — it reports scope creep rather than an unasserted pairing, which sends the reader hunting a defect that does not exist. '}` +
    'Fix: when BOTH roots are defaulted and a project baseline is found, refuse and name the explicit command.',
);
