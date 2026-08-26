#!/usr/bin/env node
//
// Reproduction for X86 (High) — the memory gate reports "clean" about recall it never measured,
// and a file that exists but is not indexed is invisible to recall with nothing saying so.
//
// MEASURED ON THIS PROJECT'S OWN MEMORY, at the parent commit:
//
//     graph nodes            31
//     tasks in the graph     13 / 29   (45%)
//     requirements           13 / 25   (52%)
//     lessons                 1 / 11   ( 9%)
//     files not in INDEX.md   7
//
//     memory-integrity says: {"status":"clean","reason":"recall index and knowledge graph are
//                             internally consistent"}
//
// That sentence is TRUE and it is the problem. The gate checks referential integrity — every link
// points at a node that exists — and nothing else. It never asks whether the graph covers the
// work, so recall degrades silently while the verdict reads as assurance. The `memory-graph`
// skill's own promise is that it "recalls only what the current task needs"; with 9% of lessons
// in the graph, what it needs is mostly not there.
//
// TWO DIFFERENT DEFECTS, and they need different answers.
//
// COVERAGE is a judgement, not a rule. No honest threshold exists: 45% may be right for a project
// that graphs only its live work, and wrong for one that graphs everything. A gate that blocks at
// some invented number would fail every project on day one and be switched off (L5). So coverage
// is DISCLOSED in the verdict, exactly as X195 made content-check admit what it had not verified.
// "Clean" stops implying coverage because the numbers are printed beside it.
//
// AN UNINDEXED FILE is a rule, and it can be checked. `INDEX.md` is the recall index by design —
// the `dev-memory` skill has a session read it first — so a memory file absent from it cannot be
// recalled at all. That is not a statistic; it is a file the product cannot see. It BLOCKS.
//
//   case                                                      required
//   A  a healthy memory, fully indexed                         clean, coverage REPORTED
//   B  the same, but the verdict must carry the numbers         coverage fields present  <- X86
//   C  a memory file that INDEX.md does not name                BLOCKED                  <- X86
//   D  a dangling graph link (the check that already worked)     BLOCKED (control)
//   E  low coverage on its own                                  clean   (control: never blocks)
//
// Control E is the line this must not cross. Coverage is reported, never enforced; a project with
// a sparse graph is making a choice, not committing a defect.
//
// Usage:
//   node X86-recall-coverage.mjs                # asserts the FIXED state
//   node X86-recall-coverage.mjs --expect-bug   # asserts the DEFECT is present

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

const INDEX_FULL = [
  '# Index',
  '',
  '| What | Where |',
  '| :-- | :-- |',
  '| the graph | GRAPH.md |',
  '| tasks | PROGRESS.md |',
  '| requirements | REQUIREMENTS.md |',
  '',
].join('\n');

const GRAPH = (links) =>
  ['# Graph', '', '## Nodes', '', '- [T1] task: a', '- [R1] requirement: b', '', '## Links', '', links, ''].join('\n');

const PROGRESS = (ids) =>
  ['# Progress', '', '| ID | Task | Status | Notes |', '| :-- | :-- | :-- | :-- |',
    ...ids.map((i) => `| ${i} | work ${i} | todo | not started |`), ''].join('\n');

const REQUIREMENTS = (ids) =>
  ['# Requirements', '', '| ID | Requirement | Tasks | Verification | Status |',
    '| :-- | :-- | :-- | :-- | :-- |',
    ...ids.map((i) => `| ${i} | need ${i} | T1 | T1 | todo |`), ''].join('\n');

/** Build a Dev-Memory and read the gate's verdict. */
function verdict(files) {
  const dir = mkdtempSync(join(tmpdir(), 'x86-'));
  try {
    const dm = join(dir, 'Dev-Memory');
    mkdirSync(dm, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dm, name), body);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X86', die);
    return v;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEALTHY = {
  'INDEX.md': INDEX_FULL,
  'GRAPH.md': GRAPH('- T1 implements R1'),
  'PROGRESS.md': PROGRESS(['T1']),
  'REQUIREMENTS.md': REQUIREMENTS(['R1']),
};

// ---- A: a healthy memory stays clean ------------------------------------------
const A = verdict(HEALTHY);
if (A.kind !== 'clean') die(`control A failed: a healthy, fully-indexed memory must be clean, got ${A.status}: ${(A.problems || [])[0] || ''}`);
console.log('  A  a healthy, fully-indexed memory .............. clean   (control)');

// ---- B: X86 — the verdict must carry coverage ----------------------------------
const hasCoverage =
  A.json && (A.json.recallCoverage !== undefined || A.json.coverage !== undefined);
console.log(`  B  the clean verdict reports coverage .......... ${hasCoverage ? 'yes' : 'NO     '}${hasCoverage ? '' : '  <- X86'}`);

// ---- C: X86 — a file INDEX.md does not name ------------------------------------
const C = verdict({ ...HEALTHY, 'LESSONS.md': '# Lessons\n\n## L1\n\nsomething learned.\n' });
const cCaught = C.kind !== 'clean';
console.log(`  C  a memory file INDEX.md does not name ........ ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- X86'}`);

// ---- D: the referential check that already worked ------------------------------
const D = verdict({ ...HEALTHY, 'GRAPH.md': GRAPH('- T1 depends-on R404') });
if (D.kind === 'clean') die('control D failed: a dangling graph link must still be caught — the check that already worked must not be lost.');
console.log('  D  a dangling graph link ....................... BLOCKED (control)');

// ---- E: low coverage alone must NEVER block ------------------------------------
const E = verdict({
  ...HEALTHY,
  'PROGRESS.md': PROGRESS(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']),
});
if (E.kind !== 'clean') {
  die(
    'control E failed: a memory with only 1 of 10 tasks in the graph was BLOCKED. Coverage is a ' +
      'judgement, not a rule — no honest threshold exists, and a gate that blocks at an invented ' +
      `number would fail every project on day one and be switched off (L5): ${(E.problems || [])[0] || ''}`,
  );
}
console.log('  E  1 of 10 tasks in the graph .................. clean   (control: reported, never enforced)');

const open = [];
if (!hasCoverage) open.push('coverage is not reported');
if (!cCaught) open.push('an unindexed file is not caught');

if (expectBug) {
  if (open.length === 0) die('expected the X86 defects and found none. If they were fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nX86 REPRODUCED: ${open.join('; ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: the verdict reports what recall actually covers, and a file it cannot see is reported.');
  process.exit(0);
}

die(
  `X86 is OPEN — ${open.join('; ')}. The gate checks referential integrity and nothing else, so ` +
    '"internally consistent" is true while recall quietly degrades, and a memory file absent from ' +
    'INDEX.md cannot be recalled at all with nothing saying so.',
);
