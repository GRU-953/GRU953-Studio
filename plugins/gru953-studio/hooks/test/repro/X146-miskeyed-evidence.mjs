#!/usr/bin/env node
//
// Reproduction for verify-progress D3 (High, adjudicated 2026-08-15) — a recorded FAILURE is
// discarded in silence when its evidence object spells the task key differently.
//
// THE DEFECT. A row may carry several structured evidence objects, and a 2026-08 fix made the
// gate evaluate EVERY one, so a stale passing object cannot mask a later failing one. But an
// object only counts as evidence if it carries the key spelled exactly `taskId`:
//
//     .filter((o) => o && typeof o === 'object' && !Array.isArray(o) && 'taskId' in o)
//
// So a second object recording `"exitCode": 1` — keyed `taskID`, `task_id`, `taskid` or
// `TaskId` — is not evidence, is never examined, and the row passes on the strength of the
// first object alone. The gate reports clean about a task whose own record says it failed.
//
// That is the very defect the 2026-08 fix closed, reopened through a spelling.
//
// THE LINE THIS FIX MUST NOT CROSS. An arbitrary JSON object in the cell must NOT become
// evidence merely because it mentions an exit code. Control E holds `{"note":"see the
// ticket","exitCode":1}` — no task key at all — which must stay clean, or every stray snippet
// in a notes cell would start blocking releases.
//
//   case                                                      required
//   A  one passing object                                      clean   (control)
//   B  + a failing object keyed exactly "taskId"                BLOCKED (control: it works)
//   C  + a failing object keyed taskID / task_id / taskid /
//        TaskId                                                 BLOCKED <- D3
//   E  + an object with NO task key at all                      clean   (control: the line)
//
// Usage:
//   node X146-miskeyed-evidence.mjs                # asserts the FIXED state
//   node X146-miskeyed-evidence.mjs --expect-bug   # asserts the DEFECT is present

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

// The gate requires taskId, criterion, command, exitCode, stdout, stderr, durationMs,
// timestamp and verifier. An incomplete object is reported as malformed — which is correct,
// and is why these fixtures are complete: the point here is the KEY, not the shape.
const PASS =
  '{"taskId":"T1","criterion":"login works","command":"npm test","exitCode":0,"stdout":"12 passing","stderr":"","durationMs":1240,"timestamp":"2026-08-15T10:00:00Z","verifier":"tester"}';
const failKeyed = (key) =>
  `{"${key}":"T1","criterion":"login works","command":"npm test","exitCode":1,"stdout":"3 failing","stderr":"","durationMs":1310,"timestamp":"2026-08-15T11:00:00Z","verifier":"tester"}`;

function verdict(evidence) {
  const dir = mkdtempSync(join(tmpdir(), 'x146-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(
      join(dir, 'Dev-Memory', 'PROGRESS.md'),
      `# Progress\n\n| ID | Task | Status | Evidence |\n| :-- | :-- | :-- | :-- |\n| T1 | Build login | done | ${evidence} |\n`,
    );
    // A crash is not a verdict. readGate() names it; refuseCrash() refuses to
    // let this reproduction reason about it. See _verdict.mjs.
    const v = refuseCrash(readGate(process.execPath, join(HOOKS, 'verify-progress.mjs'), [dir]), 'X146-miskeyed-evidence.mjs', die);
    return { status: v.status, raw: v.raw.slice(0, 200) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = verdict(PASS);
if (A.status !== 'clean') die(`control A failed: a single passing evidence object must be clean, got ${A.status}: ${A.raw.slice(0, 200)}`);
console.log('  A  one passing object ........................... clean   (control)');

const B = verdict(`${PASS} ${failKeyed('taskId')}`);
if (B.status === 'clean') die('control B failed: a failing object keyed exactly "taskId" must block — the multi-object check is not working at all.');
console.log('  B  + a failing object keyed "taskId" ............ BLOCKED (control)');

const VARIANTS = ['taskID', 'task_id', 'taskid', 'TaskId'];
const missed = [];
for (const k of VARIANTS) {
  const v = verdict(`${PASS} ${failKeyed(k)}`);
  const caught = v.status !== 'clean';
  console.log(`  C  + a failing object keyed "${k}"${' '.repeat(Math.max(1, 12 - k.length))}...... ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- D3'}`);
  if (!caught) missed.push(k);
}

// ---- Control E: the line this fix must not cross -----------------------------
const E = verdict(`${PASS} {"note":"see the ticket","exitCode":1}`);
if (E.status !== 'clean') {
  die(
    'control E failed: an object with NO task key was treated as evidence. Every stray JSON ' +
      `snippet in a notes cell would then start blocking releases: ${E.raw.slice(0, 200)}`,
  );
}
console.log('  E  + an object with NO task key ................. clean   (control: the line)');

if (expectBug) {
  if (missed.length === 0) die('expected the D3 defect and found none. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nD3 REPRODUCED: a recorded failure is discarded when keyed ${missed.join(', ')}.`);
  process.exit(0);
}

if (missed.length === 0) {
  console.log('\nPASS: a recorded failure counts however the task key is spelled, and a stray object still does not.');
  process.exit(0);
}

die(
  `D3 is OPEN: a failing evidence object keyed ${missed.join(', ')} is not recognised as evidence, ` +
    'so the row passes on the strength of an older passing object — the exact masking the ' +
    'multi-object check was added to prevent, reopened through a spelling. ' +
    'Fix: recognise the ordinary spellings of the task key, and no more than that.',
);
