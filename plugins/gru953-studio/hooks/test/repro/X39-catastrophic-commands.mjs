#!/usr/bin/env node
//
// Reproduction for X39 (High) — nothing refuses a command that destroys the machine.
//
// MEASURED BEFORE WRITING THIS. With the push-authorisation layer removed (X214), `scan.mjs` is
// the only PreToolUse hook, and it objects only to a push whose would-ship set carries secrets.
// So at the parent commit:
//
//     rm -rf /                          no decision
//     rm -rf /*                         no decision
//     dd if=/dev/zero of=/dev/disk0     no decision
//     mkfs.ext4 /dev/sda1               no decision
//     git filter-branch --force --all   no decision
//     :(){ :|:& };:                     no decision
//
// WHY THIS IS NOT THE THING X214 REMOVED, because that distinction is the whole design.
// The token layer was AUTHORISATION THEATRE: it tried to establish that a person had agreed, from
// a file an agent could write, and X91 proved that cannot work. This is different in kind. The
// evidence is in the command text itself — `rm -rf /` says what it does — so nothing is inferred
// about intent, nothing is trusted, and there is no token to forge. It is the same basis as the
// secret scan that was kept: refuse on evidence, never on a claim.
//
// WHY IT IS WORTH HAVING AT ALL, given Claude Code already prompts. The prompt is the protection
// for an attended session. It is absent in auto-accept, which is exactly when an inexperienced
// user — this product's stated audience — is least able to catch `rm -rf /` scrolling past. A
// block that cannot be turned off by a token is the only protection that survives that mode.
//
// HONEST BASIS, carried from X39's own register row: no shipped document promises
// dangerous-command blocking, so this rests on an implied guarantee rather than a stated one.
// The fix therefore also states it, so the guarantee becomes real rather than assumed.
//
// THE LINE THIS MUST NOT CROSS, and it is the reason for 14 control cases. Four fixes this week
// over-reached by widening a pattern past the case in front of it. `rm -rf ./build` and
// `rm -rf node_modules` are among the most common commands in software work; a block that catches
// them is worse than no block, because it will be switched off and take the real protection with
// it (lesson L5).
//
//   must be REFUSED                          must NOT be refused
//   rm -rf /                                 rm -rf ./build
//   rm -rf /*                                rm -rf node_modules
//   rm -rf / --no-preserve-root              rm -rf dist/
//   sudo rm -rf /                            rm -rf "$TMPDIR/x"
//   dd of=/dev/disk0                         dd if=in.img of=out.img
//   dd of=/dev/sda bs=1M                     dd if=/dev/urandom of=noise.bin
//   mkfs.ext4 /dev/sda1                      mkfs --help
//   mkfs /dev/disk2                          echo "mkfs is dangerous"
//   git filter-branch --force --all          git filter-branch --help
//   :(){ :|:& };:                            npm test / git status / ls -la
//
// Usage:
//   node X39-catastrophic-commands.mjs                # asserts the FIXED state
//   node X39-catastrophic-commands.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Feed one command to scan.mjs inside a clean studio project. */
function decide(cmd) {
  const dir = mkdtempSync(join(tmpdir(), 'x39-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** test\n');
    const v = refuseCrash(
      readDecision(NODE, join(HOOKS, 'scan.mjs'), {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        cwd: dir,
      }),
      'X39-catastrophic-commands.mjs',
      die,
    );
    return v.kind === 'silent' ? 'no decision' : v.decision;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CATASTROPHIC = [
  ['rm -rf /', 'recursive delete of the filesystem root'],
  ['rm -rf /*', 'the same by glob'],
  ['rm -rf --no-preserve-root /', "defeating rm's own guard explicitly"],
  ['sudo rm -rf /', 'with sudo'],
  ['dd if=/dev/zero of=/dev/disk0', 'raw write to a whole disk'],
  ['dd if=x.img of=/dev/sda bs=1M', 'raw write to a whole disk, other form'],
  ['mkfs.ext4 /dev/sda1', 'making a filesystem over a partition'],
  ['mkfs /dev/disk2', 'the same, bare mkfs'],
  ['git filter-branch --force --all', 'rewriting all history irreversibly'],
];

// 2026-08-18: the same commands, NOT IN FIRST POSITION. Every entry above starts its line, and
// every rule resolved its segment with `leads(re)[0]` - the first segment led by that binary, with
// every later one discarded. The controls and the defect therefore occupied complementary halves of
// the input space: nine of nine green while `rm -rf ./build && rm -rf /` passed in SILENCE, no
// decision of any kind, on the only guard that exists to stop a machine being destroyed.
//
// The separators are varied deliberately - `&&`, `;`, a newline - because the splitter handles all
// three and a control that used only one would repeat the mistake it is here to catch.
const COMPOUND = [
  ['rm -rf ./build && rm -rf /', 'root delete second, after an ordinary one'],
  ['rm -rf node_modules; rm -rf --no-preserve-root /', 'root delete after a semicolon'],
  ['rm -rf dist/\nrm -rf /', 'root delete on a second line'],
  ['npm run build && sudo rm -rf /*', 'root glob delete after a build step'],
  ['dd if=a of=out.img && dd if=/dev/zero of=/dev/disk2', 'disk overwrite second'],
  ['mkfs.ext4 --help && mkfs.ext4 /dev/sda1', 'format second, after the help form'],
  ['git status && git filter-branch --all', 'history rewrite after an ordinary git command'],
];

// Every one of these is ordinary software work. A block that catches any of them will be
// switched off, and take the real protection with it.
const ORDINARY = [
  'rm -rf ./build',
  'rm -rf node_modules',
  'rm -rf dist/',
  'rm -rf "$TMPDIR/scratch"',
  'rm -rf /tmp/my-app-cache',
  'dd if=input.img of=output.img',
  'dd if=/dev/urandom of=noise.bin count=1',
  'mkfs --help',
  'echo "never run mkfs on a mounted disk"',
  'git filter-branch --help',
  'npm test',
  'git status',
  'ls -la /',
  'du -sh /var/log',
  // Found by an adversarial false-alarm hunt, and the reason the rules judge COMMAND POSITION
  // rather than any token: both of these only TALK about the danger. The first version of the
  // fix refused them, which is the same confusion as X206 — prose about a thing satisfying the
  // check for the thing.
  'echo do-not-run mkfs.ext4 /dev/sda1 by accident',
  'echo rm -rf / > notes.txt',
  'grep -r mkfs docs/',
  'git filter-branch -h',
  'sudo rm -rf /usr/local/lib/node_modules/badpkg',
];

let missed = [];
for (const [cmd, what] of CATASTROPHIC) {
  const d = decide(cmd);
  const refused = d === 'deny';
  console.log(
    `  ${refused ? 'ok  ' : 'BAD '} ${refused ? 'deny       ' : String(d).padEnd(11)} ${cmd.padEnd(34)} ${what}`,
  );
  if (!refused) missed.push(cmd);
}

// The same nine, off first position. Reported separately so the output says WHICH axis failed.
for (const [cmd, what] of COMPOUND) {
  const d = decide(cmd);
  const refused = d === 'deny';
  const shown = cmd.replace(/\n/g, '\\n');
  console.log(
    `  ${refused ? 'ok  ' : 'BAD '} ${refused ? 'deny       ' : String(d).padEnd(11)} ${shown.padEnd(50)} ${what}`,
  );
  if (!refused) missed.push(cmd);
}

let falseAlarms = [];
for (const cmd of ORDINARY) {
  const d = decide(cmd);
  if (d === 'deny') falseAlarms.push(cmd);
}
console.log(
  `  ${falseAlarms.length === 0 ? 'ok  ' : 'BAD '} ${ORDINARY.length} ordinary commands ${falseAlarms.length === 0 ? 'all pass' : `— ${falseAlarms.length} WRONGLY REFUSED`}`,
);
for (const f of falseAlarms) console.log(`         wrongly refused: ${f}`);

if (falseAlarms.length > 0) {
  die(
    `${falseAlarms.length} ordinary command(s) were refused. A block that catches \`rm -rf ./build\` ` +
      'or `rm -rf node_modules` is worse than no block: it will be switched off and take the real ' +
      'protection with it (lesson L5). Narrow the pattern to the filesystem ROOT and to whole ' +
      'devices, and measure again.',
  );
}

if (expectBug) {
  if (missed.length === 0)
    die(
      'expected catastrophic commands to pass unrefused and found none. If this was fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(
    `\nX39 REPRODUCED: ${missed.length} of ${CATASTROPHIC.length} catastrophic commands are not refused by anything.`,
  );
  process.exit(0);
}

if (missed.length === 0) {
  console.log(
    `\nPASS: every catastrophic command is refused, and all ${ORDINARY.length} ordinary ones are untouched.`,
  );
  process.exit(0);
}

die(
  `X39 is OPEN: ${missed.length} catastrophic command(s) reach the machine with nothing objecting — ` +
    `${missed.slice(0, 3).join(', ')}${missed.length > 3 ? ', …' : ''}. Each is decidable by exact ` +
    'pattern from the command text alone, so this needs no judgement about intent and no token.',
);
