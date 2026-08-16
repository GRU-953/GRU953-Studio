#!/usr/bin/env node
//
// Reproduction for the verify-progress D1 finding (High, adjudicated 2026-08-15) — a task
// marked finished in any word other than the literal "done" is skipped in total silence.
//
// THE DEFECT. The gate exists to prove that a task claimed as complete carries real
// evidence. It recognises completion with one prefix-anchored test:
//
//     /^done\b/i    (after de-emphasis and stripping leading decoration)
//
// So a row marked `Complete`, `Completed`, `Shipped`, `Finished` or `✅` is not a done row,
// is never evidence-checked, and contributes nothing to the verdict. The gate then reports
// clean about a project whose tasks claim completion with no proof at all.
//
// This is a FALSE CLEAN, not a fail-closed: the identical row marked `done` blocks.
//
// WHAT IS DELIBERATELY NOT ACCEPTED, and why the list is short.
//
//   "closed"     — ambiguous. A task closed as won't-do is not a task completed, and
//                  demanding evidence for it would be a false alarm.
//   translations — the sweep suggested "Terminé". Guessing at which languages and which
//                  words would be inventing a vocabulary nobody agreed, and a wrong guess
//                  here blocks a healthy project. If a project needs one, it is a decision
//                  to record, not a synonym to assume.
//   typos        — "doen" was suggested. Accepting typos means accepting anything close to
//                  a word, which is how a recogniser stops being predictable.
//
// Widening this recogniser makes MORE rows evidence-checked, never fewer, so the risk is a
// false alarm rather than a miss. That is why every accepted word is one that unambiguously
// means finished, and every doubtful one is left out.
//
//   case                                                   required
//   A  "done" with real evidence                            clean   (control)
//   B  "done" with placeholder evidence                     BLOCKED (control: the gate works)
//   C  "completed" / "complete" / "finished" / "shipped"
//      / "delivered" / "✅" — all with placeholder evidence  BLOCKED <- D1
//   D  "not done", "in progress", "undone", "incomplete"
//      — with placeholder evidence                          clean   (control: still not done)
//
// Control D is the one that stops this becoming a false-alarm generator: a task that is NOT
// finished must not be asked for proof that it was.
//
// Usage:
//   node X139-completion-synonyms.mjs                # asserts the FIXED state
//   node X139-completion-synonyms.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** A one-task PROGRESS.md with the given status and evidence, run through the gate. */
function verdict(status, evidence) {
  const dir = mkdtempSync(join(tmpdir(), 'x139-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(
      join(dir, 'Dev-Memory', 'PROGRESS.md'),
      '# Progress\n\n| ID | Task | Status | Evidence |\n| :-- | :-- | :-- | :-- |\n' +
        `| T1 | Build the login screen | ${status} | ${evidence} |\n`,
    );
    const r = spawnSync(process.execPath, [join(HOOKS, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    try {
      return { status: JSON.parse(out).status, code: r.status };
    } catch {
      return { status: 'unparsed', code: r.status, raw: out.slice(0, 200) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Real evidence must carry a RE-RUNNABLE command, not a description of one. The first
// version of this fixture used the prose "verified: npm test -> 12 passing", and control A
// rejected it — correctly. The gate requires a backticked command so a reader can run it,
// which is the same discipline this whole programme holds its own claims to.
const REAL = 'verified: `npm test -- login.test.js` -> exit 0 (2026-08-15)';
const PLACEHOLDER = 'tbd';

// ---- Controls: the gate demonstrably works on the word it knows ---------------
const A = verdict('done', REAL);
if (A.status !== 'clean') die(`control A failed: a done task WITH real evidence must pass, got ${A.status}`);
console.log('  A  "done" + real evidence ...................... clean   (control)');

const B = verdict('done', PLACEHOLDER);
if (B.status === 'clean') die('control B failed: a done task with placeholder evidence must be caught — the gate is not working at all.');
console.log('  B  "done" + placeholder ....................... BLOCKED (control)');

// ---- The defect: every other word for finished -------------------------------
const SYNONYMS = ['completed', 'complete', 'finished', 'shipped', 'delivered', '✅'];
const missed = [];
for (const s of SYNONYMS) {
  const v = verdict(s, PLACEHOLDER);
  const caught = v.status !== 'clean';
  console.log(`  C  "${s}" + placeholder ${'.'.repeat(Math.max(2, 26 - s.length))} ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- D1'}`);
  if (!caught) missed.push(s);
}

// ---- Control D: a task that is NOT finished must not be asked for proof -------
const NOT_DONE = ['not done', 'in progress', 'undone', 'incomplete', 'doing'];
for (const s of NOT_DONE) {
  const v = verdict(s, PLACEHOLDER);
  if (v.status !== 'clean') {
    die(
      `control D failed: "${s}" was treated as a completion claim and demanded evidence. That is a ` +
        `false alarm — an unfinished task has nothing to prove yet. Got ${v.status}.`,
    );
  }
}
console.log(`  D  ${NOT_DONE.length} unfinished statuses ....................... clean   (control)`);

if (expectBug) {
  if (missed.length === 0) die('expected the D1 defect and found none. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nD1 REPRODUCED: ${missed.length} completion words skipped in silence — ${missed.join(', ')}.`);
  process.exit(0);
}

if (missed.length === 0) {
  console.log('\nPASS: every unambiguous completion word is evidence-checked, and unfinished tasks are still left alone.');
  process.exit(0);
}

die(
  `OPEN — ${missed.join(', ')} claim completion and are never evidence-checked. The recogniser is ` +
    '/^done\\b/i and nothing else, so the gate reports clean about a project whose tasks claim to ' +
    'be finished with no proof. Fix: accept the unambiguous synonyms, and keep the prefix anchor ' +
    'so "not done" and "incomplete" stay excluded.',
);
