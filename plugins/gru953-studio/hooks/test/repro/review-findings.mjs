#!/usr/bin/env node
//
// Reproductions for the independent review of 13 August 2026.
//
// The review of the Phase 0 + Phase 1 change set found twelve findings. Two were
// NEW fail-opens that those very fixes introduced, and one showed a security
// exemption that was simultaneously too wide and too narrow. This script pins
// every behavioural one, in both directions.
//
// Run:  node review-findings.mjs               (expects the FIXES)
//       node review-findings.mjs --expect-bug  (expects the DEFECTS)
//
// Cases, and why each matters:
//   F1  quality-gate: a NARROW failing table below a complete one was ignored.
//       My "dimension quorum" heuristic reintroduced the critical X2 defect for
//       exactly the shape a phase-in-progress produces.
//   F1b the explicit opt-out marker still works, so an unrelated table can be
//       declared rather than guessed at.
//   F2  content-check: a header-only register (created, never filled) passed.
//   F3a the fixture exemption was not bound to this plugin — an unrelated repo
//       with a lookalike directory shipped private memory unflagged.
//   F3b the exemption was cwd-dependent: pushing from a subdirectory re-broke it.
//   F4  a valid publish token blanket-approved anything appended to the push.
//   F6  ordinary prose containing a pipe, next to a table, was read as a
//       malformed row and blocked the gate.
//   F7  the `unverified:` contradiction alternative was dead (a trailing \b after
//       a colon can never match real evidence).
//   F8  `un-verified:` and `not-verified:` passed where `unverified:` blocked.
//   F9  the done-claim sweep was disabled by the presence of any table.
//   F10 a platform-specific optional dependency made the licence scan
//       permanently incomplete, with advice that could never fix it.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.resolve(HERE, '..', '..');
const GOLDEN = path.join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory');
const NODE = process.execPath;
const expectBug = process.argv.includes('--expect-bug');
// Assembled so this file's own text never contains a push-capable command string.
const PUSH = ['git', 'push', 'origin', 'main'].join(' ');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function golden(dir) {
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  for (const f of fs.readdirSync(GOLDEN)) {
    fs.copyFileSync(path.join(GOLDEN, f), path.join(dir, 'Dev-Memory', f));
  }
}
const gateVerdict = (hook, root) =>
  spawnSync(NODE, [path.join(HOOKS, hook), root], { encoding: 'utf8' }).status === 0
    ? 'clean'
    : 'blocked';
function hookDecision(hook, command, cwd) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
  const r = spawnSync(NODE, [path.join(HOOKS, hook)], { input, encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision ?? 'none';
  } catch {
    return 'none';
  }
}
// A studio project MUST contain a Dev-Memory folder, or scan.mjs correctly stands
// down because it is not a studio project at all. The first version of this helper
// omitted it, so two cases below "passed" for entirely the wrong reason — caught by
// this file's own control, which is why the control is here.
function repo(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** test\n');
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
}

const FAIL_TABLE = [
  '',
  '## Phase 2 (in progress)',
  '',
  '| Item | Status | Evidence |',
  '| :-- | :-- | :-- |',
  '| Automated tests | fail | `npm test` -> exit code 1, 3 failing right now |',
  '',
].join('\n');

const cases = [];

cases.push({
  id: 'F1',
  what: 'a NARROW failing table appended below a complete one',
  buggy: 'clean',
  run() {
    const d = tmp('gru-rv-f1-');
    golden(d);
    fs.appendFileSync(path.join(d, 'Dev-Memory', 'QUALITY-GATE.md'), FAIL_TABLE);
    const v = gateVerdict('quality-gate.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

cases.push({
  id: 'F1b',
  what: 'an explicitly declared non-DoD table is still excluded (capability preserved)',
  buggy: 'clean', // same in both states — this must ALWAYS be clean
  alwaysClean: true,
  run() {
    const d = tmp('gru-rv-f1b-');
    golden(d);
    fs.appendFileSync(
      path.join(d, 'Dev-Memory', 'QUALITY-GATE.md'),
      [
        '',
        '# Unrelated backlog of future feature ideas',
        '',
        '<!-- not-a-definition-of-done -->',
        '',
        '| Item | Status | Evidence |',
        '| :-- | :-- | :-- |',
        '| Improve test coverage tooling integration | todo | - |',
        '',
      ].join('\n'),
    );
    const v = gateVerdict('quality-gate.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

cases.push({
  id: 'F2',
  what: 'a header-only content register (created, never filled in)',
  buggy: 'clean',
  run() {
    const d = tmp('gru-rv-f2-');
    golden(d);
    fs.writeFileSync(
      path.join(d, 'Dev-Memory', 'CONTENT.md'),
      '# Content\n\n| Asset | Medium | Provenance | Approval | Rights | Alt-text |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n',
    );
    const v = gateVerdict('content-check.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

cases.push({
  id: 'F3a',
  what: 'an UNRELATED repo with a lookalike fixture path ships private memory',
  buggy: 'none', // "none" = stepped aside = shipped unflagged
  run() {
    const d = tmp('gru-rv-f3a-');
    // Root-anchored, exactly as the real plugin repo's .gitignore is: it hides the
    // project's OWN Dev-Memory without hiding a nested fixture of the same name.
    // A bare `Dev-Memory/` matches at any depth, which made the file under test
    // untracked and the case vacuous.
    repo(d, {
      '.gitignore': '/Dev-Memory/\n',
      'plugins/gru953-studio/hooks/test/fixtures/anything/Dev-Memory/PROGRESS.md': '# p\n',
    });
    const v = hookDecision('scan.mjs', PUSH, d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
  fixed: 'deny',
});

cases.push({
  id: 'F3b',
  what: "this plugin's own fixture stays exempt when pushed from a SUBDIRECTORY",
  buggy: 'deny',
  run() {
    const repoRoot = path.resolve(HOOKS, '..', '..', '..');
    return hookDecision('scan.mjs', PUSH, HOOKS) === 'deny' ? 'deny' : 'none';
    // (repoRoot referenced for clarity; the subdirectory is HOOKS itself)
  },
  fixed: 'none',
});

cases.push({
  id: 'F4',
  what: 'a valid publish token blanket-approves a destructive second command',
  buggy: 'allow',
  run() {
    const d = tmp('gru-rv-f4-');
    fs.mkdirSync(path.join(d, 'Dev-Memory'), { recursive: true });
    spawnSync(NODE, [path.join(HOOKS, 'confirm-publish.mjs'), d], { encoding: 'utf8' });
    const v = hookDecision('gate.mjs', PUSH + ' && rm -rf /important', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
  fixed: 'escalate',
});

cases.push({
  id: 'F6',
  what: 'ordinary prose containing a pipe, directly after a table, blocks the gate',
  buggy: 'blocked',
  run() {
    const d = tmp('gru-rv-f6-');
    golden(d);
    fs.appendFileSync(
      path.join(d, 'Dev-Memory', 'QUALITY-GATE.md'),
      'Notes: the build log is filtered with `grep -v warn | head -20`.\n',
    );
    const v = gateVerdict('quality-gate.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

cases.push({
  id: 'F7',
  what: 'quality-gate: a row marked pass whose evidence says "unverified:"',
  buggy: 'clean',
  run() {
    const d = tmp('gru-rv-f7-');
    golden(d);
    const p = path.join(d, 'Dev-Memory', 'QUALITY-GATE.md');
    fs.writeFileSync(
      p,
      fs
        .readFileSync(p, 'utf8')
        .replace(
          '| Automated tests | pass | `npm test` -> exit 0 (2026-07-21) |',
          '| Automated tests | pass | unverified: nobody has run the suite yet |',
        ),
    );
    const v = gateVerdict('quality-gate.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

for (const spelling of ['un-verified', 'not-verified']) {
  cases.push({
    id: `F8:${spelling}`,
    what: `verify-progress: evidence written as "${spelling}:" counted as proof`,
    buggy: 'clean',
    run() {
      const d = tmp('gru-rv-f8-');
      golden(d);
      const p = path.join(d, 'Dev-Memory', 'PROGRESS.md');
      fs.writeFileSync(
        p,
        fs
          .readFileSync(p, 'utf8')
          .replace(
            'verified: `npm test -- habit.test.js` -> exit 0 (2026-07-20)',
            `${spelling}: \`npm test\` -> exit 0 is what we expect once someone runs it`,
          ),
      );
      const v = gateVerdict('verify-progress.mjs', d);
      fs.rmSync(d, { recursive: true, force: true });
      return v;
    },
  });
}

cases.push({
  id: 'F9',
  what: 'unevidenced "done" bullets alongside a valid table were ignored',
  buggy: 'clean',
  run() {
    const d = tmp('gru-rv-f9-');
    golden(d);
    fs.appendFileSync(
      path.join(d, 'Dev-Memory', 'PROGRESS.md'),
      '\nAlso finished:\n\n- T9 rewrite the importer: done\n- T10 tidy the CSS: done\n',
    );
    const v = gateVerdict('verify-progress.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

cases.push({
  id: 'F10',
  what: 'a platform-specific OPTIONAL dependency makes the licence scan incomplete forever',
  buggy: 'blocked',
  run() {
    const d = tmp('gru-rv-f10-');
    fs.mkdirSync(path.join(d, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(
      path.join(d, 'package.json'),
      JSON.stringify(
        {
          name: 'x',
          version: '1.0.0',
          dependencies: { 'left-pad': '^1.0.0' },
          optionalDependencies: { fsevents: '^2.0.0' },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(d, 'node_modules', 'left-pad', 'package.json'),
      JSON.stringify({ name: 'left-pad', version: '1.0.0', license: 'MIT' }),
    );
    const v = gateVerdict('licence-scan.mjs', d);
    fs.rmSync(d, { recursive: true, force: true });
    return v;
  },
});

console.log(
  `Independent-review reproductions — expecting the ${expectBug ? 'DEFECTS' : 'FIXES'}\n`,
);
let failures = 0;
for (const c of cases) {
  const got = c.run();
  let want;
  if (c.alwaysClean) want = 'clean';
  else if (expectBug) want = c.buggy;
  else want = c.fixed !== undefined ? c.fixed : c.buggy === 'clean' ? 'blocked' : 'clean';
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${c.id.padEnd(16)} got ${String(got).padEnd(9)} want ${String(want).padEnd(9)} ${c.what}`,
  );
}

// Negative control: the unmutated golden fixture must stay clean on all five gates.
console.log('\n  Negative control — the unmutated golden fixture:');
{
  const d = tmp('gru-rv-ctl-');
  golden(d);
  for (const hook of [
    'verify-progress.mjs',
    'quality-gate.mjs',
    'traceability-check.mjs',
    'memory-integrity.mjs',
    'content-check.mjs',
  ]) {
    const got = gateVerdict(hook, d);
    const ok = got === 'clean';
    if (!ok) failures++;
    console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${hook.padEnd(24)} ${got}`);
  }
  fs.rmSync(d, { recursive: true, force: true });
}

// Control: a real secret and a real project's Dev-Memory must still be denied.
console.log('\n  Control — the scanner must still catch the real thing:');
{
  const d = tmp('gru-rv-ctl2-');
  repo(d, {
    '.gitignore': 'Dev-Memory/\n',
    'creds.txt': 'aws_key = AKIA' + 'IOSFODNN7EXAMPLE\n',
  });
  const got = hookDecision('scan.mjs', PUSH, d);
  const ok = got === 'deny';
  if (!ok) failures++;
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  a real secret in a real project -> ${got}`);
  fs.rmSync(d, { recursive: true, force: true });

  const d2 = tmp('gru-rv-ctl3-');
  repo(d2, { 'Dev-Memory/PROGRESS.md': '# p\n', 'app.txt': 'hi\n' });
  const got2 = hookDecision('scan.mjs', PUSH, d2);
  const ok2 = got2 === 'deny';
  if (!ok2) failures++;
  console.log(`    ${ok2 ? 'ok  ' : 'FAIL'}  a real project's tracked Dev-Memory -> ${got2}`);
  fs.rmSync(d2, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? 'ALL AS EXPECTED' : 'MISMATCH'} — ${failures} case(s) not in the expected state.`,
);
process.exit(failures === 0 ? 0 : 1);
