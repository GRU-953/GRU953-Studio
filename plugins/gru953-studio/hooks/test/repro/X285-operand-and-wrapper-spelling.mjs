#!/usr/bin/env node
//
// Reproduction for X285 — the catastrophic-command guard canonicalised the command WORD and never the
// OPERAND, so the danger simply moved one token to the right. And its shell wrapper required `-c` to
// stand alone as its own token, so `bash -lc` — one of the commonest spellings of `bash -c` in
// existence — was not a wrapper to it at all.
//
// HOW THIS WAS FOUND, because the method is the more useful part. X39's reproduction is a good one: it
// varies POSITION (7 cases), SEPARATOR, WRAPPER IDENTITY and the SPELLING OF THE COMMAND WORD (10
// cases), and it holds the false-alarm line with 24 controls. It passes. An axis-enumeration lens
// asked a different question — not "does it pass" but "what did it hold STILL while it varied
// everything else" — and the answer was: the operand, always written in exactly one canonical form,
// and the wrapper's flag, always the lone token `-c`.
//
// So this is not a case X39 got wrong. It is a case X39 was structurally unable to see, while
// reporting PASS. That is what makes a green suite evidence about the axes someone thought of, and
// nothing more.
//
// MEASURED AT THE PARENT, one command per throwaway studio project, exactly as X39's decide() does.
// Every one of these reached the machine with NO DECISION from the only guard that exists to stop it
// being destroyed:
//
//   rm -rf //          rm -rf /.        rm -rf /./       rm -rf --no-preserve-root //
//   rm -rf "/*"        rm -rf /tmp/..   bash -lc "rm -rf /"     bash --login -c "rm -rf /"
//   dd if=/dev/zero of="/dev/disk0"     mkfs.ext4 "/dev/sda1"   bash -c rm\ -rf\ /
//
// while their canonical twins — `rm -rf /`, `dd of=/dev/disk0`, `bash -c "rm -rf /"` — were all
// refused. The guard was not weakened by these spellings; it was absent for them.
//
//   case                                                  required
//   A  the root, spelled every way a shell accepts it      deny
//   B  a device path in quotes                             deny
//   C  `-c` in a flag cluster, or after a long option      deny
//   D  an unquoted payload after the flag                  deny
//   E  control: the canonical spellings                    still deny
//   F  control: 15 ordinary commands                        silent
//
// CONTROL F IS THE POINT OF THE WHOLE FIX. `rm -rf ./build`, `rm -rf node_modules` and `rm -rf /tmp/x`
// are among the commonest commands in software work, and `/tmp/..` must be caught while `/tmp/x` must
// not — which is exactly why the repair is a path RESOLVER and not a looser pattern. A guard that
// caught any of control F would be switched off within a week and take the real protection with it.
//
// NOTHING IS EXECUTED. Every command is a string handed to the hook on stdin, judged, and discarded.
// No `rm`, no `dd` and no `mkfs` is ever run, and the fixtures are empty throwaway directories.
//
// Usage:
//   node X285-operand-and-wrapper-spelling.mjs                # asserts the fixed state
//   node X285-operand-and-wrapper-spelling.mjs --expect-bug   # asserts the gap

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

const problems = [];
const note = (s) => problems.push(s);

// One studio project, reused: the hook reads it and never writes to it, and a fresh mkdtemp per
// command made this file the slowest in the suite for no gain.
const DIR = mkdtempSync(join(tmpdir(), 'x285-'));
mkdirSync(join(DIR, 'Dev-Memory'), { recursive: true });
writeFileSync(join(DIR, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');

const decide = (command) => {
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: DIR }),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) return 'no decision';
  try {
    return JSON.parse(out).hookSpecificOutput.permissionDecision;
  } catch {
    return '(unparsed)';
  }
};

const check = (id, label, commands, want) => {
  const wrong = commands.filter((c) => (decide(c) === 'deny') !== (want === 'deny'));
  if (wrong.length) {
    note(
      `case ${id}: ${wrong.length} of ${commands.length} ${label} were ${want === 'deny' ? 'NOT refused' : 'REFUSED'}: ` +
        wrong.map((w) => JSON.stringify(w)).join(', '),
    );
    return;
  }
  console.log(`  ${id}  ${label.padEnd(48, '.')} ${want}`);
};

// ---- A: the root, spelled every way a shell accepts it -----------------------------
// `//`, `/.`, `/./` and `/tmp/..` all name the root directory. A path is now RESOLVED — `.` and `..`
// segments applied, empty segments dropped — rather than compared as text.
check(
  'A',
  'the root under every spelling',
  [
    'rm -rf //',
    'rm -rf ///',
    'rm -rf /.',
    'rm -rf /./',
    'rm -rf /..',
    'rm -rf /tmp/..',
    'rm -rf --no-preserve-root //',
    'rm -rf "/*"',
    "rm -rf '/*'",
    'rm -rf "//"',
  ],
  'deny',
);

// ---- B: a device path in quotes --------------------------------------------------
// The quotes may sit around the whole assignment or around only its value; both are the same command
// to a shell, and neither was seen before.
check(
  'B',
  'a device path in quotes',
  [
    'dd if=/dev/zero of="/dev/disk0"',
    "dd if=/dev/zero of='/dev/disk0'",
    'dd if=/dev/zero "of=/dev/disk0"',
    'mkfs.ext4 "/dev/sda1"',
    "mkfs.ext4 '/dev/sda1'",
  ],
  'deny',
);

// ---- C: `-c` in a cluster, or after a long option ------------------------------
// `-c` consumes the argument after it, so it must be LAST in its cluster — which is why the repair
// matches `-[A-Za-z]*c` and deliberately does not match `-cl`.
check(
  'C',
  'the wrapper flag written as a cluster or long option',
  [
    'bash -lc "rm -rf /"',
    'bash -ec "rm -rf /"',
    'sh -ec "rm -rf /"',
    'bash --login -c "rm -rf /"',
    'bash --noprofile --norc -c "rm -rf /"',
    'zsh -lc "rm -rf /"',
  ],
  'deny',
);

// ---- D: an unquoted payload after the flag -------------------------------------
check(
  'D',
  'an unquoted payload after the flag',
  ['bash -c rm\\ -rf\\ /', 'sh -c rm\\ -rf\\ /'],
  'deny',
);

// ---- E: control — the canonical spellings must still be refused ----------------
check(
  'E',
  'control: the canonical spellings',
  [
    'rm -rf /',
    'rm -rf "/"',
    'rm -rf /*',
    '/bin/rm -rf /',
    'dd of=/dev/disk0',
    'dd if=/dev/zero of=/dev/rdisk0',
    'mkfs.ext4 /dev/sda1',
    'bash -c "rm -rf /"',
    'eval "rm -rf /"',
    'git filter-branch --all',
  ],
  'deny',
);

// ---- F: control — the false-alarm line ----------------------------------------
// `/tmp/..` must be caught (case A) and `/tmp/x` must not. That pair is the whole argument for
// resolving a path rather than widening a pattern.
check(
  'F',
  'control: fifteen ordinary commands',
  [
    'rm -rf ./build',
    'rm -rf node_modules',
    'rm -rf /tmp/x',
    'rm -rf ../scratch',
    'rm -rf dist',
    'rm -rf "/tmp/build"',
    'rm -rf /usr/local/lib/x',
    'dd if=/dev/zero of=/dev/null',
    'dd if=a.img of=b.img',
    'mkfs.ext4 --help',
    'git status',
    'echo "do not run rm -rf /"',
    'echo rm -rf / > notes.txt',
    'bash -lc "npm test"',
    'bash -c rm\\ -rf\\ ./build',
  ],
  'silent',
);

rmSync(DIR, { recursive: true, force: true });

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nPASS: the root is refused however it is spelled, a quoted device path is refused, the wrapper ' +
    'flag is recognised in a cluster and after long options — and fifteen ordinary commands are not ' +
    'touched.',
);
