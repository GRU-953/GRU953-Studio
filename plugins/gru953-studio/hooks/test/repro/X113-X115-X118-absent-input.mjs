#!/usr/bin/env node
//
// Reproduction for X113, X115 and X118 — three gates that report success when the thing
// they are supposed to read is simply not there.
//
// ONE REPRODUCTION, THREE FINDINGS, DELIBERATELY. The project's rule is one reproduction
// per finding, and this file bends it on purpose: these are not three defects, they are
// one rule broken in three places —
//
//     a check must FAIL when its input is missing, unreadable, or unrecognised.
//
// Splitting them into three near-identical files would hide that, and the single most
// valuable output of the P1-D diagnosis was noticing that these are the same thing. Each
// gate still gets its own case AND its own control, so no finding rests on another's
// evidence.
//
// THE CRUCIAL DISTINCTION, which a careless fix would destroy. "Input absent" and "not
// my project" are different situations and must stay different:
//
//   * no Dev-Memory/ at all      -> stand down. These gates run inside other people's
//                                   repositories and must never interfere with them.
//   * Dev-Memory/ present, but
//     the file this gate needs
//     is missing                 -> FAIL. This IS a studio project, and the gate cannot
//                                   do the job it exists for.
//
// The old code collapsed both into "exit 0", so a studio project missing its progress
// file was indistinguishable from someone else's repository. Every case below tests both
// sides, because a fix that made the first case fail would break the product for
// everyone who installs it.
//
//   gate                 case                                        required
//   verify-progress      Dev-Memory present, PROGRESS.md absent       FAIL   <- X113
//   verify-progress      no Dev-Memory at all                         exit 0 (control)
//   licence-scan         the root directory does not exist            FAIL   <- X115
//   licence-scan         a real directory with no manifests           clean  (control)
//   docs-consistency     CHANGELOG.md absent                          FAIL   <- X118
//   docs-consistency     CHANGELOG.md present                         no such complaint (control)
//
// Usage:
//   node X113-X115-X118-absent-input.mjs                # asserts the FIXED state
//   node X113-X115-X118-absent-input.mjs --expect-bug   # asserts the DEFECTS are present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Run a gate against `dir` and return { code, out }.
 *
 * Every case below judges by the exit code — `.code !== 0` meaning "the gate objected". A
 * crash also exits non-zero, so before this guard a THROWING gate read as a blocking one and
 * these cases reported themselves fixed. readGate() separates the two; refuseCrash() stops
 * the run rather than letting it draw a conclusion from a broken gate.
 */
function run(gate, dir) {
  const v = refuseCrash(readGate(NODE, join(HOOKS, gate), [dir]), `${gate} in X113-X115-X118`, die);
  return { code: v.code, out: v.raw };
}

function withTmp(build, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'x113-'));
  try {
    if (build) build(dir);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const results = {};

// ---- X113: verify-progress ---------------------------------------------------
// Case: a real studio project (Dev-Memory exists) whose PROGRESS.md is missing.
results.x113 = withTmp(
  (d) => mkdirSync(join(d, 'Dev-Memory'), { recursive: true }),
  (d) => run('verify-progress.mjs', d).code !== 0,
);
console.log(`  X113  verify-progress, Dev-Memory present but no PROGRESS.md  -> ${results.x113 ? 'FAILS  ' : 'exit 0 '}${results.x113 ? '' : '<- defect'}`);

// Control: no Dev-Memory at all must still stand down.
{
  const standsDown = withTmp(null, (d) => run('verify-progress.mjs', d).code === 0);
  if (!standsDown) {
    die(
      'control failed: verify-progress refused a directory with NO Dev-Memory. These gates run ' +
        'inside other people\'s repositories and must never interfere with them — this fix would ' +
        'break the product for everyone who installs it.',
    );
  }
  console.log('  ctrl  verify-progress, no Dev-Memory at all ................. exit 0  (as expected)');
}

// ---- X115: licence-scan ------------------------------------------------------
// Case: a root directory that does not exist at all.
{
  const missing = join(tmpdir(), 'x115-definitely-not-here-9f3a2c');
  const r = run('licence-scan.mjs', missing);
  results.x115 = r.code !== 0;
  console.log(`  X115  licence-scan, root does not exist ..................... ${results.x115 ? 'FAILS  ' : 'clean  '}${results.x115 ? '' : '<- defect'}`);
}

// Control: a real directory with genuinely no manifests is legitimately clean.
{
  const clean = withTmp(
    (d) => writeFileSync(join(d, 'README.md'), '# nothing here\n'),
    (d) => run('licence-scan.mjs', d).code === 0,
  );
  if (!clean) {
    die(
      'control failed: licence-scan refused a real directory that simply has no dependency ' +
        'manifests. Having no dependencies is not a defect — this plugin itself has none.',
    );
  }
  console.log('  ctrl  licence-scan, real directory, no manifests ............ clean   (as expected)');
}

// ---- X118: docs-consistency --------------------------------------------------
// Case: CHANGELOG.md absent means the version cross-checks silently do not run.
const CHANGELOG_MARKER = 'CHANGELOG.md';
{
  const complains = withTmp(
    (d) => {
      mkdirSync(join(d, 'plugins', 'gru953-studio'), { recursive: true });
      writeFileSync(join(d, 'README.md'), '# Fixture\n');
    },
    (d) => run('docs-consistency.mjs', d).out.includes(CHANGELOG_MARKER),
  );
  results.x118 = complains;
  console.log(`  X118  docs-consistency, CHANGELOG.md absent ................. ${results.x118 ? 'FAILS  ' : 'silent '}${results.x118 ? '' : '<- defect'}`);
}

// Control: with a CHANGELOG present, the gate must not raise that same complaint —
// otherwise "it complains" above would prove nothing.
{
  const quiet = withTmp(
    (d) => {
      mkdirSync(join(d, 'plugins', 'gru953-studio'), { recursive: true });
      writeFileSync(join(d, 'README.md'), '# Fixture\n');
      writeFileSync(join(d, 'CHANGELOG.md'), '## v9.9.9\n\n- fixture\n');
    },
    (d) => !run('docs-consistency.mjs', d).out.includes('CHANGELOG.md is missing'),
  );
  if (!quiet) {
    die('control failed: docs-consistency reports CHANGELOG.md missing even when it is present.');
  }
  console.log('  ctrl  docs-consistency, CHANGELOG.md present ................ no such complaint');
}

const open = [];
if (!results.x113) open.push('X113 (verify-progress)');
if (!results.x115) open.push('X115 (licence-scan)');
if (!results.x118) open.push('X118 (docs-consistency)');

if (expectBug) {
  if (open.length === 0) {
    die(
      'expected the absent-input defects and found none: all three gates now fail when their ' +
        'input is missing. If they were fixed, delete this --expect-bug branch deliberately.',
    );
  }
  console.log(`\nREPRODUCED: ${open.length} gate(s) still report success on absent input — ${open.join(', ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log(
    '\nPASS: all three gates fail when their input is missing, and all three still stand down ' +
      'when there is no studio project to check.',
  );
  process.exit(0);
}

die(
  `OPEN — ${open.join(', ')} still report success when the thing they read is not there. ` +
    'A gate that cannot read its input must never claim its input is fine. ' +
    'Fix: distinguish "not my project" (stand down) from "my project, input missing" (fail).',
);
