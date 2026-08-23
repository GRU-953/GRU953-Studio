#!/usr/bin/env node
//
// Reproduction for X119 — `quality-gate` satisfies a Definition-of-Done dimension on any row whose
// Item text merely CONTAINS a keyword, so one row's evidence can vouch for two dimensions and a
// dimension can be signed off by something that is not it.
//
// X119 IS A DISCLOSED RESIDUAL, NOT A DEFECT AWAITING A PATCH, and this file asserts what was
// actually shipped rather than pretending otherwise. The history matters:
//
// The gate's own source records it as "finding D6 of the silent-skip sweep — answered by MEASUREMENT
// rather than by tightening". Across 24 distinct Item labels drawn from six sources, zero matched
// more than one dimension, and the obvious tightening (requiring the keyword at the START of the
// label) would have MISSED 4 of 10 real labels — "Automated tests", "Independent code review",
// "Regression tests", "Improve test coverage tooling integration" — and blocked healthy projects with
// "missing required dimension". That is the false-alarm failure that gets a gate switched off, and it
// would have been worse than the defect. So the evidence said: do not tighten. What shipped instead is
// `satisfiedBy` in the verdict, which makes the match VISIBLE so a human reading a clean result can
// see which row vouched for each dimension and spot a wrong one.
//
// WHAT THIS FILE ADDS, measured 2026-08-24 while adjudicating the row: the collision is NOT exotic.
// The dimension matchers are plain substring regexes — /accept/i, /\btest/i, /review/i,
// /secur|secret|licen[cs]e|privac|vuln/i, /access/i, /\bdoc/i, /reproduc|\bbuild/i — and 8 of 12
// entirely ordinary labels collide:
//
//     Security review        -> review + security          Test documentation  -> tests + docs
//     Documentation review   -> review + docs              Build and test      -> tests + build
//     Accessibility review   -> review + accessibility     Licence review      -> review + security
//     Code review and tests  -> tests + review             Peer review of docs -> review + docs
//
// So the measurement that justified not tightening sampled the labels that HAPPEN TO EXIST, not the
// ones a project might plausibly write. "Security review" and "Build and test" are unremarkable
// things to put in a table. Proven end to end: a table with the "Independent code review" row deleted
// and "Accessibility" relabelled "Accessibility review" returns `clean`, with
// `satisfiedBy.review = ["Accessibility review"]` — the independent-code-review dimension signed off
// by an accessibility row, on one piece of evidence.
//
// THIS IS THE MECHANISM BEHIND X276. That finding is `QUALITY-GATE.md` marking "Independent code
// review — pass" while the prose beneath it is headed "Why 'Independent code review' is not a pass".
// X119 is how such a state can be reached and still pass the gate.
//
//   case                                                      required
//   A  a clean verdict exposes satisfiedBy                     the mitigation is present
//   B  satisfiedBy names the ACTUAL row for each dimension     it is usable, not decorative
//   C  the collision is visible when it happens                a wrong match shows in satisfiedBy
//   D  control: the golden fixture is clean                    no false alarm
//   E  control: a genuinely missing dimension still BLOCKS      the gate has not been loosened
//
// Case C asserts the residual's DISCLOSURE, not its absence: the collision is expected to occur, and
// the requirement is that a reader can see it. If a future change tightens the match so C stops
// colliding, C is written to pass that way too and says so — the point is that the gate never signs
// a dimension off invisibly.
//
// Usage:
//   node X119-dimension-evidence-binding.mjs                # asserts the shipped state
//   node X119-dimension-evidence-binding.mjs --expect-bug   # asserts the mitigation is absent

import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  const r = spawnSync(process.execPath, [join(HOOKS, 'quality-gate.mjs'), root], {
    encoding: 'utf8',
  });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 200) };
  }
}

function fixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x119-'));
  cpSync(join(GOLDEN, 'Dev-Memory'), join(dir, 'Dev-Memory'), { recursive: true });
  if (mutate) {
    const p = join(dir, 'Dev-Memory', 'QUALITY-GATE.md');
    writeFileSync(p, mutate(readFileSync(p, 'utf8')), 'utf8');
  }
  return dir;
}

// ---- A and B: the mitigation is present and usable -------------------------------
{
  const v = verdict(GOLDEN);
  const sb = v.satisfiedBy;
  if (v.status !== 'clean') {
    note(
      `case A: the golden fixture is not clean ("${v.status}"), so the mitigation cannot be judged here`,
    );
  } else if (!sb || typeof sb !== 'object' || Array.isArray(sb)) {
    note(
      'case A: a clean verdict does NOT expose satisfiedBy, so a reader cannot see which row vouched ' +
        'for each dimension. That reporting IS the shipped answer to this finding — without it the ' +
        'residual is undisclosed rather than disclosed.',
    );
  } else {
    console.log('  A  a clean verdict exposes satisfiedBy ....... present');
    const empty = Object.entries(sb).filter(
      ([, rowsFor]) => !Array.isArray(rowsFor) || !rowsFor.length,
    );
    if (empty.length) {
      note(
        `case B: satisfiedBy names no row for ${empty.map(([k]) => k).join(', ')}, so it reports the ` +
          'dimension without reporting what satisfied it',
      );
    } else {
      console.log('  B  satisfiedBy names the actual row .......... for every dimension');
    }
  }
}

// ---- C: when a collision happens, it is VISIBLE ---------------------------------
{
  // Delete the review row; relabel Accessibility so one row matches both dimensions.
  const dir = fixture((t) =>
    t
      .split('\n')
      .filter((l) => !/^\|\s*Independent code review\s*\|/.test(l))
      .map((l) =>
        /^\|\s*Accessibility\s*\|/.test(l)
          ? '| Accessibility review | pass | one row, one piece of evidence, for two dimensions |'
          : l,
      )
      .join('\n'),
  );
  const v = verdict(dir);
  const sb = v.satisfiedBy || {};
  const reviewRows = sb.review || [];
  if (v.status === 'BLOCKED') {
    // Legitimate outcome IF a future change tightened the match. Say so rather than failing.
    console.log(
      '  C  the collision ............................. no longer possible (match tightened)',
    );
  } else if (!reviewRows.length) {
    note(
      'case C: the verdict is clean and satisfiedBy names NO row for the review dimension, so the ' +
        'dimension passed with nothing recorded as having satisfied it',
    );
  } else if (!reviewRows.some((r) => /accessibility/i.test(r))) {
    console.log(
      `  C  the collision ............................. not reached (review <- ${JSON.stringify(reviewRows)})`,
    );
  } else {
    console.log(
      `  C  the collision is visible .................. review <- ${JSON.stringify(reviewRows)}`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- D: control — the golden fixture must stay clean ---------------------------
{
  const v = verdict(GOLDEN);
  if (v.status !== 'clean') note(`control D: the golden fixture is not clean ("${v.status}")`);
  else console.log('  D  control: the golden fixture ............... clean');
}

// ---- E: control — a genuinely missing dimension must still block --------------
{
  const dir = fixture((t) =>
    t
      .split('\n')
      .filter((l) => !/^\|\s*(Reproducible build|Accessibility)\s*\|/.test(l))
      .join('\n'),
  );
  const v = verdict(dir);
  if (v.status !== 'BLOCKED') {
    note(
      `control E: removing two required dimensions still returns "${v.status}". The gate has been ` +
        'loosened, which is a worse outcome than the residual this file documents',
    );
  } else {
    console.log('  E  control: a missing dimension .............. still BLOCKED');
  }
  rmSync(dir, { recursive: true, force: true });
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; the mitigation is present.');
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
  '\nPASS: the gate reports which row satisfied each dimension, so a dimension signed off by the ' +
    'wrong row is visible to a reader rather than silent — which is the disclosed answer to X119.',
);
