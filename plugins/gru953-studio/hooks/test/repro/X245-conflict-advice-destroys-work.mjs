#!/usr/bin/env node
//
// Reproduction for X245 - when an update left conflicts, the recovery instructions told a
// non-technical owner to destroy the only surviving copy of their own work.
//
// The path is real and reachable: `git pull --rebase --autostash` stashes uncommitted changes,
// rebases, then pops. On a pop conflict the files are left holding literal conflict markers and the
// stash entry is RETAINED - which is the good news, because it is the only intact copy of what the
// user had. The project's own test at hooks.test.mjs reproduces exactly this state.
//
// The message printed at that moment used to end:
//
//   "Resolve the conflicts in the listed files, or run `git checkout --theirs -- <file>` / `--ours`
//    to pick a side, then `git stash drop`. Do not leave the conflict markers in place."
//
// Two things are wrong with that, and the audience is the point. This product's own charter says the
// reader is non-technical and that instructions must say exactly what to type.
//
//   1  `git stash drop` PERMANENTLY DELETES the stash entry - the thing the line immediately above
//      it has just described as holding their original changes. There is no undo. So the sequence
//      reads: discard one side of your work, then destroy the only remaining copy of it.
//
//   2  `--ours` and `--theirs` were offered with no explanation of which is which. During a rebase
//      they are the opposite way round from what nearly everyone expects: "ours" is the INCOMING
//      updated code and "theirs" is the user's own stashed work. Anyone following that line intending
//      to keep their own changes would have discarded them. This is not an obscure trap - it is the
//      single most commonly misread thing about git rebase.
//
// So the finding is not "the advice is terse". It is that following it as written loses work, twice
// over, in the one situation where the user has already been told something went wrong.
//
//   case                                                         required
//   A  `git stash drop` is not given as a step to take now         it is presented as optional and last
//   B  --ours / --theirs are explained, not merely offered         both are spelled out
//   C  the user is told nothing is lost yet                        stated before any instruction
//   D  the user is shown how to LOOK before deciding               git stash list / show is offered
//   E  control: the message still says what went wrong             the files and the markers are named
//
// Case E is the control that stops this being "fixed" by deleting the advice. A message that says
// nothing at all would pass A to D and leave the user worse off than before.
//
// Usage:
//   node X245-conflict-advice-destroys-work.mjs                # asserts the fixed state
//   node X245-conflict-advice-destroys-work.mjs --expect-bug   # asserts the defect

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', '..', 'auto-update.mjs'), 'utf8');

// Only the lines this hook actually PRINTS. Comments explaining the old defect necessarily quote it,
// and a check that could not tell an explanation from a live instruction would stay red for ever -
// the same mistake X243's reproduction made about `npm bin -g` and had to be repaired for.
const printed = SRC.split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n');

// The conflict branch only. The file has other console.error calls for unrelated failures, and
// pulling them in would let an unrelated message satisfy a case.
const start = printed.indexOf('the update did NOT apply cleanly');
const end = printed.indexOf('process.exitCode = 1', start);
const block = start > -1 && end > start ? printed.slice(start, end) : '';

const problems = [];
const note = (s) => problems.push(s);

if (!block) {
  console.error(
    'FAIL: could not find the conflict-reporting block in auto-update.mjs, so nothing here is ' +
      'testing what it claims to test. Find the new shape and update this reproduction.',
  );
  process.exit(1);
}

// ---- A: stash drop must not be an instruction to follow now ------------------------
{
  const mentionsDrop = /git stash drop/.test(block);
  if (!mentionsDrop) {
    console.log('  A  `git stash drop` .......................... not offered at all');
  } else {
    // If it is mentioned, it must be hedged: presented as optional, warned about, and last.
    const hedged =
      /never have to|only once|cannot be undone|permanently|do not have to|leaving it there/i.test(
        block,
      );
    const chainedOnto = /(?:--ours|--theirs)[^.]{0,120}?then\s*`?git stash drop/i.test(block);
    if (chainedOnto) {
      note(
        'case A: `git stash drop` is still chained onto picking a side ("…then `git stash drop`"), ' +
          'which tells the user to discard half their work and then delete the only copy of it',
      );
    } else if (!hedged) {
      note(
        'case A: `git stash drop` appears with no warning that it is permanent and no statement ' +
          'that it is optional - it is the one command here that cannot be undone',
      );
    } else {
      console.log('  A  `git stash drop` .......................... optional, warned, and last');
    }
  }
}

// ---- B: --ours and --theirs explained -----------------------------------------------
{
  const offersEither = /--ours|--theirs/.test(block);
  if (!offersEither) {
    console.log(
      '  B  --ours / --theirs ......................... not offered, so nothing to explain',
    );
  } else {
    const explainsOurs = /--ours[^\n]*\n?[^\n]*(?:NEW|updated|incoming)/i.test(block);
    const explainsTheirs = /--theirs[^\n]*\n?[^\n]*(?:YOUR|your version|your own)/i.test(block);
    if (!explainsOurs || !explainsTheirs) {
      note(
        'case B: --ours / --theirs are offered without saying which side each keeps. During a ' +
          'rebase they are reversed from what almost everyone expects, so a user trying to keep ' +
          'their own work would discard it',
      );
    } else {
      console.log('  B  --ours / --theirs ......................... both spelled out');
    }
  }
}

// ---- C: the user is told nothing is lost yet ----------------------------------------
{
  if (
    !/nothing of yours has been lost|still saved in the stash|still there|nothing is gone/i.test(
      block,
    )
  ) {
    note(
      'case C: the message never says that the original work is still intact, so the first thing ' +
        'the user learns is that something went wrong and the next thing is a destructive command',
    );
  } else {
    console.log('  C  "nothing of yours has been lost" .......... stated');
  }
}

// ---- D: the user can look before deciding -------------------------------------------
{
  if (!/git stash list|git stash show/.test(block)) {
    note(
      'case D: the user is given no way to SEE what is in the stash before acting on it - the one ' +
        'step that turns "trust me" into something they can check for themselves',
    );
  } else {
    console.log('  D  how to look before deciding ............... offered');
  }
}

// ---- E: control - the message must still report the problem -------------------------
{
  const namesFiles = /conflicted\.join|listed files|listed above/i.test(block);
  const namesMarkers = /conflict marker/i.test(block);
  if (!namesFiles || !namesMarkers) {
    note(
      'control E: the message no longer tells the user which files are affected or that they hold ' +
        'conflict markers. Removing the advice is not fixing it',
    );
  } else {
    console.log('  E  control: still reports what went wrong .... yes');
  }
}

// ---- the axis this file held still: WHAT THE CODE EXECUTES -----------------------
//
// 2026-08-24, X293. Every case above varies the WORDING of the printed advice — `git stash drop`
// hedged and placed last, `--ours`/`--theirs` each explained, "nothing has been lost" stated,
// `git stash list` offered — and not one of them looks at what the updater actually RUNS. This file
// imports `readFileSync` and nothing else.
//
// For a DATA-LOSS finding that is the wrong axis to be the only one. The finding is that the user's
// work gets destroyed; the advice text is one route to that and the code is the other. A future edit
// adding `execSync('git stash drop')`, `git checkout --force`, `git reset --hard` or `git clean -fd`
// to the recovery path leaves cases A to E green, because the advice is untouched and case A only ever
// asks whether the STRING 'git stash drop' is hedged in prose.
//
// So: collect every command the file executes, and judge the SET. Verified 2026-08-24 that there is no
// live defect — the only stash operation executed anywhere is `git pull --rebase --autostash`, and
// every other mention is comment text or the printed advice — but nothing in the file could have told
// anyone if that changed.
{
  // The commands as the code would run them, with comments stripped so an explanation quoting a
  // dangerous command is not mistaken for one being executed — the same distinction cases A to E
  // already rely on for the advice text.
  const live = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const executed = [];
  // Both call shapes: a quoted literal, and a template literal with interpolation.
  for (const m of live.matchAll(/exec(?:Sync|FileSync)\(\s*(['"`])([\s\S]*?)\1/g)) {
    executed.push(m[2].replace(/\$\{[^}]*\}/g, '<…>').trim());
  }
  for (const m of live.matchAll(/spawn(?:Sync)?\(\s*(['"`])([\s\S]*?)\1/g)) {
    executed.push(m[2].replace(/\$\{[^}]*\}/g, '<…>').trim());
  }

  // A command is destructive if it can discard work that exists nowhere else. `--autostash` is
  // explicitly NOT on this list: it stashes and restores around a rebase, which is the opposite of
  // discarding, and it is the one stash operation this updater is meant to perform.
  const DESTRUCTIVE = [
    {
      re: /\bstash\s+(drop|clear)\b/,
      why: 'discards a stash, which may be the only copy of the work',
    },
    { re: /\breset\s+--hard\b/, why: 'throws away committed and uncommitted work' },
    { re: /\bcheckout\s+(--force|-f)\b/, why: 'overwrites local changes without asking' },
    {
      re: /\bclean\s+-[a-z]*[dxf]/,
      why: 'deletes untracked files, which are never recoverable from git',
    },
    { re: /\brestore\s+.*--(worktree|staged)\b/, why: 'discards local modifications' },
    { re: /\brebase\s+--abort\b.*\bstash\b/, why: 'aborts and drops in one step' },
    { re: /\bbranch\s+-D\b/, why: 'force-deletes a branch and any commits only on it' },
    { re: /\bpush\s+.*--force(?!-with-lease)/, why: 'overwrites remote history' },
    { re: /\bfilter-branch\b/, why: 'rewrites history irreversibly' },
    { re: /\brm\s+-[a-z]*[rf]/, why: 'deletes files' },
  ];
  const found = [];
  for (const cmd of executed) {
    for (const d of DESTRUCTIVE) {
      if (d.re.test(cmd)) found.push(`\`${cmd}\` — ${d.why}`);
    }
  }
  if (found.length) {
    note(
      `the updater EXECUTES ${found.length} destructive command(s) on a path this file only ever ` +
        `read the advice text of: ${found.join('; ')}. The finding is that the user's work is ` +
        'destroyed — the wording is one route to that and the code is the other.',
    );
  } else if (executed.length === 0) {
    // An empty read is never evidence of health. If the extraction stops matching, this case must
    // say so rather than report a clean set it never actually built.
    note(
      'found NO executed commands in auto-update.mjs at all. The file certainly runs git commands, so ' +
        'the extraction above has stopped matching and this case is reporting on nothing.',
    );
  } else {
    console.log(`  ·  ${executed.length} executed command(s) inspected ....... none destructive`);
  }

  // And the one stash operation that IS expected must still be there — otherwise a future edit could
  // pass this case by removing the rebase entirely, which would not be a fix.
  if (!executed.some((c) => /pull\s+--rebase\s+--autostash/.test(c))) {
    note(
      'the updater no longer runs `git pull --rebase --autostash`. That is the operation that PROTECTS ' +
        'local work across the rebase, so its absence is not an improvement — check what replaced it.',
    );
  }
}

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
  '\nPASS: the recovery advice states that nothing is lost, shows the user how to look, explains ' +
    'which side each option keeps, and never presents the irreversible command as a step to take.',
);
