#!/usr/bin/env node
//
// Reproduction for memory-integrity D1 and D2 (adjudicated 2026-08-15) — a graph section
// stops being checked, silently, on input that is entirely reasonable.
//
// D2 (High) is the worse of the two, and the verifier could not fault it on any angle.
// Both passes over GRAPH.md scope themselves like this:
//
//     const heading = line.match(/^#{1,6}\s+(.*)$/);
//     if (heading) { inLinks = /link|edge/i.test(heading[1]); continue; }
//
// The match is LEVEL-AGNOSTIC and the flag is reassigned on every heading. So a `### Phase 2`
// sub-heading INSIDE a correct `## Links` section switches link checking off for the rest of
// the file. The gate parses and resolves a real link in that very section — it demonstrably
// believes it has read the file — and then goes silent about everything beneath.
//
// Nothing about that input looks wrong. The documented parent heading is present and
// correct, and grouping a growing link list by phase or milestone is ordinary maintenance on
// exactly the file this plugin tells projects to keep growing.
//
// D1 (Medium) is the same shape one step out: the section is recognised only by the words
// "link" or "edge", so a list under `## Relationships` — the word the design's own prose uses
// ("their relationships as typed links") — is never checked at all.
//
// THE FIX IS MARKDOWN'S OWN NESTING RULE. A section ends at the next heading of the SAME or
// SHALLOWER level. A deeper heading is a sub-heading, and sub-headings belong to the section
// they sit inside. That is how every reader of markdown already understands the document.
//
// The synonym half is ADDITIVE ONLY — new words are accepted, no currently-recognised
// heading stops being recognised. A narrowing change here would turn files that are checked
// today into files that are not, which is the very defect being fixed. (In particular the
// existing quirk that "Knowledge" contains "edge", so `## Knowledge graph` enables link
// parsing, is left exactly as it is. Tightening it would be a regression in the direction
// that matters.)
//
//   case                                                        required
//   A  a dangling link under "## Links"                          BLOCKED (control: it works)
//   B  a healthy graph                                           clean   (control)
//   C  a dangling link under "### Phase 2" inside "## Links"      BLOCKED <- D2
//   D  a dangling link under "## Relationships"                   BLOCKED <- D1
//   E  a dangling link after "## Links" then a SIBLING "## Notes" clean   (control: the section really ended)
//
// Control E is what stops the fix going too far: a section must still END. If a sub-heading
// no longer closes a section, a SIBLING heading must — otherwise "## Links" would swallow the
// remainder of the file and prose under a later heading would be parsed as links.
//
// Usage:
//   node X140-section-scope.mjs                # asserts the FIXED state
//   node X140-section-scope.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const INDEX = '# Index\n\n| What | Where |\n| :-- | :-- |\n| the graph | GRAPH.md |\n';

/** Run memory-integrity over a GRAPH.md and return its verdict. */
function verdict(graph) {
  const dir = mkdtempSync(join(tmpdir(), 'x140-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'INDEX.md'), INDEX);
    writeFileSync(join(dir, 'Dev-Memory', 'GRAPH.md'), graph);
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X140-section-scope.mjs', die);
    return { status: v.status, problems: v.problems, code: v.code, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NODES = '# Graph\n\n## Nodes\n- [T1] task: build the thing\n- [R1] requirement: the thing exists\n';
const DANGLING = '- T1 depends-on R99\n'; // R99 is defined nowhere

// ---- Controls ----------------------------------------------------------------
const A = verdict(NODES + '\n## Links\n' + DANGLING);
if (A.status === 'clean') die('control A failed: a dangling link directly under "## Links" must be caught — the gate is not working at all.');
console.log('  A  dangling link under "## Links" ............... BLOCKED (control)');

const B = verdict(NODES + '\n## Links\n- T1 implements R1\n');
if (B.status !== 'clean') die(`control B failed: a healthy graph must pass, got ${B.status}: ${B.problems[0] || ''}`);
console.log('  B  a healthy graph .............................. clean   (control)');

// ---- The two defects ---------------------------------------------------------
const C = verdict(NODES + '\n## Links\n- T1 implements R1\n\n### Phase 2\n' + DANGLING);
const cCaught = C.status !== 'clean';
console.log(`  C  dangling under "### Phase 2" in "## Links" ... ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- D2'}`);

const D = verdict(NODES + '\n## Relationships\n' + DANGLING);
const dCaught = D.status !== 'clean';
console.log(`  D  dangling under "## Relationships" ............ ${dCaught ? 'BLOCKED' : 'clean  '}${dCaught ? '' : '  <- D1'}`);

// ---- Control E: a sibling heading must still END the section ------------------
// Prose under a later top-level heading must not be parsed as links, or the fix would
// trade a silent skip for a false alarm.
const E = verdict(
  NODES + '\n## Links\n- T1 implements R1\n\n## Notes\n- T1 depends-on R99 is what we should add next\n',
);
if (E.status !== 'clean') {
  die(
    'control E failed: a SIBLING heading must still end the Links section. Prose under "## Notes" ' +
      `was parsed as a link, which is a false alarm: ${E.problems[0] || ''}`,
  );
}
console.log('  E  sibling "## Notes" ends the section .......... clean   (control)');

const open = [];
if (!cCaught) open.push('D2 (a sub-heading silently closes the section)');
if (!dCaught) open.push('D1 (a synonym heading is never opened)');

if (expectBug) {
  if (open.length === 0) die('expected the section-scope defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nREPRODUCED: ${open.join(' and ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: a section runs to its next sibling heading, sub-headings stay inside it, and the words for it are recognised.');
  process.exit(0);
}

die(
  `OPEN — ${open.join(' and ')}. Both passes reassign their section flag on EVERY heading ` +
    'regardless of depth, so a sub-heading inside a section silently closes it. ' +
    "Fix: end a section at the next heading of the same or shallower level, and accept the " +
    'ordinary synonyms for it — additively, so nothing recognised today stops being recognised.',
);
