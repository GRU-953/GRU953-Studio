#!/usr/bin/env node
//
// Reproduction for X119 — `quality-gate` satisfies a Definition-of-Done dimension on any row whose
// Item text merely CONTAINS a keyword, so one row's evidence can vouch for two dimensions and a
// dimension can be signed off by something that is not it.
//
// X119 WAS a disclosed residual and is now FIXED, on 2026-08-24. The history matters, because the
// reasoning that first declined to fix it was right about the fix it was offered:
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
//   C1 a colliding label cannot cover two dimensions           BLOCKED, naming the missing one
//   C2 control: the same label beside a dedicated row         clean, attributed separately
//   D  control: the golden fixture is clean                    no false alarm
//   E  control: a genuinely missing dimension still BLOCKS      the gate has not been loosened
//
// C2 IS THE LOAD-BEARING CONTROL. An earlier attempt at this fix blocked whenever a dimension's only
// row also matched another dimension — and that fired on "Accessibility review" covering
// accessibility, which is a perfectly ordinary label genuinely about accessibility. That is the false
// alarm the 2026-08-15 pass correctly refused. The rule that works is narrower: a row belongs to the
// dimension whose keyword appears FIRST in its label, so "Accessibility review" is about
// accessibility and the word "review" in it is incidental.
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

// ---- C: evidence is TIED to a dimension --------------------------------------
//
// 2026-08-24: this case used to assert only that a collision was VISIBLE, because visibility was all
// that had shipped. The residual is now fixed — a row belongs to the dimension whose keyword appears
// FIRST in its label, and to that one only — so this asserts the tying itself, in both directions.
{
  // C1. Delete the dedicated review row and relabel Accessibility so its label also contains
  // "review". Nothing then has independent code review as its primary dimension, so it must BLOCK as
  // a missing dimension rather than being signed off by an accessibility row.
  const only = fixture((t) =>
    t
      .split('\n')
      .filter((l) => !/^\|\s*Independent code review\s*\|/.test(l))
      .map((l) =>
        /^\|\s*Accessibility\s*\|/.test(l)
          ? '| Accessibility review | pass | one row, one piece of evidence |'
          : l,
      )
      .join('\n'),
  );
  const v1 = verdict(only);
  if (v1.status !== 'BLOCKED') {
    note(
      `case C1: with "Accessibility review" the only row whose label contains "review", the verdict is ` +
        `${v1.status}. One row and one piece of evidence would be standing in for two dimensions, and ` +
        'independent code review would be signed off by an accessibility row — the mechanism behind X276',
    );
  } else if (
    !(v1.problems || []).some((p) => /missing required dimension: independent code review/i.test(p))
  ) {
    note(
      `case C1: it blocks, but not for the right reason — no problem says independent code review is ` +
        `missing: ${JSON.stringify(v1.problems || []).slice(0, 200)}`,
    );
  } else {
    console.log('  C1 a colliding label cannot cover two ....... BLOCKED, naming the missing one');
  }
  rmSync(only, { recursive: true, force: true });

  // C2. THE CONTROL THAT MATTERS. The same colliding label, but the dedicated review row is left in
  // place. This must be CLEAN: "Accessibility review" is genuinely about accessibility, and the word
  // "review" in it is incidental. A rule that blocked here would be the false alarm the 2026-08-15
  // pass correctly refused, and an earlier attempt at this fix did exactly that.
  const both = fixture((t) =>
    t
      .split('\n')
      .map((l) =>
        /^\|\s*Accessibility\s*\|/.test(l)
          ? '| Accessibility review | pass | genuinely an accessibility review |'
          : l,
      )
      .join('\n'),
  );
  const v2 = verdict(both);
  const sb = v2.satisfiedBy || {};
  if (v2.status !== 'clean') {
    note(
      `case C2: a colliding label ALONGSIDE a dedicated review row returned ${v2.status}. That is a ` +
        'false alarm on an ordinary label, which is worse than the residual being fixed: ' +
        JSON.stringify(v2.problems || []).slice(0, 200),
    );
  } else if (
    !(sb.review || []).some((r) => /^Independent code review$/i.test(r)) ||
    !(sb.accessibility || []).some((r) => /^Accessibility review$/i.test(r))
  ) {
    note(
      `case C2: clean, but the dimensions are not attributed to their own rows — review <- ` +
        `${JSON.stringify(sb.review)}, accessibility <- ${JSON.stringify(sb.accessibility)}`,
    );
  } else {
    console.log(
      '  C2 control: a colliding label beside its own  clean, each attributed separately',
    );
  }
  rmSync(both, { recursive: true, force: true });
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
  '\nPASS: every row belongs to one dimension and the gate reports which, so no dimension can be ' +
    'signed off by a row that is really about something else, and an ordinary label that merely ' +
    'mentions another dimension is not falsely blocked.',
);
