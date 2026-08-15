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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Run gate.mjs on `cmd` from a throwaway studio root and return its decision. */
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
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: root });
    const r = spawnSync(NODE, [join(HOOKS, 'gate.mjs')], { input, encoding: 'utf8' });
    const out = `${r.stdout || ''}`.trim();
    if (!out) return 'no decision';
    try {
      return JSON.parse(out)?.hookSpecificOutput?.permissionDecision ?? 'unparsed';
    } catch {
      return 'unparsed';
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CASES = [
  { cmd: 'git push origin main', token: true, want: 'allow', role: 'the gate must still work' },
  { cmd: 'git push origin main && rm -rf /tmp/x', token: true, want: 'ask', role: 'control: && is caught' },
  { cmd: 'git push origin main $(id)', token: true, want: 'ask', role: 'control: $( ) is caught' },
  { cmd: 'git push origin main <(id)', token: true, want: 'ask', role: 'X107 — process substitution in' },
  { cmd: 'git push origin main >(cat)', token: true, want: 'ask', role: 'X107 — process substitution out' },
  { cmd: 'git push origin main <(id)', token: false, want: 'deny', role: 'control: token is load-bearing' },
];

let controlsOk = true;
const defects = [];

for (const c of CASES) {
  const got = decide(c.cmd, c.token);
  const ok = got === c.want;
  const isX107 = c.role.startsWith('X107');
  console.log(`  ${ok ? 'ok  ' : 'BAD '} want=${c.want.padEnd(5)} got=${got.padEnd(12)} ${c.cmd}   (${c.role})`);
  if (!ok) {
    if (isX107) defects.push(c.cmd);
    else controlsOk = false;
  }
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
  console.log(`\nX107 REPRODUCED: ${defects.length} process-substitution form(s) silently allowed.`);
  process.exit(0);
}

if (defects.length === 0) {
  console.log('\nPASS: process substitution now goes to the user, and the ordinary push still works.');
  process.exit(0);
}

die(
  `X107 is OPEN: ${defects.join(' and ')} received a silent allow. ` +
    'The guard catches $( ) and backticks but not <( ) or >( ), which bash also executes as a ' +
    'second command. Fix: add <( and >( to MULTI_COMMAND_RE in gate.mjs.',
);
