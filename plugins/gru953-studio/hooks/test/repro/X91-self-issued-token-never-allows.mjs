#!/usr/bin/env node
//
// Reproduction for X91 (and the X100 half of the same problem) — an approval record
// that nothing traces to a human must never buy a SILENT `allow`.
//
// THE PROBLEM, and why no better token can solve it.
//
// gate.mjs decides using only the local filesystem: four accessSync/readFileSync
// calls against records under Dev-Memory/. That is the whole of its evidence. So:
//
//     anything the gate can READ, an agent on the same machine can WRITE.
//
// Therefore NO file-based token can establish that a person agreed. Two proofs, both
// exercised below:
//
//   X91  — the token is sha256("studio-publish:" + studioRoot). The project path is
//          not a secret; every caller already has it. The record forges directly.
//   X100 — confirm-publish.mjs reads no stdin, shows no prompt and takes no nonce.
//          Run with stdin CLOSED it still issues a valid approval.
//
// Making the token longer, random, single-use or command-bound changes none of this.
// A nonce the gate writes down is a nonce the agent can read; a nonce the gate keeps
// in memory dies with the process. This is not a weakness in the token. It is that a
// hook cannot distinguish an agent from a user on the same filesystem.
//
// THE FIX, and what it actually buys.
//
// `allow` does not mean "no objection" — it SUPPRESSES the permission prompt the user
// would otherwise have been shown. That prompt is the only genuine human channel
// available, and the token was reimplementing it, badly, in a place the agent can reach.
//
// So the token's job changes. It no longer grants silent permission; it downgrades a
// hard `deny` to an `ask`. A forged token then buys nothing at all: the forger lands
// exactly where an honest user lands — at the prompt. The guarantee stops being
// "a human approved this" (never true) and becomes "a human is being asked" (always true).
//
//   case                                                     required
//   1  forged record, push                                    ask   <- X91: never allow
//   2  record issued by confirm-publish, stdin closed, push    ask   <- X100: never allow
//   3  no record at all, push                                  deny  (control: still blocks)
//   4  go-public command, only the private token present       deny  (control: escalation holds)
//   5  a command this gate has no business judging             no decision (control: stays out of the way)
//
// Cases 3, 4 and 5 are load-bearing. Without them, "case 1 asks" could be produced by
// a gate that asks about everything and blocks nothing — a worse defect wearing this
// one's clothes.
//
// Usage:
//   node X91-self-issued-token-never-allows.mjs                # asserts the FIXED state
//   node X91-self-issued-token-never-allows.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

const PUSH = 'git push origin main';
const GO_PUBLIC = 'gh repo edit me/app --visibility public';
const HARMLESS = 'echo hello';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function publishToken(root) {
  return createHash('sha256').update(`studio-publish:${root}`).digest('hex');
}

/** Run gate.mjs and return its decision, or 'no decision' when it stands aside. */
function decide(cmd, prepare) {
  const root = mkdtempSync(join(tmpdir(), 'x91-'));
  try {
    mkdirSync(join(root, 'Dev-Memory'), { recursive: true });
    if (prepare) prepare(root);
    // Case 5 below REQUIRES 'no decision' — a hook that stands aside is the documented
    // neutral. A hook that DIED also prints nothing, so silence alone cannot be read as
    // standing aside: readDecision() separates the two on the exit code and stderr, and a
    // crash can therefore never satisfy the case that expects silence.
    const v = refuseCrash(
      readDecision(NODE, join(HOOKS, 'gate.mjs'), { tool_name: 'Bash', tool_input: { command: cmd }, cwd: root }),
      'X91-self-issued-token-never-allows.mjs',
      die,
    );
    return v.kind === 'silent' ? 'no decision' : v.decision;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Forge the record by hand — never invoking any studio command. */
const forge = (root) =>
  writeFileSync(
    join(root, 'Dev-Memory', 'PUBLISH-APPROVED'),
    `STUDIO-PUBLISH-CONFIRMED:${publishToken(root)}\nISSUED:${Date.now()}\n`,
  );

/** Let the product issue it, with stdin closed so no human could have answered. */
const selfIssue = (root) => {
  const r = spawnSync(NODE, [join(HOOKS, 'confirm-publish.mjs'), root], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) die(`confirm-publish.mjs exited ${r.status}: ${r.stderr}`);
};

const CASES = [
  { name: 'forged record + push', cmd: PUSH, prep: forge, want: 'ask', target: true },
  { name: 'self-issued (stdin closed) + push', cmd: PUSH, prep: selfIssue, want: 'ask', target: true },
  { name: 'no record + push', cmd: PUSH, prep: null, want: 'deny', target: false },
  { name: 'go-public, only private token', cmd: GO_PUBLIC, prep: forge, want: 'deny', target: false },
  { name: 'a command the gate should ignore', cmd: HARMLESS, prep: null, want: 'no decision', target: false },
];

let controlsOk = true;
const stillAllowing = [];

for (const c of CASES) {
  const got = decide(c.cmd, c.prep);
  const ok = got === c.want;
  console.log(`  ${ok ? 'ok  ' : 'BAD '} want=${String(c.want).padEnd(11)} got=${got.padEnd(11)} ${c.name}`);
  if (ok) continue;
  if (c.target && got === 'allow') stillAllowing.push(c.name);
  else controlsOk = false;
}

if (!controlsOk) {
  die(
    'a CONTROL case is wrong, so nothing this script says about X91 can be trusted. Either the ' +
      'gate has broken in some other way, or this harness is not reaching it. Fix that first — ' +
      'in particular, a gate that asks about everything would make the X91 cases pass for the ' +
      'wrong reason entirely.',
  );
}

if (expectBug) {
  if (stillAllowing.length === 0) {
    die(
      'expected the X91 defect and did not find it: no unattributable approval produced a silent ' +
        'allow. If it was fixed, delete this --expect-bug branch deliberately rather than leaving ' +
        'a reproduction that can no longer detect anything.',
    );
  }
  console.log(`\nX91 REPRODUCED: ${stillAllowing.length} unattributable approval(s) silently allowed.`);
  process.exit(0);
}

if (stillAllowing.length === 0) {
  console.log('\nPASS: an approval nothing traces to a human now asks the user; it never allows silently.');
  process.exit(0);
}

die(
  `X91 is OPEN: ${stillAllowing.join('; ')} produced a silent allow. ` +
    'The token is sha256("studio-publish:" + projectPath) and confirm-publish.mjs issues one with ' +
    'stdin closed, so nothing about the record establishes human intent. ' +
    'Fix direction: a record that cannot be attributed to a person must never suppress the ' +
    "user's prompt. Downgrade the decision from `allow` to `ask` — the forger then lands exactly " +
    'where an honest user lands.',
);
