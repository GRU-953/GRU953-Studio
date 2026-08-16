#!/usr/bin/env node
//
// Reproduction for X194 (High, P6 convergence round 2) — ordinary English sentences in
// PROGRESS.md are reported as unverifiable "done" claims, and the gate blocks.
//
// THE DEFECT. verify-progress.mjs sweeps every line outside a recognised table for a done
// claim that no table can verify:
//
//     if (l.split(/[|:—-]/).some((seg) => isDoneValue(seg.trim()))) claims.push(l);
//
// `isDoneValue` is PREFIX-anchored — `/^(done|completed?|finished|shipped|delivered)\b/i` —
// because it was written to read a STATUS CELL, where the whole cell is the value. Pointed at
// prose it says yes to any sentence, or any colon/dash-separated fragment of one, that merely
// BEGINS with a completion word. Measured at the parent commit, on the golden fixture:
//
//     "Shipped items are listed in the release notes."   -> BLOCKED
//     "Completed work: see the table."                   -> BLOCKED
//     "Done deals are recorded elsewhere."               -> BLOCKED
//     "Finished reading the spec - notes below."         -> BLOCKED
//     "Delivered to staging on Tuesday."                 -> BLOCKED
//
// These are sentences a person writes in a progress file without a second thought, and the
// gate refuses the phase checkpoint over them.
//
// THE FIX, AND THE LINE IT MUST NOT CROSS. The sweep exists for a real reason, and finding F9
// on 2026-08-13 already had to repair it once: a done claim written outside any table cannot
// be verified by any table, and must be reported. So this cannot be softened into silence.
//
// The discriminator is that a STATUS is the whole value, whereas prose merely starts with the
// word. `T5: done` has a segment that IS "done"; "Delivered to staging on Tuesday." has no
// segment that is anything but a sentence. The prose sweep therefore requires the segment to
// BE a completion value — trailing punctuation allowed — rather than to begin with one. The
// status-cell reading is untouched: widening it was X139, and narrowing it here would undo
// that fix in the place it was actually needed.
//
//   case                                                         required
//   A  the golden fixture, untouched                              clean   (control)
//   B  "- T9 — done" outside any table                            BLOCKED (control: the sweep
//                                                                          must still work)
//   C  "T9: done" outside any table                               BLOCKED (control)
//   D  "- T9 — shipped" (an X139 synonym)                         BLOCKED (control: X139 holds)
//   E  five ordinary sentences beginning with a done word         clean   <- X194
//   F  a table row whose Status cell reads "shipped"              clean   (control: X139's
//                                                                          real target still
//                                                                          reads as done)
//
// Case F is the one that stops this fix from quietly reverting X139. If narrowing the prose
// sweep also narrowed the status-cell reading, a row marked "shipped" would stop counting as
// done and the evidence requirement would silently lapse.
//
// Usage:
//   node X194-done-claim-prose.mjs                # asserts the FIXED state
//   node X194-done-claim-prose.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
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

function verdict(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x194-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    cpSync(GOLDEN, join(dir, 'Dev-Memory'), { recursive: true });
    if (mutate) mutate(join(dir, 'Dev-Memory'));
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'verify-progress.mjs'), [dir]), 'X194', die);
    // Collect every array field the gate emits rather than naming one. This sweep reports
    // under `unverifiableTables`, and the first version of this reproduction read `problems`
    // and `unidentified` — so control B failed, correctly, on a harness that was looking in
    // the wrong place. Reading them all removes a whole class of that mistake.
    const all = Object.values(v.json || {}).flatMap((x) => (Array.isArray(x) ? x : []));
    return { status: v.status, messages: all };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SWEEP_SAYS = 'outside any recognised task table';
const append = (text) => (dm) => appendFileSync(join(dm, 'PROGRESS.md'), `\n${text}\n`);
const swept = (v) => v.messages.some((m) => String(m).includes(SWEEP_SAYS));

// ---- A: baseline ---------------------------------------------------------------
const A = verdict(null);
if (A.status !== 'clean') die(`control A failed: the golden fixture must be clean at baseline, got ${A.status}: ${A.messages[0] || ''}`);
console.log('  A  the golden fixture, untouched ............... clean   (control)');

// ---- B, C, D: the sweep must keep doing its job --------------------------------
for (const [id, line, why] of [
  ['B', '- T9 — done', 'a bullet claiming done, outside any table'],
  ['C', 'T9: done', 'a colon-separated claim'],
  ['D', '- T9 — shipped', 'an X139 synonym'],
]) {
  const v = verdict(append(line));
  if (!swept(v)) {
    die(
      `control ${id} failed: "${line}" is ${why} and must still be reported — finding F9 of ` +
        '2026-08-13 already had to repair this sweep once, and a fix that silences it would ' +
        `reopen that: ${v.messages[0] || '(nothing said)'}`,
    );
  }
  console.log(`  ${id}  ${line.padEnd(16)} ............... BLOCKED (control)`);
}

// ---- E: X194 --------------------------------------------------------------------
const PROSE = [
  'Shipped items are listed in the release notes.',
  'Completed work: see the table.',
  'Done deals are recorded elsewhere.',
  'Finished reading the spec - notes below.',
  'Delivered to staging on Tuesday.',
];
const falseAlarms = [];
for (const line of PROSE) {
  if (swept(verdict(append(line)))) falseAlarms.push(line);
}
console.log(
  `  E  ${PROSE.length} ordinary sentences .................... ${falseAlarms.length ? `${falseAlarms.length} FLAGGED` : 'clean  '}${falseAlarms.length ? '  <- X194' : ''}`,
);
for (const f of falseAlarms) console.log(`         flagged: "${f}"`);

// ---- F: X139's real target must still read as done ------------------------------
{
  const F = verdict((dm) => {
    const p = join(dm, 'PROGRESS.md');
    const src = readFileSync(p, 'utf8');
    // Flip an existing evidenced row's status word to an X139 synonym. If "shipped" stopped
    // counting as done, the row would no longer need evidence and this file would go quiet in
    // a way that looks like success.
    writeFileSync(p, src.replace(/\|\s*done\s*\|/i, '| shipped |'));
  });
  if (F.status !== 'clean') {
    die(
      'control F failed: an evidenced row whose Status cell reads "shipped" must still be clean. ' +
        `X139 widened the status reading deliberately, and narrowing it here would undo that: ${F.messages[0] || ''}`,
    );
  }
  console.log('  F  a Status cell reading "shipped" ............. clean   (control: X139 holds)');
}

if (expectBug) {
  if (falseAlarms.length === 0) die('expected the X194 false alarms and found none. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nX194 REPRODUCED: ${falseAlarms.length} ordinary sentence(s) reported as unverifiable done claims.`);
  process.exit(0);
}

if (falseAlarms.length === 0) {
  console.log('\nPASS: a done claim outside a table is still reported; an English sentence that merely begins with a completion word is not.');
  process.exit(0);
}

die(
  `X194 is OPEN: ${falseAlarms.length} ordinary sentence(s) were reported as done claims. The ` +
    'prose sweep uses isDoneValue, which is prefix-anchored because it was written to read a ' +
    'STATUS CELL, where the whole cell is the value. Fix: in the prose sweep require the segment ' +
    'to BE a completion value rather than to begin with one, and leave the status-cell reading alone.',
);
