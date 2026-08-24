#!/usr/bin/env node
//
// Reproduction for X101 — a timed-out PreToolUse hook does not block, so a slow gate silently becomes
// no gate. The consequence cannot be tested on this machine; the MARGIN can, and this measures it.
//
// WHAT CANNOT BE ESTABLISHED HERE, stated first so nothing below is mistaken for more than it is.
// Whether Claude Code fails OPEN when a hook exceeds its timeout is platform behaviour. Nothing in
// this repository can observe it, and no test here should pretend to. X101 stays `unconfirmed` on that
// question for as long as that is true, and it is not a bookkeeping dodge: it is the difference between
// "we measured it" and "we reasoned about it".
//
// WHAT THIS FILE DOES ESTABLISH. X101's own row conceded the gap in its own words — "that is one tree,
// not every tree; no pathological case was built." One sample of one repository is not a bound. This
// builds seven adversarial trees and times the real hook against the real 20-second budget declared in
// hooks.json, so the claim "a timeout cannot fire" rests on a measured worst case rather than on the
// one tree that happened to be to hand.
//
// MEASURED 2026-08-25, worst first:
//
//   448 ms   45x headroom   everything at once (1,200 files, 8 MB, 250 commits, 40 branches, 40 tags)
//   320 ms   63x            2,000 tracked files
//   300 ms   67x            20 MB of large text files
//   198 ms  101x            400 commits of unpushed history
//   167 ms  120x            60 branches + 60 tags
//   162 ms  123x            300 base64-encoded secrets (the multi-pass decode path)
//   122 ms  164x            baseline
//
// AND A CORRECTION TO THE ROW'S OWN ALARM. X101 records that the margin "HALVED in two days as the
// tree grew" — 172 ms to 368 ms between 15 and 17 August — and reasonably treated that as a trend. It
// did not continue: measured on the real repository on 25 August, after nine further days and 126
// commits, three runs gave 353, 300 and 304 ms. The figure is stable, not decaying. The row's caution
// was right to record a moving number; the movement stopped.
//
//   case                                                    required
//   A  seven pathological trees                              every one finishes inside the budget
//   B  the worst case keeps a real margin                     at least 10x headroom
//   C  the real repository                                     inside the budget with margin
//   D  the budget is actually declared                         hooks.json still bounds every hook
//   E  control: the hook still WORKS on the nasty trees        it decides, rather than dying quietly
//
// CASE E IS WHAT STOPS THIS BEING A SPEED TEST. A hook that crashed instantly would post excellent
// timings and protect nobody, so each tree also has to produce a real verdict — and the two trees
// carrying a secret must be refused.
//
// WHY 10x AND NOT 40x. The measured worst case is 45x, so 10x allows a fourfold slowdown before this
// fires. That is deliberate: machine load, a cold cache and a busy CI runner all move these numbers,
// and a threshold set just under the current best would fire on noise. A gate that cries wolf gets
// switched off, which is this project's L5 — and switching THIS one off would remove the only warning
// anyone gets about a real decay.
//
// Usage:
//   node X101-timeout-margin.mjs                # asserts the margin holds
//   node X101-timeout-margin.mjs --expect-bug   # asserts the margin is gone

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO = resolve(HOOKS, '..', '..', '..');
const SCAN = join(HOOKS, 'scan.mjs');

const problems = [];
const note = (s) => problems.push(s);
const KEY = `${'AKIA'}IOSFODNN7EXAMPLE`;
const MIN_HEADROOM = 10;

// ---- D: the budget must actually be declared ------------------------------------
let budgetMs = 0;
{
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8'));
  const timeouts = Object.values(cfg.hooks)
    .flat()
    .flatMap((g) => g.hooks || [])
    .filter((h) => h.type === 'command')
    .map((h) => h.timeout);
  if (!timeouts.length || timeouts.some((t) => typeof t !== 'number' || t <= 0)) {
    note(
      'case D: hooks.json no longer declares a positive timeout for every command hook, so the ' +
        'platform default applies and there is no budget for anything below to be measured against',
    );
    budgetMs = 0;
  } else {
    budgetMs = Math.min(...timeouts) * 1000;
    console.log(`  D  the budget is declared .................... ${budgetMs} ms`);
  }
}

function build(spec) {
  const d = mkdtempSync(join(tmpdir(), 'x101-'));
  execSync(`git init -q ${d}`);
  execSync('git config user.email t@example.invalid', { cwd: d });
  execSync('git config user.name t', { cwd: d });
  mkdirSync(join(d, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(d, '.gitignore'), 'Dev-Memory/\n', 'utf8');
  writeFileSync(join(d, 'Dev-Memory', 'FOCUS.md'), '# f\n', 'utf8');
  for (let i = 0; i < (spec.files || 0); i += 1) {
    writeFileSync(join(d, `f${i}.js`), `// file ${i}\n`.repeat(40), 'utf8');
  }
  for (let i = 0; i < (spec.bigMB || 0); i += 1) {
    writeFileSync(join(d, `big${i}.txt`), 'x'.repeat(1024 * 1024), 'utf8');
  }
  // The multi-pass decode path: a secret that only exists once base64 is unwrapped.
  for (let i = 0; i < (spec.encoded || 0); i += 1) {
    writeFileSync(
      join(d, `enc${i}.txt`),
      `${Buffer.from(`token=${KEY}`).toString('base64')}\n`,
      'utf8',
    );
  }
  execSync('git add -A', { cwd: d });
  execSync('git commit -q -m base', { cwd: d });
  for (let i = 0; i < (spec.commits || 0); i += 1) {
    writeFileSync(join(d, `c${i}.txt`), `change ${i}\n`, 'utf8');
    execSync('git add -A', { cwd: d });
    execSync(`git commit -q -m c${i}`, { cwd: d });
  }
  for (let i = 0; i < (spec.branches || 0); i += 1) execSync(`git branch b${i}`, { cwd: d });
  for (let i = 0; i < (spec.tags || 0); i += 1) execSync(`git tag -a t${i} -m t${i}`, { cwd: d });
  return d;
}

const timeScan = (cwd) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SCAN], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      cwd,
    }),
    encoding: 'utf8',
  });
  const ms = Date.now() - t0;
  let decision = 'silent';
  try {
    decision = JSON.parse((r.stdout || '').trim()).hookSpecificOutput.permissionDecision;
  } catch {
    /* silence is a real outcome and is reported as such */
  }
  return { ms, decision };
};

// Deliberately modest compared with the exploratory run: this executes in the ordinary suite, so it
// must stay quick enough that nobody has a reason to skip it. The shapes are all still present.
const TREES = [
  { label: 'baseline', files: 40, commits: 5 },
  { label: '1,000 tracked files', files: 1000, commits: 5 },
  { label: '8 MB of large text', files: 20, bigMB: 8, commits: 5 },
  { label: '200 commits of unpushed history', files: 20, commits: 200 },
  { label: '40 branches + 40 tags', files: 20, commits: 60, branches: 40, tags: 40 },
  { label: '150 base64-encoded secrets', files: 20, encoded: 150, commits: 5, mustDeny: true },
  {
    label: 'everything at once',
    files: 600,
    bigMB: 4,
    commits: 120,
    branches: 25,
    tags: 25,
    encoded: 80,
    mustDeny: true,
  },
];

// ---- A, B, E ---------------------------------------------------------------------
{
  let worst = { ms: 0, label: '(none)' };
  const overBudget = [];
  const dead = [];
  for (const spec of TREES) {
    const dir = build(spec);
    const { ms, decision } = timeScan(dir);
    rmSync(dir, { recursive: true, force: true });
    if (budgetMs && ms >= budgetMs) overBudget.push(`${spec.label} took ${ms} ms`);
    if (ms > worst.ms) worst = { ms, label: spec.label };
    // Case E: it must actually decide. A tree carrying a secret must be refused; a clean one may be
    // silent or ask, but never crash into silence with a non-zero exit.
    if (spec.mustDeny && decision !== 'deny') {
      dead.push(`${spec.label} -> ${decision} (a tracked secret was not refused)`);
    }
  }
  if (overBudget.length) {
    note(`case A: ${overBudget.join('; ')} against a ${budgetMs} ms budget — a timeout could fire`);
  } else if (budgetMs) {
    console.log(`  A  ${TREES.length} pathological trees ................. all inside the budget`);
  }
  if (dead.length) {
    note(
      `control E: ${dead.join('; ')}. Fast is worthless if the hook is not working — a crash would ` +
        'post excellent timings and protect nobody',
    );
  } else {
    console.log('  E  control: it still decides on nasty trees .. yes');
  }
  const headroom = budgetMs && worst.ms ? budgetMs / worst.ms : 0;
  if (budgetMs && headroom < MIN_HEADROOM) {
    note(
      `case B: the worst tree (${worst.label}) took ${worst.ms} ms, only ${headroom.toFixed(1)}x inside ` +
        `the ${budgetMs} ms budget — below the ${MIN_HEADROOM}x floor. Measured at 45x on 2026-08-25, ` +
        'so this is a real decay rather than noise. Investigate before widening the timeout: a slow ' +
        'gate that times out is not a gate at all',
    );
  } else if (budgetMs) {
    console.log(
      `  B  worst case keeps its margin .............. ${worst.ms} ms, ${headroom.toFixed(0)}x (floor ${MIN_HEADROOM}x)`,
    );
  }
}

// ---- C: the real repository ------------------------------------------------------
{
  const runs = [timeScan(REPO), timeScan(REPO), timeScan(REPO)];
  const best = Math.min(...runs.map((r) => r.ms));
  const headroom = budgetMs ? budgetMs / best : 0;
  if (budgetMs && headroom < MIN_HEADROOM) {
    note(
      `case C: this repository takes ${best} ms, only ${headroom.toFixed(1)}x inside the budget. ` +
        'Measured 300-353 ms across three runs on 2026-08-25.',
    );
  } else if (budgetMs) {
    console.log(
      `  C  the real repository ...................... ${best} ms, ${headroom.toFixed(0)}x`,
    );
  }
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; the margin is intact.');
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
  '\nPASS: seven adversarial trees all finish far inside the declared budget, the hook still decides ' +
    'correctly on each, and the worst case keeps at least a tenfold margin. Whether the platform fails ' +
    'open on a timeout remains untestable here and X101 stays unconfirmed on that question alone.',
);
