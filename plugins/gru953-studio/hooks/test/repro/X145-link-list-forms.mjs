#!/usr/bin/env node
//
// Reproduction for memory-integrity D3 (adjudicated 2026-08-15) — a graph link written in any
// list form but a bullet is skipped in silence, and its dangling reference goes unreported.
//
// THE DEFECT. LINK_RE requires a bullet marker:
//
//     ^\s*[-*]\s+(\S+)\s+(<vocabulary>)\s+(\S+)
//
// So a link written as a numbered list item — `1. T1 depends-on R99` — or as a table row —
// `| T1 | depends-on | R99 |` — matches nothing, is never validated, and a reference to a node
// that does not exist passes as "internally consistent". Both are ordinary markdown a person
// would write without a second thought.
//
// WHY WIDENING IS SAFE HERE, WHICH IT WOULD NOT HAVE BEEN BEFORE 2026-07-21.
// This pattern used to accept any lowercase word as the link type, and a prose bullet under
// `## Links` — "All links use verbs like implements and blocks" — was parsed as a link, its
// words reported as undefined nodes. That was fixed by constraining the middle token to the
// documented vocabulary (implements, depends-on, relates-to, supersedes, caused-by, blocks).
//
// That constraint is what makes this widening safe: prose does not have a vocabulary word in
// exactly the second position. Control D holds that same prose sentence, now numbered, so the
// protection is proven rather than assumed.
//
//   case                                                      required
//   A  a dangling link as a BULLET                             BLOCKED (control: it works)
//   B  the same link as a NUMBERED item                        BLOCKED <- D3
//   C  the same link as a TABLE row                            BLOCKED <- D3
//   D  numbered PROSE that mentions link verbs                 clean   (control: no false alarm)
//   E  a healthy numbered link                                 clean   (control)
//
// Usage:
//   node X145-link-list-forms.mjs                # asserts the FIXED state
//   node X145-link-list-forms.mjs --expect-bug   # asserts the DEFECT is present

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

const INDEX = '# Index\n\n| What | Where |\n| :-- | :-- |\n| graph | GRAPH.md |\n';
const NODES = '# Graph\n\n## Nodes\n- [T1] task: a\n- [R1] requirement: b\n\n## Links\n';

function verdict(linksBody) {
  const dir = mkdtempSync(join(tmpdir(), 'x145-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'INDEX.md'), INDEX);
    writeFileSync(join(dir, 'Dev-Memory', 'GRAPH.md'), NODES + linksBody);
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'memory-integrity.mjs'), [dir]), 'X145-link-list-forms.mjs', die);
    return { status: v.status, problems: v.problems, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = verdict('- T1 depends-on R99\n');
if (A.status === 'clean') die('control A failed: a dangling link as a bullet must be caught — the gate is not working at all.');
console.log('  A  dangling link, BULLET ........................ BLOCKED (control)');

const B = verdict('1. T1 depends-on R99\n');
const bCaught = B.status !== 'clean';
console.log(`  B  the same link, NUMBERED ...................... ${bCaught ? 'BLOCKED' : 'clean  '}${bCaught ? '' : '  <- D3'}`);

const C = verdict('| T1 | depends-on | R99 |\n');
const cCaught = C.status !== 'clean';
console.log(`  C  the same link, TABLE ROW ..................... ${cCaught ? 'BLOCKED' : 'clean  '}${cCaught ? '' : '  <- D3'}`);

// ---- Control D: the prose that caused a spurious block in July ----------------
const D = verdict('1. All links use verbs like implements and blocks, see the skill.\n');
if (D.status !== 'clean') {
  die(
    'control D failed: numbered PROSE mentioning link verbs was parsed as a link. A fix of ' +
      '2026-07-21 constrained the type token to the documented vocabulary for exactly this ' +
      `reason, and widening the list marker must not defeat it: ${D.problems[0] || ''}`,
  );
}
console.log('  D  numbered PROSE mentioning link verbs ......... clean   (control)');

const E = verdict('1. T1 implements R1\n');
if (E.status !== 'clean') die(`control E failed: a healthy numbered link must pass, got ${E.status}: ${E.problems[0] || ''}`);
console.log('  E  a healthy numbered link ...................... clean   (control)');

const open = [];
if (!bCaught) open.push('numbered');
if (!cCaught) open.push('table row');

if (expectBug) {
  if (open.length === 0) die('expected the D3 defect and found none. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nD3 REPRODUCED: link forms skipped in silence — ${open.join(', ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: a link is validated however its list is written, and prose is still left alone.');
  process.exit(0);
}

die(
  `D3 is OPEN — the ${open.join(' and ')} form(s) are skipped. LINK_RE requires a bullet marker, ` +
    'so an ordinary numbered list or table renders the same to a reader and is invisible to the ' +
    'gate. Fix: accept the other list forms; the documented-vocabulary constraint on the type ' +
    'token is what keeps prose out.',
);
