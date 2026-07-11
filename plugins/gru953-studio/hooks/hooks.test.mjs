#!/usr/bin/env node
//
// hooks.test.mjs — behavioural tests for GRU953-Studio's security hooks.
// Zero dependencies: Node's built-in test runner (node --test) only.
//
// Added in the v2.0.0 gold-standard audit. Before this, CI only proved the
// hooks *parsed* (node --check); nothing proved the security logic actually
// worked — that `git push` is caught, `gh repo view` is allowed, a planted
// secret is refused, and the private-publish token cannot authorise going
// public. For a tool whose whole job is publish-safety, that was the single
// largest coverage gap. These tests close it.
//
// Run: node --test plugins/gru953-studio/hooks/hooks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isPushCapable } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}
function initRepo(dir) {
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
}
// Feed a Bash tool call to a hook script and return {code, decision}.
function runHook(script, command, cwd) {
  const input = JSON.stringify({ tool_input: { command }, cwd });
  const r = spawnSync('node', [path.join(HERE, script)], { input, encoding: 'utf8' });
  let decision = null;
  try {
    decision = JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  } catch {
    decision = null;
  }
  return { code: r.status, decision, stdout: r.stdout };
}

// ---------------------------------------------------------------------------
// isPushCapable — the shared matcher (the crown jewel; fails CLOSED)
// ---------------------------------------------------------------------------
test('isPushCapable: catches obvious push-capable commands', () => {
  for (const c of [
    'git push',
    'git push -u origin main',
    'git -C /tmp/x push origin v2.0.0',
    'gh repo create me/app --private',
    'gh repo edit me/app --visibility public',
    'gh release create v2.0.0',
    'gh pr create',
    'git -c alias.p=push p',           // git-alias definition bypass
    'git config alias.foo push',       // git-config alias bypass
    'git send-pack origin',            // plumbing push
    'gh alias set x "repo create"',    // gh alias bypass
    './deploy.sh',                     // script indirection (deploy)
    'make release',                    // makefile indirection
    'npm run publish',                 // package-manager indirection
    '',                                // empty => unknown => treat as push
  ]) {
    assert.equal(isPushCapable(c), true, `should be push-capable: "${c}"`);
  }
});

test('isPushCapable: allows ordinary non-push commands (incl. cd && gh reads)', () => {
  for (const c of [
    'ls -la',
    'git status',
    'git add .',
    'git commit -m "x"',
    'gh repo view me/app',
    'gh auth status',
    'gh api user --jq .login',
    'cd /tmp/x && gh repo view me/app',   // the real-use false-positive that 1.0.1 fixed
    'cd /tmp/x && gh auth status',
    'node build.js',                       // a build script with no deploy/release word
    'npm run test',
  ]) {
    assert.equal(isPushCapable(c), false, `should NOT be push-capable: "${c}"`);
  }
});

test('isPushCapable: catches quote-obfuscated pushes (Round-A audit)', () => {
  for (const c of [
    'git "push"',                 // double-quoted subcommand
    "git 'push'",                 // single-quoted subcommand
    '"git" push',                 // quoted binary name
    'git "push" origin main',
    'cd /tmp/x && git "push"',
  ]) {
    assert.equal(isPushCapable(c), true, `quoted push should be caught: "${c}"`);
  }
  // the quote-tolerance must not create new false positives
  for (const c of ['gitk log', 'github clone me/app', 'git pushx', 'digit push here']) {
    assert.equal(isPushCapable(c), false, `must stay clear: "${c}"`);
  }
});

test('isPushCapable: catches IFS-splice and empty-quote-splice pushes (2026-07-11 audit)', () => {
  for (const c of [
    'git${IFS}push origin main',
    'gh${IFS}repo${IFS}create x --public',
    'git pu""sh origin main',
    "git pu''sh origin main",
  ]) {
    assert.equal(isPushCapable(c), true, `obfuscated push should be caught: "${c}"`);
  }
  // normalisation must not create new false positives on ordinary commands
  for (const c of ['cd /path && gh repo view x/y --json isArchived', 'gh auth status', 'git status']) {
    assert.equal(isPushCapable(c), false, `must stay clear: "${c}"`);
  }
});

test('isPushCapable: catches non-empty quote-splice, backslash-escape, and line-continuation pushes (2026-07-11 Round 2 audit)', () => {
  for (const c of [
    'git p"u"s"h" origin main',
    "git p'u's'h' origin main",
    'git p\\ush origin main',
    'git \\\npush origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `obfuscated push should be caught: "${c}"`);
  }
  // must not create new false positives
  for (const c of ['git commit -m "fix"', "gh api user --jq '.login'", 'git log --oneline']) {
    assert.equal(isPushCapable(c), false, `must stay clear: "${c}"`);
  }
});

// ---------------------------------------------------------------------------
// scan.mjs — the secret scanner (integration, against a real temp git tree)
// ---------------------------------------------------------------------------
test('scan.mjs: allows a push when the tree is clean', () => {
  const dir = mkTmp('gru-scan-clean-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true }); // active studio run
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hello");\n');
  git(['add', 'app.js'], dir);
  const r = runHook('scan.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: denies a push when a real-looking secret is present', () => {
  const dir = mkTmp('gru-scan-secret-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  // A fake but format-valid AWS access key id.
  fs.writeFileSync(path.join(dir, 'config.txt'), 'aws_key = "AKIAIOSFODNN7EXAMPLE"\n'); // scan-allow: known test fixture
  git(['add', 'config.txt'], dir);
  const r = runHook('scan.mjs', 'git push', dir);
  assert.equal(r.decision, 'deny');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: denies a push that would ship the private Dev-Memory folder', () => {
  const dir = mkTmp('gru-scan-devmem-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), '# progress\n');
  git(['add', '-f', 'Dev-Memory/PROGRESS.md'], dir);
  const r = runHook('scan.mjs', 'git push', dir);
  assert.equal(r.decision, 'deny');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: does NOT flag ordinary code that merely contains the word token', () => {
  const dir = mkTmp('gru-scan-fp-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  // The exact false-positive class fixed in the changelog: an expression, not a literal.
  fs.writeFileSync(path.join(dir, 'lib.js'), 'const token = crypto.createHash("sha256");\n');
  git(['add', 'lib.js'], dir);
  const r = runHook('scan.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: stands down (allow) when there is no studio project', () => {
  const dir = mkTmp('gru-scan-nostudio-');
  initRepo(dir); // no Dev-Memory anywhere
  fs.writeFileSync(path.join(dir, 'config.txt'), 'aws_key = "AKIAIOSFODNN7EXAMPLE"\n'); // scan-allow: known test fixture
  git(['add', 'config.txt'], dir);
  const r = runHook('scan.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow'); // not our project => never interfere
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// gate.mjs — the publish-phase gate (two separate tokens)
// ---------------------------------------------------------------------------
test('gate.mjs: denies a push with no publish confirmation recorded', () => {
  const dir = mkTmp('gru-gate-noconfirm-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runHook('gate.mjs', 'git push', dir);
  assert.equal(r.decision, 'deny');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: allows a push after confirm-publish is recorded', () => {
  const dir = mkTmp('gru-gate-confirm-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const c = spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' });
  assert.equal(c.status, 0);
  const r = runHook('gate.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs/scan.mjs: invoking confirm-publish.mjs ITSELF as a Bash command is never blocked (2026-07-11 deadlock fix)', () => {
  // Found live: confirm-publish.mjs's own filename contains "publish", so
  // running it via the Bash tool (not spawnSync with array args, the way
  // the tests above do it) used to match the generic script/keyword
  // indirection rule and get treated as push-capable — meaning gate.mjs
  // denied the very command that RECORDS the confirmation, on the grounds
  // that no confirmation was recorded yet. An unbreakable deadlock. This
  // proves the fix by running the confirm scripts through the REAL
  // PreToolUse hook interface (runHook), which the tests above never did.
  const dir = mkTmp('gru-gate-confirmscript-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const cmd = `node "${path.join(HERE, 'confirm-publish.mjs')}" "${dir}"`;
  const scanResult = runHook('scan.mjs', cmd, dir);
  assert.equal(scanResult.decision, 'allow', 'scan.mjs must not block confirm-publish.mjs');
  const gateResult = runHook('gate.mjs', cmd, dir);
  assert.equal(gateResult.decision, 'allow', 'gate.mjs must not block confirm-publish.mjs even with no confirmation recorded yet');
  // A decoy must NOT get the same exemption: a real push chained with the
  // confirm-script name mentioned elsewhere is still caught.
  const decoy = `git push origin main; node confirm-publish.mjs`;
  assert.equal(isPushCapable(decoy), true, 'a real push must not be exempted just because the string also mentions confirm-publish.mjs');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isConfirmScriptOnly: exact basename only, never a suffix/substring match (2026-07-11 Round 3 audit fix)', () => {
  // The earlier version matched "path ends with confirm-publish.mjs" as a
  // plain substring test. That both (a) failed the confirm-script's own
  // DOCUMENTED bare usage ("node confirm-publish.mjs [projectRoot]", no
  // directory prefix), recreating the deadlock it was meant to close, and
  // (b) exempted any look-alike filename that merely ENDS with the trusted
  // name, giving an arbitrary unverified script an unconditional, unscanned
  // pass through both scan.mjs and gate.mjs. Fixed by comparing an exact
  // path.basename() match instead.
  assert.equal(isPushCapable('node confirm-publish.mjs'), false, 'bare confirm-publish.mjs invocation (its own documented usage) must be exempt');
  assert.equal(isPushCapable('node confirm-publish.mjs /some/path'), false, 'bare confirm-publish.mjs invocation with an arg must be exempt');
  assert.equal(isPushCapable('node confirm-go-public.mjs'), false, 'bare confirm-go-public.mjs invocation must be exempt');
  assert.equal(isPushCapable('node ./evil-confirm-publish.mjs'), true, 'a look-alike filename must NOT get the same free pass');
  assert.equal(isPushCapable('node /tmp/attacker/z-confirm-publish.mjs'), true, 'a look-alike filename in any directory must NOT get the same free pass');
});

test('lib.mjs normalizeForPushCheck: a genuine quoted argument survives normalization (2026-07-11 Round 4 audit fix)', () => {
  // The Round 2 quote-stripping loop stripped a quote whenever a word
  // character touched EITHER side of it, with no check on the other side —
  // so the CLOSING quote of a normal, properly paired argument (one that
  // happens to end in a letter, and is followed by whitespace/end-of-string
  // rather than another word character) also got stripped. That corrupted
  // legitimate quoted paths containing a space and misclassified them as
  // push-capable, which would make gate.mjs deny the very command that
  // records a publish confirmation whenever the project path has a space
  // in it. A quote is now only stripped when word/quote characters sit on
  // BOTH immediate sides — the actual signature of mid-word splicing.
  assert.equal(isPushCapable('node confirm-publish.mjs "/Users/aninda/My Project"'), false, 'a genuine quoted project-root argument containing a space must still be exempt');
  assert.equal(isPushCapable('node "/Users/x/plugins/hooks/confirm-publish.mjs" "/path"'), false, 'two separately quoted arguments must still be exempt');
  // The mid-word splice bypasses from Rounds 1-2 must still be caught.
  assert.equal(isPushCapable('git p"u"s"h"'), true, 'mid-word quote-splicing must still be caught after the Round 4 fix');
  assert.equal(isPushCapable('git pu""sh'), true, 'empty-quote splicing must still be caught after the Round 4 fix');
});

test('lib.mjs isConfirmScriptOnly: tolerates a trailing newline (2026-07-11 Round 4 audit fix)', () => {
  // The closing anchor only tolerated trailing [ \t], not \n — a trailing
  // newline on an otherwise-exempt confirm-script invocation fell through
  // to the generic heuristic and was misclassified as push-capable.
  assert.equal(isPushCapable('node confirm-publish.mjs \n'), false, 'a trailing newline must not defeat the confirm-script exemption');
});

test('lib.mjs isPushCapable: script-indirection heuristic also covers going-public keywords (2026-07-11 Round 4 audit fix)', () => {
  // The keyword list only covered the private-publish action
  // (deploy/release/publish/ship). This project also separately gates
  // GOING PUBLIC (isGoPublicCommand/GO-PUBLIC-APPROVED) with its own
  // vocabulary — a script indirectly changing visibility, named around
  // that action rather than "publish", fell through this heuristic
  // entirely and got an unconditional pass.
  assert.equal(isPushCapable('node make-repo-public.mjs'), true, 'a script indirectly making a repo public must be caught');
  assert.equal(isPushCapable('bash go-public.sh'), true, 'a script indirectly changing visibility must be caught');
  assert.equal(isPushCapable('node visibility-change.mjs'), true, 'a script named around visibility must be caught');
});

test('gate.mjs: private-publish token does NOT authorise going public', () => {
  const dir = mkTmp('gru-gate-tokensep-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  // Record ONLY the private-publish confirmation.
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' });
  // A go-public command must still be denied (needs its own separate token).
  const goPublic = runHook('gate.mjs', 'gh repo edit me/app --visibility public', dir);
  assert.equal(goPublic.decision, 'deny');
  // After recording the go-public confirmation, it is allowed.
  spawnSync('node', [path.join(HERE, 'confirm-go-public.mjs'), dir], { encoding: 'utf8' });
  const goPublic2 = runHook('gate.mjs', 'gh repo edit me/app --visibility public', dir);
  assert.equal(goPublic2.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: stands down (allow) when there is no studio project', () => {
  const dir = mkTmp('gru-gate-nostudio-');
  const r = runHook('gate.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});
