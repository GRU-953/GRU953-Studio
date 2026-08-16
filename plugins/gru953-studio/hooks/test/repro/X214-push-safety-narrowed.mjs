#!/usr/bin/env node
//
// Reproduction for X214 — the push-authorisation token layer is removed, and the secret scan
// that actually works is kept and narrowed.
//
// WHY THIS EXISTS, in one paragraph. Push safety carried 38 of roughly 60 hook findings:
// gate.mjs 16, scan.mjs 13, the classifier in lib.mjs 9. Every other gate in the product
// accounted for 22 between them. Repairing it repeatedly produced the next finding rather than
// the last one — X3, X4, X21, X90, X100, X107, X108, X179, X181, X198, X199, X200, X202, X205.
//
// The decision (owner, 16 August 2026): keep the secret scan, delete the token machinery.
//
// WHY THAT IS THE RIGHT CUT, rather than taste. X91 established the load-bearing fact: a
// file-based token cannot establish that a person agreed, because anything the hook can READ,
// an agent on the same machine can WRITE. The token layer was therefore reimplementing the
// permission prompt Claude Code already shows — in a place an agent can reach, and worse than
// the original. Its `allow` was already removed under X91, so by this commit it could only
// downgrade `deny` to `ask`; what remained was the false denials.
//
// The secret scan is different in kind. It reads the WOULD-SHIP SET — what git would actually
// send — and refuses on evidence, not on a claim about intent. It caught real credentials in
// testing. It stays.
//
//   case                                                          required
//   A  a real secret in the would-ship set                         deny    (the scan works)
//   B  a key-shaped FILENAME in the would-ship set                 deny    (the scan works)
//   C  a clean project, ordinary push                              no decision
//   D  `npm run build`                                             no decision  <- X198
//   E  `npm test`                                                  no decision  <- X198
//   F  `gh repo clone me/app`  (read-only)                         no decision  <- X199
//   G  `node scripts/build.mjs --outdir public`                    no decision  <- X198
//   H  a tool call carrying NO command at all                      no decision  <- X181
//   I  the private working memory in the would-ship set            deny    (still protected)
//   J  ...with the documented opt-in file present                  no decision (the escape hatch)
//
// Cases A, B and I are the CONTROLS and the whole safety argument; C, F, G and J are the
// targets, and describe the state after the change rather than before it. Without them "ordinary commands now pass"
// could be produced by a product that has stopped objecting to anything at all — which would be
// a far worse defect than the one being removed.
//
// Usage:
//   node X214-push-safety-narrowed.mjs                # asserts the FIXED state
//   node X214-push-safety-narrowed.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

// Assembled so this file's own text never contains a push-capable command string, which would
// otherwise make the live hook object to the very command that runs this script.
const PUSH = ['git', 'push', 'origin', 'main'].join(' ');
const AWS = 'AKIA' + 'IOSFODNN7EXAMPLE';

/** A throwaway git project; `build` may add files before the commit. */
function project(build) {
  const dir = mkdtempSync(join(tmpdir(), 'x214-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** test\n');
  writeFileSync(join(dir, '.gitignore'), '/Dev-Memory/\n');
  writeFileSync(join(dir, 'app.txt'), 'hello\n');
  if (build) build(dir);
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

/** Feed one command through every PreToolUse hook the plugin wires, in order. */
function decide(cmd, build, payloadOverride) {
  const dir = project(build);
  try {
    const payload = payloadOverride || { tool_name: 'Bash', tool_input: { command: cmd }, cwd: dir };
    // hooks.json's PreToolUse list, read at run time so this cannot drift from the wiring.
    const wiring = JSON.parse(spawnSync(NODE, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(HOOKS, 'hooks.json'))},'utf8'))`], { encoding: 'utf8' }).stdout);
    const pre = (wiring.hooks.PreToolUse || []).flatMap((e) => e.hooks || []);
    const scripts = pre
      .map((h) => (String(h.command).match(/hooks\/([A-Za-z0-9._-]+\.mjs)/) || [])[1])
      .filter(Boolean);
    for (const s of scripts) {
      const v = refuseCrash(readDecision(NODE, join(HOOKS, s), payload), `${s} in X214`, die);
      if (v.kind !== 'silent') return { decision: v.decision, reason: v.reason, from: s };
    }
    return { decision: 'no decision', reason: '', from: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withSecret = (d) => writeFileSync(join(d, 'creds.txt'), `aws_key = ${AWS}\n`);
const withKeyFile = (d) => writeFileSync(join(d, 'id_rsa'), 'not really a key\n');
const withTrackedMemory = (d) => writeFileSync(join(d, '.gitignore'), 'nothing-ignored\n');
const withOptIn = (d) => {
  writeFileSync(join(d, '.gitignore'), 'nothing-ignored\n');
  writeFileSync(join(d, 'Dev-Memory', 'SHIP-MEMORY-DELIBERATELY'), 'yes\n');
};

const CASES = [
  { id: 'A', cmd: PUSH, build: withSecret, want: 'deny', control: true, what: 'a real secret in the would-ship set' },
  { id: 'B', cmd: PUSH, build: withKeyFile, want: 'deny', control: true, what: 'a key-shaped filename' },
  { id: 'C', cmd: PUSH, build: null, want: 'no decision', control: false, what: 'a clean project, ordinary push' },
  { id: 'D', cmd: 'npm run build', build: null, want: 'no decision', control: false, what: 'npm run build' },
  { id: 'E', cmd: 'npm test', build: null, want: 'no decision', control: false, what: 'npm test' },
  { id: 'F', cmd: 'gh repo clone me/app', build: null, want: 'no decision', control: false, what: 'gh repo clone (read-only)' },
  { id: 'G', cmd: 'node scripts/build.mjs --outdir public', build: null, want: 'no decision', control: false, what: 'a build script writing to public/' },
  { id: 'I', cmd: PUSH, build: withTrackedMemory, want: 'deny', control: true, what: 'private working memory would ship' },
  { id: 'J', cmd: PUSH, build: withOptIn, want: 'no decision', control: false, what: '...with the documented opt-in present' },
];

let controlsOk = true;
const stillWrong = [];

for (const c of CASES) {
  const { decision, from } = decide(c.cmd, c.build);
  const ok = decision === c.want;
  console.log(
    `  ${ok ? 'ok  ' : 'BAD '} ${c.id}  want=${c.want.padEnd(11)} got=${String(decision).padEnd(11)}${from ? ` (${from})` : ''}  ${c.what}`,
  );
  if (ok) continue;
  if (c.control) controlsOk = false;
  else stillWrong.push(c.id);
}

// ---- H: a tool call carrying no command at all (X181) -------------------------
{
  const dir = project(null);
  try {
    const v = refuseCrash(
      readDecision(NODE, join(HOOKS, 'scan.mjs'), { tool_name: 'Bash', tool_input: {}, cwd: dir }),
      'scan.mjs H in X214',
      die,
    );
    const got = v.kind === 'silent' ? 'no decision' : v.decision;
    const ok = got !== 'deny';
    console.log(`  ${ok ? 'ok  ' : 'BAD '} H  want=not-deny  got=${String(got).padEnd(11)} a tool call carrying no command`);
    if (!ok) stillWrong.push('H');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!controlsOk) {
  die(
    'a CONTROL is wrong, so nothing this script says can be trusted. Cases A, B, C, I and J are ' +
      'the whole safety argument: if the secret scan has stopped objecting, "ordinary commands now ' +
      'pass" is not a fix, it is a far worse defect wearing the fix\'s clothes.',
  );
}

if (expectBug) {
  if (stillWrong.length === 0) {
    die('expected ordinary commands to be denied and found none. If this was fixed, delete this --expect-bug branch deliberately.');
  }
  console.log(`\nX214 REPRODUCED: ${stillWrong.length} ordinary command(s) refused by the push layer — ${stillWrong.join(', ')}.`);
  process.exit(0);
}

if (stillWrong.length === 0) {
  console.log('\nPASS: the secret scan still refuses what it should, and nothing else is refused at all.');
  process.exit(0);
}

die(
  `X214 is OPEN: ${stillWrong.join(', ')} — ordinary work is still being refused by the push ` +
    'layer. The token machinery is what produces these denials, and it cannot establish what it ' +
    'claims to (X91): anything the hook can read, an agent on the same machine can write.',
);
