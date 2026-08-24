#!/usr/bin/env node
//
// Reproduction for X38 and X40 — one root cause, three repairs.
//
// THE ROOT CAUSE, and it was not what the register said for nine days. X38 was recorded as staleness:
// "the CLI prefers a stale build copy over the checkout". X40 was recorded as a mystery: "the X22
// reproduction passes while the live hook behaves differently". Both were framed as problems about
// OLD COPIES, and the proposed remedy was for the owner to clean up folders.
//
// It was never about age. `scan.mjs` built its "I am allowed to push my own repository" exemption from
// `HOOKS_DIR` — the directory of the RUNNING HOOK file — so the exemption only lined up with the files
// being scanned when the hook happened to live inside the very checkout it was scanning. Any other
// copy pointed the exemption at a tree that was not being scanned, matched nothing, and refused a
// clean repository. Measured: a BYTE-IDENTICAL copy of scan.mjs in another directory reproduced the
// full refusal. Staleness was sufficient and never necessary, which is why deleting folders could not
// have closed either finding.
//
// THE THREE REPAIRS, and why each is needed:
//
//   1. The exemption is anchored to the REPOSITORY BEING SCANNED, which is what it always meant —
//      "this repository may ship its own test fixtures" — and gated on `carriesThisPlugin()` so only a
//      tree actually holding this plugin's manifest may claim it. One predicate, shared with the
//      updater, because two copies of a security test that agree today is the X292 shape.
//   2. `findPluginSource()` prefers the repository SOURCE over the packaged copy when both are real,
//      with an identity guard on both candidates and a spoken notice when they differ. The old order
//      chose build output in the one situation where the order decides anything.
//   3. A session STATES which directory and version is guarding it. This is the smallest change and
//      the one that would have saved nine days: the hook always knew where it lived and never said.
//
//   case                                                        required
//   A  the same hook run from OUTSIDE the checkout                does not refuse the checkout
//   B  control: a stranger's repo cannot claim the exemption       still refused
//   C  findPluginSource prefers source when both are real          returns the checkout
//   D  control: a candidate with a foreign manifest                 not a candidate
//   E  a session names the directory and version guarding it        both present
//   F  the disclosure names the RUNNING copy, not a fixed path      a copy elsewhere names itself
//   G  control: this repository is still pushable                   no new refusal
//
// CASE F IS THE ONE THAT MATTERS MOST and it is easy to fake. A disclosure that printed a hardcoded
// path, or the path of the checkout rather than of the file actually executing, would satisfy case E
// and be worthless for the only purpose it has. So F runs a COPY of the hook from a different
// directory and requires it to name that directory.
//
// NOTHING IS PUSHED AND NOTHING IS INSTALLED. Every case hands a payload to a hook on stdin or calls a
// function; the only writes are into temporary directories, deleted at the end.
//
// Usage:
//   node X38-X40-which-copy-guards-you.mjs                # asserts the fixed state
//   node X38-X40-which-copy-guards-you.mjs --expect-bug   # asserts the defects

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const PLUGIN = join(HOOKS, '..');
const REPO = resolve(PLUGIN, '..', '..');

const problems = [];
const note = (s) => problems.push(s);
const KEY = `${'AKIA'}IOSFODNN7EXAMPLE`;

// A copy of the hooks OUTSIDE any checkout. Byte-identical — the point is that location alone changed
// the verdict, so the copy must not differ in any other way.
const ELSEWHERE = mkdtempSync(join(tmpdir(), 'x38-elsewhere-'));
mkdirSync(join(ELSEWHERE, 'hooks'), { recursive: true });
cpSync(HOOKS, join(ELSEWHERE, 'hooks'), {
  recursive: true,
  filter: (src) => !src.includes(`${'test'}/fixtures`) || src.endsWith('fixtures'),
});

const decide = (hookPath, payload) => {
  const r = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'silent', reason: '' };
  try {
    const h = JSON.parse(out).hookSpecificOutput;
    return { decision: h.permissionDecision, reason: h.permissionDecisionReason || '' };
  } catch {
    return { decision: '(unparsed)', reason: out.slice(0, 160) };
  }
};
const pushOwnRepo = (hookPath) =>
  decide(hookPath, {
    tool_name: 'Bash',
    tool_input: { command: 'git push origin development' },
    cwd: REPO,
  });

// ---- A: the same hook, run from outside the checkout ------------------------------
{
  const inside = pushOwnRepo(join(HOOKS, 'scan.mjs'));
  const outside = pushOwnRepo(join(ELSEWHERE, 'hooks', 'scan.mjs'));
  if (inside.decision === 'deny') {
    note(
      `case A: the hook INSIDE the checkout already refuses this repository (${inside.reason.slice(0, 90)}). ` +
        'That is X22, and this case cannot measure the location axis while it is true',
    );
  } else if (outside.decision === 'deny') {
    note(
      'case A: a BYTE-IDENTICAL copy of scan.mjs in another directory refuses this repository while ' +
        `the copy inside it does not (${outside.reason.slice(0, 110)}). The exemption is anchored to ` +
        "the running hook's own directory instead of to the repository being scanned, so location " +
        'alone decides the verdict — staleness was never necessary',
    );
  } else {
    console.log(
      `  A  the same hook run from elsewhere .......... ${outside.decision} (not a refusal)`,
    );
  }
}

// ---- B: control — a stranger's repo must not claim the exemption ----------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x38-stranger-'));
  execSync(`git init -q ${dir}`);
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  const fixture = join(
    dir,
    'plugins',
    'gru953-studio',
    'hooks',
    'test',
    'fixtures',
    'dev-memory',
    'golden',
    'Dev-Memory',
  );
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'nothing\n', 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  writeFileSync(join(fixture, 'sneaky.md'), `aws_key = ${KEY}\n`, 'utf8');
  execSync('git add -A', { cwd: dir });
  const got = decide(join(HOOKS, 'scan.mjs'), {
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    cwd: dir,
  });
  if (got.decision !== 'deny') {
    note(
      `control B: a repository that is not ours recreated the exempt fixture path and was NOT refused ` +
        `(${got.decision}). Anchoring the exemption to the scanned repository must be gated on that ` +
        "repository actually carrying this plugin's manifest",
    );
  } else {
    console.log("  B  control: a stranger's repo ................ still refused");
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- C and D: findPluginSource ---------------------------------------------------
{
  const CLI = join(REPO, 'clients', 'cli');
  const src = readFileSync(join(CLI, 'src', 'index.js'), 'utf8');
  const live = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  // The order, read from the shipped source: the checkout must be the first candidate.
  const order = /const valid = \[([^\]]*)\]/.exec(live);
  if (!order || !/^\s*checkout\s*,\s*packaged\s*$/.test(order[1])) {
    note(
      `case C: findPluginSource does not put the checkout first (candidates: ${order ? order[1].trim() : 'not found'}). ` +
        'In a published install only one candidate exists so the order cannot matter; in a checkout ' +
        'both exist and the packaged copy is build output',
    );
  } else {
    console.log('  C  findPluginSource prefers source ........... checkout first');
  }

  if (!/pluginManifestName\(d\)\s*===\s*'gru953-studio'/.test(live)) {
    note(
      'control D: the candidates are not filtered by manifest identity. The checkout candidate is ' +
        'three directories up, outside this package, and the tool RUNS CODE out of it — promoting it ' +
        'to first place unguarded is a real widening, not polish',
    );
  } else {
    console.log('  D  control: candidates identity-guarded ...... yes');
  }
}

// ---- E and F: the session disclosure --------------------------------------------
{
  const proj = mkdtempSync(join(tmpdir(), 'x38-proj-'));
  mkdirSync(join(proj, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(proj, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');

  const context = (hookPath) => {
    const r = spawnSync(process.execPath, [hookPath], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: proj }),
      encoding: 'utf8',
    });
    try {
      return JSON.parse((r.stdout || '').trim()).hookSpecificOutput.additionalContext || '';
    } catch {
      return '';
    }
  };

  const own = context(join(HOOKS, 'session-start.mjs'));
  if (!/guarding this session/.test(own)) {
    note(
      'case E: a session is never told which copy of the plugin is guarding it. Both X38 and X40 took ' +
        'a week to locate for exactly this reason — the hook has always known where it lives and never ' +
        'said so',
    );
  } else if (!own.includes(resolve(PLUGIN)) || !/\d+\.\d+\.\d+|unknown/.test(own)) {
    note(
      `case E: the disclosure exists but does not carry both a real path and a version: ${own.slice(-200)}`,
    );
  } else {
    console.log('  E  a session names its guard ................. path and version');
  }

  // F — the disclosure must describe the RUNNING file, not a fixed path. A hardcoded string, or the
  // checkout's path, would pass E and be useless for the only purpose the disclosure has.
  const copied = context(join(ELSEWHERE, 'hooks', 'session-start.mjs'));
  if (!/guarding this session/.test(copied)) {
    note('case F: the copy run from elsewhere produced no disclosure at all');
  } else if (!copied.includes(ELSEWHERE)) {
    note(
      `case F: a copy running from ${ELSEWHERE} did NOT name that directory — the disclosure reports a ` +
        'fixed or checkout-relative path, so it cannot reveal the one thing it exists to reveal',
    );
  } else {
    console.log('  F  the disclosure names the running copy ..... yes');
  }
  rmSync(proj, { recursive: true, force: true });
}

// ---- G: control — this repository must still be pushable ------------------------
{
  const got = pushOwnRepo(join(HOOKS, 'scan.mjs'));
  if (got.decision === 'deny') {
    note(
      `control G: this repository is refused by its own scanner (${got.reason.slice(0, 120)}) — that is X22`,
    );
  } else {
    console.log(`  G  control: this repository .................. ${got.decision}, not refused`);
  }
}

rmSync(ELSEWHERE, { recursive: true, force: true });

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
  '\nPASS: which copy of the hook runs no longer changes the verdict, only our own repository may claim ' +
    'the exemption, the tool prefers real source, and a session says what is guarding it.',
);
