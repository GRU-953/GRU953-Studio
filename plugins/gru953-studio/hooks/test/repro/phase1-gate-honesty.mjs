#!/usr/bin/env node
//
// Reproductions for Phase 1 — 2026-08-13.
//
// Twelve findings, all in one class: a gate that reports success on input it did
// not fully read, fully parse, or correctly recognise. Two of the twelve are the
// inverse (a gate blocking legitimate input), included here because they share
// the same root cause and the same fix.
//
// METHOD. Each case is built by mutating the repository's own golden fixture, so
// the ONLY variable is the mutation named. Run:
//
//   node phase1-gate-honesty.mjs --expect-bug   # before fixing: must all reproduce
//   node phase1-gate-honesty.mjs                # after fixing:  must all flip
//
// Exit 0 = every case matched the expected state.
//
// Note on the two inverse cases (P5, P12): "buggy" for them means BLOCKED (a
// false positive), so the fixed state is `clean`. Encoded per-case, not assumed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 2026-08-13: two cases below make a file UNREADABLE with `chmod 000`. On Windows
// that does not restrict reading at all, so the gate legitimately still reads the
// file and the case cannot demonstrate anything. Caught by this project's own
// three-operating-system CI matrix, which is exactly what that matrix is for.
//
// They are skipped on Windows rather than weakened everywhere: the defect they pin
// (a gate reporting success on input it could not read) is real and is still
// covered on Windows by case P7, which replaces the file with a DIRECTORY — a
// failure mode every platform produces.
const IS_WINDOWS = process.platform === 'win32';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.resolve(HERE, '..', '..');
const REPO = path.resolve(HOOKS, '..', '..', '..');
const GOLDEN = path.join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory');
const NODE = process.execPath;
const expectBug = process.argv.includes('--expect-bug');

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru-p1-'));
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  for (const f of fs.readdirSync(GOLDEN)) {
    fs.copyFileSync(path.join(GOLDEN, f), path.join(dir, 'Dev-Memory', f));
  }
  return dir;
}

// Runs a gate and reports 'clean' (exit 0) or 'blocked' (non-zero).
function verdict(hook, args) {
  const r = spawnSync(NODE, [path.join(HOOKS, hook), ...args], { encoding: 'utf8' });
  return r.status === 0 ? 'clean' : 'blocked';
}

const cases = [];

// ---- P1 (X2, CRITICAL) — quality-gate reads only the FIRST table -----------
cases.push({
  id: 'P1',
  finding: 'X2',
  hook: 'quality-gate.mjs',
  what: 'a FAILING current-phase table appended below the finished one is ignored',
  buggy: 'clean',
  setup(dir) {
    fs.appendFileSync(
      path.join(dir, 'Dev-Memory', 'QUALITY-GATE.md'),
      [
        '',
        '# Quality Gate — Phase 2 (Definition of Done)',
        '',
        '| Item | Status | Evidence |',
        '| :-- | :-- | :-- |',
        '| Acceptance criteria | todo | not started |',
        '| Automated tests | fail | `npm test` -> exit 1, 3 failing |',
        '| Independent code review | todo | not started |',
        '| Security / licence / privacy | todo | not started |',
        '| Accessibility | todo | not started |',
        '| Documentation | todo | not started |',
        '| Reproducible build | todo | not started |',
        '',
      ].join('\n'),
    );
    return [dir];
  },
});

// ---- P2 (X10) — content-check reads only the FIRST asset table --------------
cases.push({
  id: 'P2',
  finding: 'X10',
  hook: 'content-check.mjs',
  what: 'an unapproved, unattributed image in a SECOND asset table ships unchecked',
  buggy: 'clean',
  setup(dir) {
    fs.appendFileSync(
      path.join(dir, 'Dev-Memory', 'CONTENT.md'),
      [
        '',
        '## Images',
        '',
        '| Asset | Medium | Provenance | Approval | Rights | Alt-text |',
        '| :-- | :-- | :-- | :-- | :-- | :-- |',
        '| hero-banner.png | image | unknown, found on the web | tbd | unknown licence | — |',
        '',
      ].join('\n'),
    );
    return [dir];
  },
});

// ---- P3 (X11a) — verify-progress passes a PROGRESS.md with no table ---------
cases.push({
  id: 'P3',
  finding: 'X11a',
  hook: 'verify-progress.mjs',
  what: 'three tasks claimed done in bullet form, no table, no evidence',
  buggy: 'clean',
  setup(dir) {
    fs.writeFileSync(
      path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
      '# Progress\n\n- T1 habit CRUD: done\n- T2 check-in UI: done\n- T3 streak counter: done\n',
    );
    return [dir];
  },
});

// ---- P4 (X11b) — "unverified:" satisfies the evidence pattern ---------------
cases.push({
  id: 'P4',
  finding: 'X11b',
  hook: 'verify-progress.mjs',
  what: '"unverified:" is accepted as proof, and the text admits nobody ran it',
  buggy: 'clean',
  setup(dir) {
    const p = path.join(dir, 'Dev-Memory', 'PROGRESS.md');
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .replace(
          'verified: `npm test -- habit.test.js` -> exit 0 (2026-07-20)',
          'unverified: `npm test -- habit.test.js` -> exit 0 is what we expect once someone runs it',
        ),
    );
    return [dir];
  },
});

// ---- P5 (X25, INVERSE) — "exit code 0" is rejected -------------------------
cases.push({
  id: 'P5',
  finding: 'X25',
  hook: 'verify-progress.mjs',
  what: 'a genuinely passing task written as "exit code 0" is BLOCKED (false positive)',
  buggy: 'blocked',
  setup(dir) {
    const p = path.join(dir, 'Dev-Memory', 'PROGRESS.md');
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .replace(/-> exit 0 \(2026-07-2\d\)/g, '-> exit code 0 (2026-07-20)'),
    );
    return [dir];
  },
});

// ---- P6 / P7 (X12) — memory-integrity on input it cannot read ---------------
cases.push({
  id: 'P6',
  finding: 'X12a',
  skipOnWindows: true, // chmod 000 does not restrict reads on Windows
  hook: 'memory-integrity.mjs',
  what: 'INDEX.md exists but is unreadable (chmod 000) — gate calls it consistent',
  buggy: 'clean',
  setup(dir) {
    fs.chmodSync(path.join(dir, 'Dev-Memory', 'INDEX.md'), 0o000);
    return [dir];
  },
  cleanup(dir) {
    try {
      fs.chmodSync(path.join(dir, 'Dev-Memory', 'INDEX.md'), 0o644);
    } catch {
      /* already gone */
    }
  },
});
cases.push({
  id: 'P7',
  finding: 'X12b',
  hook: 'memory-integrity.mjs',
  what: 'INDEX.md replaced by a directory — gate calls it consistent',
  buggy: 'clean',
  setup(dir) {
    const p = path.join(dir, 'Dev-Memory', 'INDEX.md');
    fs.rmSync(p);
    fs.mkdirSync(p);
    return [dir];
  },
});

// ---- P8 (X12c) — traceability-check on an unreadable REQUIREMENTS.md --------
cases.push({
  id: 'P8',
  finding: 'X12c',
  skipOnWindows: true, // chmod 000 does not restrict reads on Windows
  hook: 'traceability-check.mjs',
  what: 'REQUIREMENTS.md unreadable is treated as absent, and Tiny Tier excuses it',
  buggy: 'clean',
  setup(dir) {
    const obj = path.join(dir, 'Dev-Memory', 'OBJECTIVE.md');
    fs.writeFileSync(
      obj,
      fs.readFileSync(obj, 'utf8').replace('**Tier:** Standard', '**Tier:** Tiny'),
    );
    fs.chmodSync(path.join(dir, 'Dev-Memory', 'REQUIREMENTS.md'), 0o000);
    return [dir];
  },
  cleanup(dir) {
    try {
      fs.chmodSync(path.join(dir, 'Dev-Memory', 'REQUIREMENTS.md'), 0o644);
    } catch {
      /* already gone */
    }
  },
});

// ---- P9 (second-hand) — licence-scan with an empty node_modules -------------
cases.push({
  id: 'P9',
  finding: 'reported',
  hook: 'licence-scan.mjs',
  what: 'declared dependencies + an EMPTY node_modules is reported as checked and clean',
  buggy: 'clean',
  setup(dir) {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(
        { name: 'x', version: '1.0.0', dependencies: { 'some-copyleft-lib': '^3.0.0' } },
        null,
        2,
      ),
    );
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    return [dir];
  },
});

// ---- P10 (second-hand) — docs-consistency DC9 skips a blank version --------
cases.push({
  id: 'P10',
  finding: 'reported',
  hook: 'docs-consistency.mjs',
  what: 'a client manifest with an EMPTY version string is skipped, not failed',
  buggy: 'clean',
  isRepoCopy: true,
  setup(dir) {
    const p = path.join(dir, 'clients', 'cli', 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    return [dir];
  },
});

// ---- P11 (second-hand) — quality-gate raw pipe hides a recorded failure -----
cases.push({
  id: 'P11',
  finding: 'reported',
  hook: 'quality-gate.mjs',
  what: 'a raw pipe in an Evidence cell mis-columns the row and hides "exit code 1"',
  buggy: 'clean',
  setup(dir) {
    const p = path.join(dir, 'Dev-Memory', 'QUALITY-GATE.md');
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .replace(
          '| Automated tests | pass | `npm test` -> exit 0 (2026-07-21) |',
          '| Automated tests | pass | `npm test | tail -5` -> exit code 1, 3 failing right now |',
        ),
    );
    return [dir];
  },
});

// ---- P12 (X24, INVERSE) — docs-consistency false-blocks project memory -----
cases.push({
  id: 'P12',
  finding: 'X24',
  hook: 'docs-consistency.mjs',
  what: 'a Dev-Memory note pointing at a sibling memory file by name is BLOCKED (false positive)',
  buggy: 'blocked',
  isRepoCopy: true,
  setup(dir) {
    // CORRECTION (2026-08-13): the first version of this case referenced
    // `UNBUILT.md` without creating it, so blocking was CORRECT and the case was
    // testing nothing. The real defect is narrower and worth stating precisely:
    // refResolves() checks the repo root, the plugin root, agents/, skills/,
    // hooks/, commands/ AND the referencing file's own directory — but never a
    // PARENT directory. So a note one level down in Dev-Memory/decisions/ cannot
    // see a sibling of its own parent, which is exactly where UNBUILT.md,
    // PROGRESS.md and REQUIREMENTS.md all live. The file below therefore DOES
    // exist, and blocking it is a false positive.
    const dm = path.join(dir, 'Dev-Memory');
    const d = path.join(dm, 'decisions');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(dm, 'UNBUILT.md'), '# Unbuilt\n\nNothing cut yet.\n');
    fs.writeFileSync(
      path.join(d, 'note.md'),
      '# A decision\n\nWe cut two things today; see `UNBUILT.md` for the ledger.\n',
    );
    return [dir];
  },
});

// A copy of the repository, for the two gates that need one.
function repoCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru-p1-repo-'));
  const r = spawnSync(
    'rsync',
    [
      '-a',
      '--exclude',
      'node_modules',
      '--exclude',
      '.git',
      '--exclude',
      'dist',
      '--exclude',
      'dist2',
      '--exclude',
      'Dev-Memory',
      REPO + '/',
      dir + '/',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error('rsync failed: ' + r.stderr);
  return dir;
}

console.log(`Phase 1 reproductions — expecting the ${expectBug ? 'DEFECT' : 'FIX'}\n`);
let failures = 0;
for (const c of cases) {
  if (c.skipOnWindows && IS_WINDOWS) {
    console.log(
      `  skip  ${c.id.padEnd(4)} ${c.finding.padEnd(9)} ${c.what} — chmod cannot make a file unreadable on Windows; P7 covers this class here`,
    );
    continue;
  }
  const dir = c.isRepoCopy ? repoCopy() : freshProject();
  let got, want;
  try {
    const args = c.setup(dir);
    got = verdict(c.hook, args);
    want = expectBug ? c.buggy : c.buggy === 'clean' ? 'blocked' : 'clean';
  } finally {
    if (c.cleanup) c.cleanup(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${c.id.padEnd(4)} ${c.finding.padEnd(9)} got ${got.padEnd(8)} want ${want.padEnd(8)} ${c.what}`,
  );
}

// Negative control: the UNMUTATED golden fixture must stay clean on all five
// project gates, in both states. Without this, "make every gate block" would
// score as a perfect result.
console.log('\n  Negative control — the unmutated golden fixture must stay clean:');
{
  const dir = freshProject();
  for (const hook of [
    'verify-progress.mjs',
    'quality-gate.mjs',
    'traceability-check.mjs',
    'memory-integrity.mjs',
    'content-check.mjs',
  ]) {
    const got = verdict(hook, [dir]);
    const ok = got === 'clean';
    if (!ok) failures++;
    console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${hook.padEnd(24)} ${got}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? 'ALL AS EXPECTED' : 'MISMATCH'} — ${failures} case(s) not in the expected state.`,
);
process.exit(failures === 0 ? 0 : 1);
