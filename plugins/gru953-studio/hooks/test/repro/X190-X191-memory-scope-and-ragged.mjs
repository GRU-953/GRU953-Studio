#!/usr/bin/env node
//
// Reproduction for X190 and X191 (both High, P6 convergence round 2) — two silent skips in
// memory-integrity.mjs, one in the graph pass and one in the index pass.
//
// ---------------------------------------------------------------------------------------
// X190 — a section ends early, so part of the graph is never checked.
//
// sectionScope() decides which lines belong to "## Links" (and, separately, "## Nodes"):
//
//     if (opensRe.test(heading[2])) { open = true; level = depth; }
//     else if (open && depth <= level) { open = false; }
//
// The first branch overwrites `level` UNCONDITIONALLY. So a DEEPER sub-heading that happens to
// contain the section word — `### Implementation links` under `## Links` — becomes the new
// boundary at depth 3. The very next sibling sub-heading, `### Dependencies`, is depth 3 and
// does not match, so `depth <= level` closes the section that `## Links` opened. Everything
// after it is no longer "in the links section" and is never validated.
//
// The trigger is MIXED naming: one sub-heading named after the section, the next not. Uniform
// naming is safe in both directions, and controls C and D hold that — this was measured, and
// it makes the finding narrower than "grouping a link list breaks it".
//
// ---------------------------------------------------------------------------------------
// X191 — an index row missing a cell is skipped in silence.
//
// The staleness loop reads `row.cells[whereCol]` with no test of `row.ragged`. A row one cell
// short shifts every value left, so the Where cell is either another column's text or
// undefined; `where` comes out empty or unrecognisable and `continue` skips it without a word.
// The gate then reports the index internally consistent.
//
// This is the same shape traceability-check.mjs already reports for its own tables — the
// wording below is deliberately parallel to it.
//
//   case                                                          required
//   A  a dangling link, no sub-headings                            BLOCKED (control: it works)
//   B  the same link under "### Implementation links" then
//      a sibling "### Dependencies"                                BLOCKED <- X190
//   C  the same file with the sub-heading renamed "### Implementation"
//                                                                  BLOCKED (control: uniform
//                                                                           naming already works)
//   D  both sub-headings named after the section                   BLOCKED (control)
//   E  the same grouped shape, every target defined                clean   (control: no false alarm)
//   F  a healthy graph with NO sub-headings                        clean   (control)
//   G  an index row naming a missing file                          BLOCKED (control: it works)
//   H  the same row, one cell short                                BLOCKED <- X191
//   I  a healthy index                                             clean   (control)
//   J  the project's own golden fixture                            clean   (control: no false
//                                                                           alarm on real data)
//
// Usage:
//   node X190-X191-memory-scope-and-ragged.mjs                # asserts the FIXED state
//   node X190-X191-memory-scope-and-ragged.mjs --expect-bug   # asserts the DEFECTS are present

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const GOLDEN = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const INDEX_OK = '# Index\n\n| What | Where |\n| :-- | :-- |\n| the graph | GRAPH.md |\n';
const NODES = [
  '# Booking app memory',
  '',
  '## Nodes',
  '',
  '- [R1] requirement: the app emails a booking confirmation',
  '- [T1] task: build the confirmation email',
  '- [T2] task: add the offline queue',
  '',
].join('\n');

/** A project whose GRAPH.md carries `linksBody` under a "## Links" heading. */
function graphVerdict(linksBody) {
  const dir = mkdtempSync(join(tmpdir(), 'x190-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'INDEX.md'), INDEX_OK);
    writeFileSync(join(dir, 'Dev-Memory', 'GRAPH.md'), `${NODES}## Links\n\n${linksBody}`);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X190', die);
    return { status: v.status, problems: v.problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A project whose INDEX.md carries `rows` beneath a two-column header. */
function indexVerdict(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'x191-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'INDEX.md'), `# Index\n\n| What | Where |\n| :-- | :-- |\n${rows}`);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X191', die);
    return { status: v.status, problems: v.problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DANGLING = '- T2 depends-on R404\n';
const HEALTHY = '- T1 implements R1\n';

// ---- A: the check demonstrably works -----------------------------------------
const A = graphVerdict(DANGLING);
if (A.status === 'clean') die('control A failed: a dangling link with no sub-headings must be caught — the check is not working at all.');
console.log('  A  a dangling link, no sub-headings ............. BLOCKED (control)');

// ---- B: X190 ------------------------------------------------------------------
const B = graphVerdict(`### Implementation links\n\n${HEALTHY}\n### Dependencies\n\n${DANGLING}`);
const bCaught = B.status !== 'clean';
console.log(`  B  the same link, mixed sub-heading naming ...... ${bCaught ? 'BLOCKED' : 'clean  '}${bCaught ? '' : '  <- X190'}`);

// ---- C, D: uniform naming already works, in both directions -------------------
const C = graphVerdict(`### Implementation\n\n${HEALTHY}\n### Dependencies\n\n${DANGLING}`);
if (C.status === 'clean') {
  die('control C failed: with NO sub-heading naming the section, the dangling link must still be caught. This case works at HEAD, so a fix that breaks it has made things worse.');
}
console.log('  C  neither sub-heading names the section ....... BLOCKED (control)');

const D = graphVerdict(`### Implementation links\n\n${HEALTHY}\n### Dependency links\n\n${DANGLING}`);
if (D.status === 'clean') die('control D failed: with BOTH sub-headings naming the section, the dangling link must still be caught.');
console.log('  D  both sub-headings name the section .......... BLOCKED (control)');

// ---- E, F: no false alarm on a healthy graph ---------------------------------
const E = graphVerdict(`### Implementation links\n\n${HEALTHY}\n### Dependencies\n\n- T2 depends-on R1\n`);
if (E.status !== 'clean') {
  die(`control E failed: the same grouped shape with every target DEFINED must pass — recognising the section must not mean flagging it: ${E.problems[0] || ''}`);
}
console.log('  E  the same shape, every target defined ........ clean   (control)');

const F = graphVerdict(HEALTHY);
if (F.status !== 'clean') die(`control F failed: a healthy flat graph must pass, got ${F.status}: ${F.problems[0] || ''}`);
console.log('  F  a healthy graph, no sub-headings ............ clean   (control)');

// ---- G: the index check demonstrably works -----------------------------------
const G = indexVerdict('| a thing | NOPE-DOES-NOT-EXIST.md |\n');
if (G.status === 'clean') die('control G failed: an index row naming a missing file must be caught — the check is not working at all.');
console.log('  G  an index row naming a missing file .......... BLOCKED (control)');

// ---- H: X191 -----------------------------------------------------------------
const H = indexVerdict('| NOPE-DOES-NOT-EXIST.md |\n');
const hCaught = H.status !== 'clean';
console.log(`  H  the same row, one cell short ................ ${hCaught ? 'BLOCKED' : 'clean  '}${hCaught ? '' : '  <- X191'}`);

// ---- I: a healthy index must not be flagged ----------------------------------
const I = indexVerdict('| the index | INDEX.md |\n');
if (I.status !== 'clean') die(`control I failed: a healthy index row must pass, got ${I.status}: ${I.problems[0] || ''}`);
console.log('  I  a healthy index row ......................... clean   (control)');

// ---- J: the project's own golden fixture must stay clean ---------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x191g-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    cpSync(GOLDEN, join(dir, 'Dev-Memory'), { recursive: true });
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X191-golden', die);
    if (v.status !== 'clean') {
      die(
        'control J failed: the project\'s OWN golden fixture — the negative control the gate suite ' +
          `runs — stopped passing. A ragged-row check that fires on real data is a false alarm, not a fix: ${(v.problems || [])[0] || ''}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log('  J  the golden fixture .......................... clean   (control)');

const open = [];
if (!bCaught) open.push('X190 (a section ends early at a mixed sub-heading)');
if (!hCaught) open.push('X191 (an index row missing a cell is skipped)');

if (expectBug) {
  if (open.length === 0) die('expected these defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nREPRODUCED: ${open.join(', ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: a sub-heading no longer ends its parent section, and a row that cannot be read is reported rather than skipped.');
  process.exit(0);
}

die(
  `OPEN — ${open.join('; ')}. sectionScope() overwrites the section's level with any matching ` +
    "heading's depth, so a deeper sub-heading becomes the boundary and its first sibling closes " +
    'the parent; and the index staleness loop never tests row.ragged, so a short row is read from ' +
    'the wrong column and skipped in silence.',
);
