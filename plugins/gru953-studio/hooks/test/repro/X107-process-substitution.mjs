#!/usr/bin/env node
//
// Reproduction for X107 — bash process substitution slips past the single-command guard
// and receives `allow`, which suppresses the user's permission prompt for the whole string.
//
// THE REQUIREMENT, in gate.mjs's own words at the guard site:
//
//     "Anything that could run a second command — a separator, a pipe, a background &,
//      a newline, or a substitution — means this is not the single confirmed action,
//      and the decision goes to the user instead of being granted silently."
//
// THE DEFECT. The guard read:
//
//     const MULTI_COMMAND_RE = /[;&|\n]|\$\(|`/;
//
// which catches `$( )` and backticks but not `<( )` or `>( )`. Bash runs the inside of a
// process substitution as a genuine second command — proven by:
//
//     bash -c 'echo "outer saw: $1"' _ <(echo "INNER RAN" >&2)
//       INNER RAN
//       outer saw: /dev/fd/12
//
// So `git push origin main <(rm -rf /tmp/pwned)` was judged a single confirmed action and
// granted `allow`. `allow` is not merely "no objection": it suppresses the permission prompt
// the user would otherwise have seen, for the entire command.
//
// WHY THIS ONE MATTERED MOST. On its own it needs a valid approval token. X91 and X100 prove
// the token is self-issuable — it is sha256("studio-publish:" + projectPath), and
// confirm-publish.mjs issues one with stdin closed. Chained: issue yourself a token, hide any
// command inside <(…), receive a silent allow. Both halves have reproductions.
//
// NOT the gap already disclosed at hooks.test.mjs:1914. That one is isPushCapable failing to
// SEE a hidden push, which fails safe — the user is asked anyway. This runs the other way: the
// command is seen, judged single, and silently allowed.
//
//   case                                              expected after the fix
//   1  plain push, token present                       allow   (the gate must still work)
//   2  push && rm, token present                       ask     (control: the guard worked on &&)
//   3  push $(id), token present                       ask     (control: it worked on $( )
//   4  push <(id), token present                       ask     <- X107
//   5  push >(cat), token present                      ask     <- X107, the other direction
//   6  push <(id), NO token                            deny    (control: token is load-bearing)
//
// Cases 2, 3 and 6 are not decoration. Without them "case 4 says ask" could be produced by a
// gate that asks about everything, which would be a different defect wearing this one's clothes.
//
// Usage:
//   node X107-process-substitution.mjs                # asserts the FIXED state
//   node X107-process-substitution.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// 2026-08-15, finding X91. This reproduction originally distinguished its cases by the
// decision alone: a plain push returned `allow` and a multi-command push returned `ask`.
// X91's fix removed `allow` from this gate entirely — an approval record on disk cannot
// prove a person agreed, so it now buys a prompt rather than silence.
//
// That closes X107 twice over (nothing is silently allowed, so process substitution
// cannot obtain a silent allow either) but it also collapses this test's signal: every
// case now returns `ask`, and a test where every branch expects the same answer proves
// nothing at all.
//
// So the assertion moved to the gate's REASON, which still differs. The multi-command
// path says the command "does more than that one thing"; the single-command path does
// not. That is the distinction this reproduction exists to defend, and it survives.

/** Run gate.mjs on `cmd` and return { decision, reason }. */
function decide(cmd, withToken) {
  const root = mkdtempSync(join(tmpdir(), 'x107-'));
  try {
    mkdirSync(join(root, 'Dev-Memory'), { recursive: true });
    if (withToken) {
      const token = createHash('sha256').update(`studio-publish:${root}`).digest('hex');
      writeFileSync(
        join(root, 'Dev-Memory', 'PUBLISH-APPROVED'),
        `STUDIO-PUBLISH-CONFIRMED:${token}\nISSUED:${Date.now()}\n`,
      );
    }
    // A hook that stands aside prints nothing; so does a hook that died. readDecision()
    // separates them on the exit code and stderr, so a crash can never be read here as the
    // documented neutral. See _verdict.mjs.
    const v = refuseCrash(
      readDecision(NODE, join(HOOKS, 'gate.mjs'), { tool_name: 'Bash', tool_input: { command: cmd }, cwd: root }),
      'X107-process-substitution.mjs',
      die,
    );
    return v.kind === 'silent'
      ? { decision: 'no decision', reason: '' }
      : { decision: v.decision, reason: v.reason };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The sentence the multi-command branch emits and the single-command branch does not.
const MULTI_MARKER = 'does more than that one thing';

// `multi` is the real assertion now: does the gate treat this as MORE than one command?
const CASES = [
  { cmd: 'git push origin main', token: true, want: 'ask', multi: false, role: 'a lone push is ONE command' },
  { cmd: 'git push origin main && rm -rf /tmp/x', token: true, want: 'ask', multi: true, role: 'control: && is caught' },
  { cmd: 'git push origin main $(id)', token: true, want: 'ask', multi: true, role: 'control: $( ) is caught' },
  { cmd: 'git push origin main <(id)', token: true, want: 'ask', multi: true, role: 'X107 — process substitution in' },
  { cmd: 'git push origin main >(cat)', token: true, want: 'ask', multi: true, role: 'X107 — process substitution out' },
  { cmd: 'git push origin main <(id)', token: false, want: 'deny', multi: null, role: 'control: token is load-bearing' },
];

let controlsOk = true;
let markerSeen = false;
const defects = [];

for (const c of CASES) {
  const { decision, reason } = decide(c.cmd, c.token);
  const sawMulti = reason.includes(MULTI_MARKER);
  if (sawMulti) markerSeen = true;
  const decisionOk = decision === c.want;
  const multiOk = c.multi === null || sawMulti === c.multi;
  const ok = decisionOk && multiOk;
  const isX107 = c.role.startsWith('X107');
  console.log(
    `  ${ok ? 'ok  ' : 'BAD '} ${decision.padEnd(11)} multi=${String(sawMulti).padEnd(5)} ${c.cmd}   (${c.role})`,
  );
  if (ok) continue;
  // The X107 defect now looks like this: decision is right, but the gate did NOT
  // recognise the command as more than one thing.
  if (isX107 && decisionOk && !sawMulti) defects.push(c.cmd);
  else controlsOk = false;
}

// Guard against the whole test silently becoming vacuous: if the multi-command branch
// were deleted outright, no case would carry the marker and every X107 row would look
// like a defect for the wrong reason — or, worse, a future refactor could drop the
// marker text and this file would report a defect that is really a renamed message.
if (!markerSeen) {
  die(
    `no case produced the multi-command message ("${MULTI_MARKER}"). Either that branch was ` +
      'removed, or its wording changed. Re-read gate.mjs before trusting any result above.',
  );
}

if (!controlsOk) {
  die(
    'a CONTROL case is wrong, so nothing this script says about X107 can be trusted. Either the ' +
      'gate is broken in some other way, or this harness is not reaching it. Fix that first.',
  );
}

if (expectBug) {
  if (defects.length === 0) {
    die(
      'expected the X107 defect and did not find it: process substitution is now caught. If the ' +
        'guard was fixed, delete this --expect-bug branch deliberately rather than leaving a ' +
        'reproduction that can no longer detect anything.',
    );
  }
  console.log(
    `\nX107 REPRODUCED: ${defects.length} process-substitution form(s) not recognised as a second command.`,
  );
  process.exit(0);
}

if (defects.length === 0) {
  console.log(
    '\nPASS: process substitution is recognised as a second command, a lone push is not, ' +
      'and both still reach the user rather than being approved silently.',
  );
  process.exit(0);
}

die(
  `X107 is OPEN: ${defects.join(' and ')} was not recognised as more than one command. ` +
    'The guard catches $( ) and backticks but not <( ) or >( ), which bash also executes as a ' +
    'second command. Fix: add <( and >( to MULTI_COMMAND_RE in gate.mjs. ' +
    'Note since X91: this no longer yields a SILENT approval — nothing does — but the user is ' +
    'still told this is one command when it is two, which is the guarantee at stake.',
);
