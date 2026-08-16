#!/usr/bin/env node
//
// Reproduction for X116 and X117 — two invariants that test something weaker than the
// fact they claim to establish.
//
// ONE REPRODUCTION, TWO FINDINGS, DELIBERATELY: same file, same shape —
//
//     a substring standing in for a structural fact.
//
// Each gets its own case AND its own control, so neither rests on the other's evidence.
//
// ---- X117: "runs in CI" is tested as "the filename appears in the YAML" -------
//
//     } else if (!/docs-consistency\.mjs/.test(ciYmlText)) { fail(...) }
//
// The invariant claims the gate RUNS in CI. What it tests is that its filename occurs
// somewhere in ci.yml — in a step, in a comment, in a job name, anywhere. Delete the
// `run:` line and the check stays quiet as long as the name survives in prose.
//
// This is not hypothetical in this repository. `.github/workflows/ci.yml` line 159 is a
// COMMENT reading "docs-consistency.mjs's lifecycle-stage-count check located its target
// paragraph with a literal \n\n…". That comment alone satisfies the current check, so the
// step it is meant to guard could be removed today and nothing would notice.
//
// ---- X116: matcher and command are checked, but never together ---------------
//
//     const matchers    = preToolUse.map(e => e.matcher);
//     const allCommands = preToolUse.flatMap(e => e.hooks).map(h => h.command);
//     if (!matcherCoversTool(matchers, 'Bash')) fail(...)
//     if (!allCommands.some(c => /scan\.mjs/.test(c))) fail(...)
//
// Both lists are computed over ALL PreToolUse entries and never correlated. So "some
// entry covers Bash" and "some entry runs scan.mjs" can be satisfied by two DIFFERENT
// entries, and scan.mjs need never run on a Bash command at all — which is precisely
// what these two invariants exist to guarantee.
//
//   case                                                        required
//   A  ci.yml with a real `run:` step                            silent   (control)
//   B  ci.yml mentioning the gate ONLY in a comment              FAILS    <- X117
//   C  hooks.json wiring scan/gate under a Bash matcher          silent   (control)
//   D  hooks.json where Bash and scan.mjs are in DIFFERENT entries FAILS  <- X116
//
// Usage:
//   node X116-X117-weaker-predicate.mjs                # asserts the FIXED state
//   node X116-X117-weaker-predicate.mjs --expect-bug   # asserts the DEFECTS are present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const gate = join(HOOKS, 'repo-integrity.mjs');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Run repo-integrity against a fixture and return the problems it reported. */
function problems(build) {
  const dir = mkdtempSync(join(tmpdir(), 'x116-'));
  try {
    build(dir);
    // Parse rather than grep: this gate emits JSON, so quotes inside messages arrive
    // escaped and raw substring matching silently finds nothing. readGate() additionally
    // separates a gate that THREW from one that objected — both exit non-zero, and this
    // reproduction concludes "the check did not fire" from an empty problems list, which a
    // crash would produce just as readily as a healthy clean run.
    const v = refuseCrash(readGate(process.execPath, gate, [dir]), 'X116-X117-weaker-predicate.mjs', die);
    return v.problems;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skeleton = (dir) => {
  mkdirSync(join(dir, 'plugins', 'gru953-studio', 'hooks'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
};

const REAL_STEP =
  'jobs:\n  gates:\n    steps:\n' +
  '      - name: Documentation-consistency check\n' +
  '        run: node plugins/gru953-studio/hooks/docs-consistency.mjs .\n' +
  '      - name: Operating-charter consistency check\n' +
  '        run: node plugins/gru953-studio/hooks/charter-check.mjs .\n';

// The same file with the steps removed and only prose left — the exact shape ci.yml
// line 159 already has in this repository.
const COMMENT_ONLY =
  'jobs:\n  gates:\n    steps:\n' +
  '      # docs-consistency.mjs used to run here; see the note about charter-check.mjs\n' +
  '      - name: Something else entirely\n' +
  '        run: echo hello\n';

const wiring = (entries) => JSON.stringify({ hooks: { PreToolUse: entries } }, null, 2);

const GOOD_WIRING = wiring([
  {
    matcher: 'Bash|PowerShell|Monitor|run_command',
    hooks: [
      { type: 'command', command: 'node scan.mjs' },
      { type: 'command', command: 'node gate.mjs' },
    ],
  },
]);

// Both invariants are satisfied by DIFFERENT entries: entry 1 covers Bash but runs
// something harmless; entry 2 runs the safety hooks under a matcher that matches nothing
// a user would ever type. Today this passes.
const SPLIT_WIRING = wiring([
  { matcher: 'Bash|PowerShell|Monitor', hooks: [{ type: 'command', command: 'node self-heal-nudge.mjs' }] },
  { matcher: 'NeverMatchesAnything', hooks: [{ type: 'command', command: 'node scan.mjs' }, { type: 'command', command: 'node gate.mjs' }] },
]);

const mentions = (list, re) => list.some((p) => re.test(p));
// Matched narrowly, against the exact wording of the two invariants under test. A looser
// pattern is not merely sloppy here: the first version of this script used one, and it
// matched repo-integrity's UNRELATED dangling-reference check, reporting a broken control
// on a fixture that was fine. Both patterns must stay stable across the fix, so they
// anchor on the phrases the messages keep either side of it.
const CI_RE = /no longer runs (docs-consistency|charter-check)\.mjs|cannot verify (docs-consistency|charter-check)\.mjs runs in CI/i;
const WIRING_RE = /no longer wires (scan|gate)\.mjs/i;

// ---- X117 -------------------------------------------------------------------
const A = problems((d) => {
  skeleton(d);
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), REAL_STEP);
});
if (mentions(A, CI_RE)) {
  die(`control A failed: a ci.yml with real run: steps was reported as not running the gates — ${A.find((p) => CI_RE.test(p))}`);
}
console.log('  A  ci.yml with a real `run:` step ................. silent  (as expected)');

const B = problems((d) => {
  skeleton(d);
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), COMMENT_ONLY);
});
const bCaught = mentions(B, CI_RE);
console.log(`  B  ci.yml mentioning the gate ONLY in a comment ... ${bCaught ? 'FAILS  ' : 'silent '}${bCaught ? '' : '<- X117'}`);

// ---- X116 -------------------------------------------------------------------
const C = problems((d) => {
  skeleton(d);
  writeFileSync(join(d, 'plugins', 'gru953-studio', 'hooks', 'hooks.json'), GOOD_WIRING);
});
if (mentions(C, WIRING_RE)) {
  die(`control C failed: correct wiring was reported as broken — ${C.find((p) => WIRING_RE.test(p))}`);
}
console.log('  C  scan/gate wired under a Bash matcher ........... silent  (as expected)');

const D = problems((d) => {
  skeleton(d);
  writeFileSync(join(d, 'plugins', 'gru953-studio', 'hooks', 'hooks.json'), SPLIT_WIRING);
});
const dCaught = mentions(D, WIRING_RE);
console.log(`  D  Bash and scan.mjs in DIFFERENT entries ......... ${dCaught ? 'FAILS  ' : 'silent '}${dCaught ? '' : '<- X116'}`);

const open = [];
if (!bCaught) open.push('X117 (a comment satisfies "runs in CI")');
if (!dCaught) open.push('X116 (matcher and command never correlated)');

if (expectBug) {
  if (open.length === 0) {
    die('expected the X116/X117 defects and found neither. If they were fixed, delete this --expect-bug branch deliberately.');
  }
  console.log(`\nREPRODUCED: ${open.join(' and ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: "runs in CI" means a real step, and the safety hooks must be wired under a matcher that covers Bash.');
  process.exit(0);
}

die(
  `OPEN — ${open.join(' and ')}. Both test something weaker than the fact they claim to ` +
    'establish: a filename anywhere in a YAML file, and two independent lists never compared. ' +
    'Fix: ignore comment lines before testing ci.yml, and correlate each required command with ' +
    'the matcher of the entry it is actually wired under.',
);
