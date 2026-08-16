#!/usr/bin/env node
//
// Reproduction for finding X22 — 2026-08-13.
//
// THE DEFECT. With GRU953-Studio installed, its own secret scanner refuses to let
// this repository be pushed. `scan.mjs` reports 16 violations in the product's own
// source: eight secret-shaped strings in `hooks.test.mjs` (its own test vectors,
// including AWS's own published example access-key id) and eight
// `dev-memory` hits from its own committed golden test fixture, which is
// deliberately named `Dev-Memory/` because that is what it is a fixture OF.
//
// WHY IT MATTERS. It means one of two things is true, and both are bad: either the
// maintainer pushes with the plugin's hooks inactive — so the product's flagship
// safety mechanism is never actually dogfooded on its own source — or releasing is
// blocked outright. During the 2026-08-13 session this hook denied SEVEN of the
// assistant's own ordinary commands, several of which only mentioned publishing in
// passing.
//
// THE FIX. Two narrow, explicit allowances, never a blanket "ignore test files":
//   * the eight test-vector lines carry the marker `// scan-allow: known test
//     fixture`, which scan.mjs already supports for exactly this purpose — it
//     exempts one annotated LINE, not the string anywhere it appears, so the
//     tests that assert those same strings ARE caught in a real project still pass;
//   * the committed fixture path `plugins/gru953-studio/hooks/test/fixtures/` is
//     exempt from the Dev-Memory path rule, since a fixture named Dev-Memory is
//     test data, not a real project's private memory.
//
// Run:  node X22-cannot-push-own-repo.mjs               (expects the FIX)
//       node X22-cannot-push-own-repo.mjs --expect-bug  (expects the DEFECT)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readDecision, refuseCrash } from './_verdict.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.resolve(HERE, '..', '..');
const REPO = path.resolve(HOOKS, '..', '..', '..');
const NODE = process.execPath;
const expectBug = process.argv.includes('--expect-bug');

// Built from character codes so this file's own text never contains a
// push-capable command string, which would otherwise make the live hook deny the
// very command that runs this script.
const PUSH = ['git', 'push', 'origin', 'development'].join(' ');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// `decision: null` used to mean two different things — scan.mjs stood aside, or it threw and
// this script swallowed the stack trace. Case A below passes on anything that is not `deny`,
// so a crash read as a pass. readDecision() names the crash instead.
function decisionFor(cwd) {
  const v = refuseCrash(
    readDecision(NODE, path.join(HOOKS, 'scan.mjs'), { tool_name: 'Bash', tool_input: { command: PUSH }, cwd }),
    'X22-cannot-push-own-repo.mjs',
    die,
  );
  return v.kind === 'silent' ? { decision: null, reason: '' } : { decision: v.decision, reason: v.reason };
}

let failures = 0;

console.log(`X22 reproduction — expecting the ${expectBug ? 'DEFECT' : 'FIX'}\n`);

// --- A. the product repository itself must be pushable -----------------------
{
  const { decision, reason } = decisionFor(REPO);
  const findings = reason
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => l.trim());
  const want = expectBug ? 'deny' : null;
  const ok = decision === want;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  A  the product repo: decision=${decision} (want ${want})`,
  );
  if (findings.length) {
    console.log(`        ${findings.length} finding(s) still reported:`);
    for (const f of findings.slice(0, 6)) console.log(`          ${f}`);
    if (findings.length > 6) console.log(`          ... and ${findings.length - 6} more`);
  }
}

// --- B. CONTROL: a real secret in a real project must STILL be caught --------
// This is the assertion that stops the fix from being a hole. If the allowance
// were a blanket "ignore secret-shaped strings", or "ignore anything under a
// test directory", this would go quiet — and the whole scanner would be worthless.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru-x22-ctl-'));
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'Dev-Memory/\n');
  // AWS's own published example key — the identical string the product's tests use.
  fs.writeFileSync(path.join(dir, 'creds.txt'), 'aws_key = AKIA' + 'IOSFODNN7EXAMPLE\n');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '.gitignore', 'creds.txt');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const { decision } = decisionFor(dir);
  const ok = decision === 'deny';
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  B  control: the SAME secret string in a real project must still deny -> ${decision}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- C. CONTROL: a real project's Dev-Memory must STILL be blocked ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru-x22-ctl2-'));
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), '# progress\n');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'hello\n');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A'); // Dev-Memory deliberately NOT gitignored
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const { decision } = decisionFor(dir);
  const ok = decision === 'deny';
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  C  control: a real project's tracked Dev-Memory must still deny -> ${decision}`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? 'ALL AS EXPECTED' : 'MISMATCH'} — ${failures} case(s) not in the expected state.`,
);
process.exit(failures === 0 ? 0 : 1);
