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
import crypto from 'node:crypto';
import { isPushCapable } from './lib.mjs';
import { detectLicenceFromText, findPubCacheRoot, classifySpdxExpr } from './licence-scan.mjs';

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

test('lib.mjs isPushCapable: `gh api` writes are push-capable; reads stay allowed (2026-07-21 audit fix)', () => {
  // `gh api` (the GitHub CLI's raw REST interface) was an undisclosed bypass of
  // BOTH gates: a write short-circuited gate.mjs's `if (!isPushCapable(CMD))
  // allow()` before the go-public gate ran. Writes (an explicit method, or a
  // body flag that only a write uses) must be caught; reads (GET, the default)
  // must stay allowed — the studio itself relies on `gh api user` and similar.
  for (const c of [
    'gh api -X PATCH repos/me/app -f visibility=public',
    'gh api --method PATCH repos/me/app -f private=false',
    'gh api -X POST /user/repos -f name=app -F private=false',
    'gh api repos/me/app -f visibility=public',        // -f implies a POST body
    'cd /tmp/x && gh api -X DELETE repos/me/app',
  ]) {
    assert.equal(isPushCapable(c), true, `gh api write must be caught: "${c}"`);
  }
  for (const c of [
    'gh api user',
    'gh api repos/me/app',
    'gh api -X GET repos/me/app',
    "gh api user --jq '.login'",
    'gh api /rate_limit',
  ]) {
    assert.equal(isPushCapable(c), false, `gh api read must stay allowed: "${c}"`);
  }
});

test('gate.mjs: a `gh api` visibility-to-public write needs the go-public token, not just the publish one (2026-07-21 audit fix)', () => {
  const dir = mkTmp('gru-gate-ghapi-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  // Record ONLY the private-publish confirmation.
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' });
  // A gh-api visibility change must still be denied (needs its own go-public token).
  const denied = runHook('gate.mjs', 'gh api -X PATCH repos/me/app -f visibility=public', dir);
  assert.equal(denied.decision, 'deny', 'gh api visibility=public must not ride the private-publish token');
  const deniedPriv = runHook('gate.mjs', 'gh api --method PATCH repos/me/app -F private=false', dir);
  assert.equal(deniedPriv.decision, 'deny', 'gh api private=false must not ride the private-publish token');
  // After recording the go-public confirmation, it is allowed.
  spawnSync('node', [path.join(HERE, 'confirm-go-public.mjs'), dir], { encoding: 'utf8' });
  const allowed = runHook('gate.mjs', 'gh api -X PATCH repos/me/app -f visibility=public', dir);
  assert.equal(allowed.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: no catastrophic backtracking on a flag-heavy non-push git command (2026-07-21 ReDoS fix)', () => {
  // The git-push token repetition used two fully-overlapping alternatives, so a
  // long flag-heavy `git` command with no trailing `push` triggered exponential
  // backtracking (measured n=28 -> 22s), running on every Bash/PowerShell/Monitor
  // command. It must now complete effectively instantly regardless of length,
  // while still classifying correctly.
  const evil = 'git ' + '-a '.repeat(80) + 'origin';
  const start = process.hrtime.bigint();
  const got = isPushCapable(evil);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(got, false, 'a flag-heavy non-push git command is not push-capable');
  assert.ok(ms < 100, `matcher must not backtrack exponentially (took ${ms.toFixed(1)}ms)`);
});

test('lib.mjs isPushCapable: catches quote/IFS-obfuscated gh commands, not just git push (2026-07-11 Round 5 CRITICAL fix)', () => {
  // The gh regexes required the literal, unquoted text "gh" — a quoted "gh"
  // token or $IFS word-splitting made isPushCapable return false, so
  // gate.mjs's first line (`if (!isPushCapable(CMD)) allow()`) exited BEFORE
  // isGoPublicCommand ever ran, letting an obfuscated `gh repo edit
  // --visibility public` through with no confirmation at all. The git-push
  // regex already tolerated quotes (Round A); the gh regexes did not.
  assert.equal(isPushCapable('"gh" repo edit me/app --visibility public'), true, 'quoted gh binary must still be caught');
  assert.equal(isPushCapable('gh "repo" "create" me/app'), true, 'quoted repo/create sub-tokens must still be caught');
  assert.equal(isPushCapable('gh${IFS}repo${IFS}create${IFS}me/app'), true, 'IFS-spliced gh repo create must be caught');
  // ordinary gh READS must stay non-push (no new false positive):
  assert.equal(isPushCapable('gh repo view me/app --json visibility'), false, 'gh repo view is a read, not a push');
  assert.equal(isPushCapable('gh auth status'), false, 'gh auth status is a read');
  assert.equal(isPushCapable('cd /x && gh repo list'), false, 'gh repo list is a read');
});

test('lib.mjs isPushCapable: catches case-varied binary names on case-insensitive filesystems (2026-07-11 Round 8 CRITICAL fix)', () => {
  // On the case-insensitive filesystems this plugin actually targets (macOS
  // APFS, Windows NTFS), PATH lookup for a binary name is ALSO
  // case-insensitive: `GIT push` and `GH repo edit` are not obfuscation,
  // bash runs them as the real git/gh binaries unchanged. Every regex here
  // matched literal lowercase text only, so `isPushCapable` returned FALSE
  // for these — reproduced live: with a real secret committed and zero
  // confirmation tokens recorded, `GIT push origin main` was allowed while
  // lowercase `git push origin main` was correctly denied.
  assert.equal(isPushCapable('GIT push origin main'), true, 'uppercase GIT push must still be caught');
  assert.equal(isPushCapable('Git Push'), true, 'mixed-case Git Push must still be caught');
  assert.equal(isPushCapable('GH repo edit me/app --visibility public'), true, 'uppercase GH repo edit must still be caught');
  assert.equal(isPushCapable('GH REPO CREATE me/app --private'), true, 'fully uppercase gh subcommand must still be caught (fail closed even though the real gh CLI itself would reject this)');
  // must not introduce a false positive on an ordinary capitalised read:
  assert.equal(isPushCapable('GH repo view me/app'), false, 'a capitalised gh READ must stay non-push');
  assert.equal(isPushCapable('GIT LOG'), false, 'a capitalised git READ must stay non-push');
});

test('lib.mjs normalizeForPushCheck: decodes ANSI-C hex/octal escapes, not just the $\'...\' wrapper (2026-07-11 Round 8 CRITICAL fix)', () => {
  // Bash decodes \xHH (hex) and \NNN (octal) escapes INSIDE $'...', so
  // $'pub\x6cic' and $'pub\154ic' both resolve to the literal text
  // `public` (the escape spells the letter "l"), and $'\x67\x68' resolves
  // to `gh` — spelling out the binary name itself. The wrapper-strip alone
  // left these escapes as literal backslash-digit text, which normalized
  // into garbage instead of the real decoded keyword, so neither the
  // keyword nor the binary-name checks ever saw them.
  assert.equal(isPushCapable("gh repo edit me/app --visibility $'pub\\x6cic'"), true, 'hex-escape-spelled "public" must be decoded and caught');
  assert.equal(isPushCapable("gh repo edit me/app --visibility $'pub\\154ic'"), true, 'octal-escape-spelled "public" must be decoded and caught');
  assert.equal(isPushCapable("$'\\x67\\x68' repo edit me/app --visibility public"), true, 'hex-escape-spelled "gh" binary name must be decoded and caught');
});

test('gate.mjs: obfuscated go-public commands still require the go-public token (2026-07-11 Round 5 CRITICAL fix)', () => {
  // With ONLY the private-publish token recorded, every obfuscated form of a
  // public-visibility command must still be denied — isGoPublicCommand now
  // normalizes the command the same way isPushCapable does and tolerates
  // quotes around its tokens and flag value.
  const dir = mkTmp('gru-gate-gopub-obf-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of [
    'gh repo edit me/app --visibility="public"',
    "gh repo edit me/app --visibility='public'",
    'gh "repo" "edit" me/app --visibility public',
    '"gh" repo edit me/app --visibility public',
    'gh repo edit me/app --visi""bility public',
    'gh repo create me/app --pub""lic',
    'gh${IFS}repo${IFS}edit${IFS}me/app${IFS}--visibility${IFS}public',
    // 2026-07-11 Round 6 security fix: backslash-escaped PUNCTUATION in the
    // flag. Bash strips the backslash and runs a real --public /
    // --visibility=public, but the earlier normalize only un-escaped a
    // backslash before a letter/digit, leaving `-\-public` intact so the
    // go-public regex missed it — a bypass with only the private token.
    'gh repo edit me/app -\\-public',
    'gh repo edit me/app \\-\\-public',
    'gh repo edit me/app --visibility\\=public',
    'gh repo create me/app -\\-public',
    // 2026-07-11 Round 7 security fix: ANSI-C quoting. Bash resolves
    // $'public' to the literal text `public` (verified live: `x=$'public';
    // echo "$x"` -> `public`), but nothing recognised the $'...' form, so
    // these passed with only the private token recorded — a bypass.
    "gh repo edit me/app --visibility $'public'",
    "gh repo edit me/app --visibility=$'public'",
    "gh repo create me/app --pub$'lic'",
  ]) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `obfuscated go-public must be denied with only the private token: ${cmd}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: does NOT mistake the plugin\'s own lowercase dev-memory SKILL for the private Dev-Memory folder (2026-07-11 Round 5 fix)', () => {
  // The DEVMEMORY_RE had an /i flag, so it matched the plugin's own
  // `skills/dev-memory/` skill directory as if it were a built project's
  // private `Dev-Memory/` folder. Once that skill was correctly committed
  // (it had been silently gitignored by the same case confusion), the
  // scanner would have blocked every push of GRU953-Studio itself. The
  // match is now case-sensitive to the canonical `Dev-Memory` name.
  const dir = mkTmp('gru-scan-skill-');
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true }); // empty marker => makes scan engage, no files to ship
  const skillDir = path.join(dir, 'plugins', 'gru953-studio', 'skills', 'dev-memory');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: dev-memory\n---\n# the dev-memory skill\n');
  git(['add', '-f', 'plugins/gru953-studio/skills/dev-memory/SKILL.md'], dir);
  const ok = runHook('scan.mjs', 'git push', dir);
  assert.equal(ok.decision, 'allow', 'the lowercase dev-memory skill must not be treated as the private Dev-Memory folder');
  // A REAL capital-D Dev-Memory tracked file must still be caught.
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), '# progress\n');
  git(['add', '-f', 'Dev-Memory/PROGRESS.md'], dir);
  const denied = runHook('scan.mjs', 'git push', dir);
  assert.equal(denied.decision, 'deny', 'a genuine Dev-Memory/ file must still be blocked');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: stands down (allow) when there is no studio project', () => {
  const dir = mkTmp('gru-gate-nostudio-');
  const r = runHook('gate.mjs', 'git push', dir);
  assert.equal(r.decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// repo-integrity.mjs / verify-progress.mjs — 2026-07-11 Round 7 audit fix.
// These two maintainer/CI scripts had ZERO test coverage before this round
// (hooks.test.mjs only ever covered the push-safety trio: scan/gate/lib) —
// exactly why the bugs below survived several prior audit rounds that all
// concentrated on push-safety. Locking in the fixes here closes that gap.
// ---------------------------------------------------------------------------
const REPO_ROOT = path.join(HERE, '..', '..', '..');

function copyRepoTo(dir) {
  fs.cpSync(REPO_ROOT, dir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.includes(`${path.sep}Dev-Memory${path.sep}`) && src !== path.join(REPO_ROOT, '.git') && src !== path.join(REPO_ROOT, 'Dev-Memory'),
  });
}
function runRepoIntegrity(dir) {
  const r = spawnSync('node', [path.join(HERE, 'repo-integrity.mjs'), dir], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

test('repo-integrity.mjs: the actual repo is clean (locks in current good state)', () => {
  const r = runRepoIntegrity(REPO_ROOT);
  assert.equal(r.json && r.json.status, 'clean', `expected clean, got: ${r.stdout}`);
});

test('repo-integrity.mjs INV5: a later, wrong role count is no longer masked by an earlier correct one', () => {
  const dir = mkTmp('gru-repointeg-mask-');
  copyRepoTo(dir);
  const readmePath = path.join(dir, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  readme = readme.replace(
    '38 specialist roles in total',
    'We once evaluated 38 specialist roles for a sibling product; 99 specialist roles in total'
  );
  fs.writeFileSync(readmePath, readme);
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'a conflicting later role-count mention must not be masked by an earlier correct one');
  assert.ok(r.json.problems.some((p) => p.includes('38') && p.includes('99')), `expected a problem naming both counts, got: ${JSON.stringify(r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV5: an unrelated historical "<n> roles" mention does not falsely block a correct README', () => {
  const dir = mkTmp('gru-repointeg-decoy-');
  copyRepoTo(dir);
  const readmePath = path.join(dir, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  readme = readme.replace(
    '38 specialist roles in total',
    '(the studio grew from 16 roles in early versions) 38 specialist roles in total'
  );
  fs.writeFileSync(readmePath, readme);
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'clean', `an unrelated "16 roles" history mention (no "specialist") must not trip this check: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV9: a missing marketplace.json is reported, not a crash', () => {
  const dir = mkTmp('gru-repointeg-crash-');
  copyRepoTo(dir);
  fs.rmSync(path.join(dir, '.claude-plugin', 'marketplace.json'));
  const r = runRepoIntegrity(dir);
  assert.equal(r.status, 1, 'must exit non-zero');
  assert.equal(r.stderr, '', `must not crash with an uncaught exception: ${r.stderr}`);
  assert.ok(r.json, `must produce parseable JSON output, not a stack trace: ${r.stdout}`);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => p.includes('marketplace.json is missing')), 'the real INV7 finding must still be reported, not lost behind a crash');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV1: a quoted frontmatter name: value is parsed like real YAML', () => {
  const dir = mkTmp('gru-repointeg-quoted-');
  copyRepoTo(dir);
  const agentFile = path.join(dir, 'plugins', 'gru953-studio', 'agents', 'architect.md');
  let text = fs.readFileSync(agentFile, 'utf8');
  text = text.replace('name: architect', 'name: "architect"');
  fs.writeFileSync(agentFile, text);
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'clean', `a quoted name: "architect" must be treated the same as an unquoted one: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-progress.mjs: a decorated "Done ✅" status is still recognised as done', () => {
  const dir = mkTmp('gru-verifyprog-decorated-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    [
      '| # | Task | Status | Notes |',
      '| :-- | :-- | :-- | :-- |',
      '| 1 | Real task | Done ✅ | no verified evidence here at all |',
    ].join('\n') + '\n'
  );
  const r = spawnSync('node', [path.join(HERE, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.equal(r.status, 1, 'a decorated "Done ✅" row with no verified: evidence must still be caught');
  assert.equal(json.status, 'BLOCKED');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-12 fresh audit engagement, Round 1 — a 4-lens panel found 2 CRITICAL
// security bypasses, 1 safe-direction false-positive, and 6 real bugs across
// the integrity/coverage hooks (repo-integrity, roster-check, verify-progress,
// licence-scan). Every finding was reproduced by direct execution before
// fixing; these tests lock every fix in.
// ---------------------------------------------------------------------------

test('lib.mjs isPushCapable: a trailing shell terminator no longer hides a real push (2026-07-12 CRITICAL fix)', () => {
  // `([ \t]|$)`-style anchors required push/send-pack/--push to be followed
  // by a space, tab, or the true end of the string — but `;`, `|`, `&`, `)`,
  // a trailing newline, etc. are equally valid real terminators bash accepts,
  // and none of them satisfied the old anchor. Reproduced live end-to-end:
  // `git push;` bypassed both scan.mjs and gate.mjs completely with a real
  // secret committed and zero confirmation tokens recorded.
  for (const c of [
    'git push;', 'git push|cat', 'git push&', 'git push\n', 'git push)',
    'git push<in.txt', 'git push>out.txt', 'git send-pack;origin',
  ]) {
    assert.equal(isPushCapable(c), true, `must be push-capable despite the trailing terminator: ${JSON.stringify(c)}`);
  }
  // isolate the --push flag path specifically (not via gh repo create/edit)
  assert.equal(isPushCapable('gh workflow run x --push;'), true, 'a trailing terminator must not hide --push either');
});

test('gate.mjs: a trailing shell terminator on --public no longer downgrades to the private-only token (2026-07-12 CRITICAL fix)', () => {
  const dir = mkTmp('gru-gate-public-anchor-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of ['gh repo edit me/app --public;', 'gh repo edit me/app --public|cat', 'gh repo edit me/app --public)']) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `a trailing terminator after --public must still require the go-public token: ${cmd}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: script-indirection requires an actual execution prefix, not just a mentioned path (2026-07-12 fix)', () => {
  // The execution-prefix group used to be optional, so a command merely
  // MENTIONING a script path and a keyword — never executing it — was
  // misclassified as push-capable. Reproduced live: a plain read-only `grep`
  // over this very test file was denied by the live hook during this audit.
  assert.equal(isPushCapable('grep -n "visibility" plugins/gru953-studio/hooks/hooks.test.mjs'), false, 'a grep merely mentioning a script path + keyword must not count as indirection');
  assert.equal(isPushCapable('echo "release notes for visibility.mjs"'), false, 'an echo merely mentioning a script name must not count as indirection');
  // real indirection must still be caught, including the newly-added python prefix
  assert.equal(isPushCapable('node evil-release.mjs'), true, 'a real node execution of a release-named script must still be caught');
  assert.equal(isPushCapable('./deploy-public.sh'), true, 'a real ./ execution must still be caught');
  assert.equal(isPushCapable('bash ship-it.sh'), true, 'a real bash execution must still be caught');
  assert.equal(isPushCapable('python make-public.py'), true, 'a real python execution must now be caught (prefix added)');
  assert.equal(isPushCapable('python3 visibility-change.py'), true, 'a real python3 execution must now be caught (prefix added)');
});

test('lib.mjs isPushCapable: bash brace expansion ({git,push}) no longer bypasses detection (2026-07-12 Round 3 CRITICAL fix)', () => {
  // Bash brace expansion turns `{git,push}` into the two separate words
  // `git push` BEFORE the command line is even parsed (confirmed live:
  // `bash -c 'echo {git,push} origin main'` -> `git push origin main`) —
  // a distinct technique from every other fix in this file, since it
  // targets the SOURCE TEXT'S inter-token separator itself (a comma inside
  // braces) rather than quoting, escaping, or case. Found by a fresh
  // adversarial pass explicitly told to combine untried techniques.
  for (const c of [
    '{git,push} origin main',
    '{GIT,PUSH} origin main;',
    '{g""it,pu""sh} origin main', // stacked with quote-splicing
  ]) {
    assert.equal(isPushCapable(c), true, `brace expansion must not hide a real push: ${JSON.stringify(c)}`);
  }
  // a legitimate command that merely contains literal brace text (not a
  // real expansion opportunity — no push keyword anywhere) must not be
  // affected.
  assert.equal(isPushCapable('echo "hello {world}"'), false, 'literal brace text with no push keyword must not be misclassified');
});

test('lib.mjs isPushCapable: a same-command variable assignment can no longer disguise the keyword inside a brace list (2026-07-12 Round 4 CRITICAL fix)', () => {
  // Removing the brace regex's `$` exclusion (the Round 3 fix's own
  // reasoning for that exclusion was wrong: `${IFS}` has no comma, so it
  // was never going to match this comma-requiring regex either way) was
  // NOT enough on its own — the disguised alternative itself (`gi$t`)
  // still isn't literally "git" once split out. The real PoC assigns the
  // variable in the SAME command string: bash brace-expands `{gi$t,push}`
  // into `gi$t push`, THEN resolves `$t`, giving a genuine `git push`
  // (confirmed live: `t=t; set -- {gi$t,push} origin main; echo "$@"` ->
  // `git push origin main`). A narrow, same-command-only variable
  // substitution step closes this without becoming a general shell
  // interpreter.
  for (const c of [
    't=t; {gi$t,push} origin main',
    'h=h; {g$h,repo,edit} me/app --public',
  ]) {
    assert.equal(isPushCapable(c), true, `a same-command variable substitution inside a brace list must not hide a real push: ${JSON.stringify(c)}`);
  }
  // ordinary VAR=value-prefixed commands with no push keyword must not be
  // misclassified by this new substitution step.
  for (const c of ['NODE_ENV=production node server.js', 'FOO=bar; echo $FOO', 'PORT=3000; node server.js --port=$PORT']) {
    assert.equal(isPushCapable(c), false, `an ordinary VAR=value command must not be misclassified as push-capable: ${JSON.stringify(c)}`);
  }
});

test('gate.mjs: brace-expanded go-public commands still require the go-public token (2026-07-12 Round 3 CRITICAL fix)', () => {
  const dir = mkTmp('gru-gate-brace-gopub-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of [
    '{gh,repo,edit} me/app --public',
    '{gh,repo,edit} me/app --visibility public',
    "{gh,repo,edit} me/app --visibility=$'public';",
  ]) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `a brace-expanded go-public command must still require its own token: ${cmd}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: variable-substitution fix survives declaration keywords, transitive chains, and JS-replace special tokens (2026-07-12 Round 5 CRITICAL fixes)', () => {
  // Three real gaps found by a final adversarial re-verification pass,
  // all confirmed live via real bash before fixing:
  // (1) `export`/`local`/`readonly`/`declare`/`typeset` prefixes defeated
  //     the assignment anchor, so `export t=t; {gi$t,push}` left $t
  //     unresolved.
  // (2) A transitive chain (`a=i; b=$a; {g${b}t,push}`) captured `b`'s
  //     value as the literal unresolved text `$a`, not `a`'s real value.
  // (3) Passing an attacker-influenced value as a plain string to JS's
  //     String.replace() let `$$`/`$&`/`` $` ``/`$'`/`$1`-`$9` in the
  //     value corrupt the normalized string — a JS-mechanics bug, not a
  //     missing shell-obfuscation case.
  for (const c of [
    'export t=t; {gi$t,push} origin main',
    'a=i; b=$a; {g${b}t,push} origin main',
    "t=$'push'; git $t origin main",
  ]) {
    assert.equal(isPushCapable(c), true, `must still catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary declaration-prefixed / no-op-value commands must not be misclassified.
  for (const c of ['export DEBUG=true; npm test', 'local x=1; echo $x', 'FOO=bar; echo $FOO']) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary declaration-prefixed command: ${JSON.stringify(c)}`);
  }
});

test('lib.mjs isPushCapable: a degenerate single-element brace range ({X..X}) no longer hides a keyword (2026-07-12 Round 5 CRITICAL fix)', () => {
  // Bash's {X..Y} sequence syntax has no comma, so the comma-requiring
  // brace-expansion regex never touched it — but the DEGENERATE case where
  // both ends are identical ({s..s} -> just "s") lets a single character
  // hide behind range syntax purely to dodge the comma requirement.
  // Confirmed live: `git pu{s..s}h origin main` -> real bash `git push
  // origin main`. Only the narrow degenerate case is expanded, not general
  // ranges (`{a..z}`, `{1..100}`), which would need materially more
  // engineering and risk a DoS on large numeric ranges.
  assert.equal(isPushCapable('git pu{s..s}h origin main'), true, 'a degenerate {s..s} range must not hide "push"');
  assert.equal(isPushCapable('{g..g}{h..h} repo edit me/app --public'), true, 'a degenerate range must not hide "gh" either');
  // a REAL, non-degenerate range (an ordinary for-loop, for example) must
  // not be misclassified.
  assert.equal(isPushCapable('for i in {1..5}; do echo $i; done'), false, 'a genuine non-degenerate range must not be misclassified');
});

test('gate.mjs: a brace list embedded in a declaration-keyword assignment value no longer bypasses the go-public gate (final-audit CRITICAL fix)', () => {
  // A declaration keyword (export/local/readonly/declare/typeset) is itself
  // a real command invocation, so its arguments undergo bash's normal
  // command-line expansion -- including brace expansion -- BEFORE the
  // keyword sees them. `export v={private,public}` therefore does not
  // assign the literal text `{private,public}`; bash expands it into TWO
  // arguments, `v=private v=public`, and export applies them left-to-right
  // with the LAST one winning (confirmed live via `bash -x`). The code used
  // to capture the raw, un-expanded value and space-join it later instead
  // of modelling last-write-wins, producing `--visibility=private public`
  // -- which no longer matched the go-public regex, defeating the
  // private-then-public separation with only the private token recorded.
  const dir = mkTmp('gru-gate-bracevar-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of [
    'export v={private,public}; gh repo edit me/app --visibility=$v',
    'declare v={private,public}; gh repo edit me/app --visibility=$v',
    'readonly v={private,public}; gh repo edit me/app --visibility=$v',
    'typeset v={private,public}; gh repo edit me/app --visibility=$v',
    'export v={priv,public}; gh repo create me/app --$v',
  ]) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `a brace-list value on a declaration-keyword assignment must not bypass the go-public gate: ${cmd}`);
  }
  // the bare, no-keyword form is a different, already-safe case (a plain
  // assignment word is NOT itself brace-expanded by bash) -- must not crash
  // and must not be misclassified as push-capable when the value simply
  // isn't a real command.
  assert.equal(isPushCapable('v={a,b}; echo $v'), false, 'the bare no-keyword form must remain unaffected by this fix');
  // ordinary declaration-prefixed commands with no brace list must stay safe.
  assert.equal(isPushCapable('export PATH=/usr/bin:$PATH; npm test'), false, 'an ordinary export must not be misclassified');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: script-indirection detection also survives a trailing shell terminator (2026-07-12 Round 2 re-verification fix)', () => {
  // The Round 1 fix above (mandatory execution prefix) shared this same file
  // with three OTHER regexes that got a LEXICAL_BOUNDARY trailing-anchor fix
  // for the identical bug class (git push;/--push;/send-pack;) — but this
  // regex's own trailing anchor was accidentally left on the old, too-narrow
  // `([ \t]|$)`, so `node evil-release.mjs;` (and the same with `|`, `&`,
  // `)`, or any of the four execution prefixes) still bypassed detection.
  // Found by a same-configuration re-verification pass specifically re-
  // attacking this round's own fixes, per the audit-loop protocol.
  for (const c of [
    'node evil-release.mjs;', 'node evil-release.mjs|cat', 'node evil-release.mjs&', 'node evil-release.mjs)',
    './evil-release.mjs;', 'bash evil-deploy.sh;', 'python3 evil-ship.py;',
  ]) {
    assert.equal(isPushCapable(c), true, `script-indirection must still be caught despite the trailing terminator: ${JSON.stringify(c)}`);
  }
});

test('licence-scan.mjs: a package with no readable package.json is surfaced as needs-review, not silently dropped (2026-07-12 SEVERE fix)', () => {
  const dir = mkTmp('gru-licscan-unreadable-');
  fs.mkdirSync(path.join(dir, 'node_modules', 'broken-pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'broken-pkg', 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root","version":"1.0.0"}');
  const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.notEqual(json.status, 'clean', 'a package with no readable package.json must not report clean');
  assert.ok(json.needsReview.some((f) => f.package === 'broken-pkg'), 'the unreadable package must be surfaced in needsReview, not dropped');
  assert.equal(r.status, 1, 'a needs-review verdict must block Publish via a non-zero exit code, not just report the status string');
  fs.rmSync(dir, { recursive: true, force: true });
});

// licence-scan.mjs Dart/Flutter support (2026-07-19 addition). The
// classification logic (detectLicenceFromText) is unit-tested directly,
// since it has no external dependency and no environment can be assumed
// to have the Dart SDK installed — this plugin's own CI (ubuntu-latest,
// Node only, see .github/workflows/ci.yml) genuinely does not. The
// scanDartFlutter() happy path (a resolved pub cache with real packages)
// is intentionally NOT spawnSync-tested end-to-end for the same reason:
// faking a resolved `dart pub deps --json` output without the real Dart
// toolchain would just be testing a mock, not the real classification
// path — which detectLicenceFromText already covers directly, matching
// how scanNode()'s package.json-parsing logic doesn't need `npm` itself
// to run to be tested.
test('licence-scan.mjs detectLicenceFromText: classifies real-world licence text correctly, permissive and copyleft alike', () => {
  const cases = [
    ['MIT License\n\nPermission is hereby granted, free of charge...', 'MIT', true],
    ['Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/', 'Apache-2.0', true],
    [
      'Redistribution and use in source and binary forms, with or without\n' +
        'modification, are permitted provided that the following conditions are\n' +
        'met:\n    * Redistributions of source code must retain...\n' +
        '    * Neither the name of Google LLC nor the names of its\n' +
        '      contributors may be used to endorse or promote products...',
      'BSD-3-Clause',
      true,
    ],
    ['Redistribution and use in source and binary forms, with or without modification, are permitted.', 'BSD-2-Clause', true],
    ['This is free and unencumbered software released into the public domain.', 'Unlicense', true],
    ['CC0 1.0 Universal', 'CC0-1.0', true],
    ['ISC License\n\nPermission to use, copy, modify...', 'ISC', true],
    ['GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007', 'GPL', false],
    ['GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3\n\nThis version of the GNU Lesser General Public License incorporates\nthe terms and conditions of version 3 of the GNU General Public License', 'LGPL', false],
    ['GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3', 'AGPL', false],
    ['Mozilla Public License, v. 2.0', 'MPL', false],
  ];
  for (const [text, expectSpdx, expectAllowed] of cases) {
    const result = detectLicenceFromText(text);
    assert.ok(result, `expected a match for ${expectSpdx}, got null for: ${text.slice(0, 40)}...`);
    assert.equal(result.spdx, expectSpdx, `wrong spdx for: ${text.slice(0, 40)}...`);
    assert.equal(result.allowed, expectAllowed, `wrong allowed verdict for ${expectSpdx}`);
  }
});

test('licence-scan.mjs detectLicenceFromText: an LGPL text mentioning "GNU General Public License" in its own preamble is not misclassified as plain GPL', () => {
  // Real LGPL licence text legitimately contains the substring "GNU General
  // Public License" (it incorporates GPL terms by reference) — the LGPL/AGPL
  // checks must run before the plain-GPL check, or this exact case would be
  // wrongly classified as GPL instead of the less restrictive LGPL.
  const lgplText = 'GNU LESSER GENERAL PUBLIC LICENSE\nThis incorporates the terms of the GNU GENERAL PUBLIC LICENSE.';
  const result = detectLicenceFromText(lgplText);
  assert.equal(result.spdx, 'LGPL');
});

test('licence-scan.mjs detectLicenceFromText: unrecognised text returns null, never a guess', () => {
  assert.equal(detectLicenceFromText('Some random README text that is not a licence at all.'), null);
  assert.equal(detectLicenceFromText(''), null);
  assert.equal(detectLicenceFromText(null), null);
});

test('licence-scan.mjs findPubCacheRoot: respects the PUB_CACHE override before falling back to the OS default', () => {
  const original = process.env.PUB_CACHE;
  try {
    process.env.PUB_CACHE = '/custom/pub/cache/path';
    assert.equal(findPubCacheRoot(), '/custom/pub/cache/path');
    delete process.env.PUB_CACHE;
    const fallback = findPubCacheRoot();
    assert.ok(fallback.includes('pub-cache') || fallback.includes('Pub'), `expected an OS-default pub cache path, got: ${fallback}`);
  } finally {
    if (original === undefined) delete process.env.PUB_CACHE;
    else process.env.PUB_CACHE = original;
  }
});

test('licence-scan.mjs: with no Dart SDK reachable, a Dart/Flutter project is reported as not-checked, never a crash or a false clean', () => {
  // Deliberately runs with a PATH that excludes any `dart` binary — this
  // dev machine happens to have Dart installed (from building the
  // Saraswati project), but this plugin's own CI (ubuntu-latest, Node
  // only) does not, and the test must be true either way, not depend on
  // what happens to be installed on whichever machine runs it.
  const dir = mkTmp('gru-licscan-dart-unresolved-');
  fs.writeFileSync(path.join(dir, 'pubspec.yaml'), 'name: test_project\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n');
  const nodeDir = path.dirname(process.execPath);
  const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: nodeDir },
  });
  assert.equal(r.stderr, '', `must not crash: ${r.stderr}`);
  const json = JSON.parse(r.stdout);
  assert.notEqual(json.status, 'clean', 'a project scanned with no Dart SDK reachable must not report clean');
  const dartResult = json.results.find((res) => res.ecosystem === 'dart/flutter');
  assert.ok(dartResult, 'a dart/flutter result must be present since pubspec.yaml exists');
  assert.equal(dartResult.checked, false, 'cannot be genuinely checked with no Dart SDK reachable');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs: a malformed (not missing) plugin.json is reported, not an uncaught crash (2026-07-12 SEVERE fix)', () => {
  const dir = mkTmp('gru-repointeg-malformed-');
  copyRepoTo(dir);
  fs.writeFileSync(path.join(dir, 'plugins', 'gru953-studio', '.claude-plugin', 'plugin.json'), '{ "version": "3.0.0", invalid json here ]');
  const r = runRepoIntegrity(dir);
  assert.equal(r.stderr, '', `must not crash with an uncaught SyntaxError: ${r.stderr}`);
  assert.ok(r.json, `must produce parseable JSON output, not a stack trace: ${r.stdout}`);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => p.includes('plugin.json is not valid JSON')), 'the malformed-JSON problem must be named explicitly');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV3: a stale reference in studio/SKILL.md\'s own companion-skill bullet list is caught (2026-07-12 SEVERE fix)', () => {
  // The old regex only matched the phrase shape "`name` skill" — the single
  // most load-bearing file in the product, studio/SKILL.md's own companion
  // list, uses a different shape ("- `name` — description") that was never
  // checked at all. Reproduced live: renaming `first-run` there to a
  // non-existent skill name still reported clean.
  const dir = mkTmp('gru-repointeg-inv3-');
  copyRepoTo(dir);
  const studioSkillPath = path.join(dir, 'plugins', 'gru953-studio', 'skills', 'studio', 'SKILL.md');
  let text = fs.readFileSync(studioSkillPath, 'utf8');
  const renamed = text.replace('`first-run`', '`first-run-renamed-stale`');
  assert.notEqual(renamed, text, 'test setup: the `first-run` bullet must exist to rename');
  fs.writeFileSync(studioSkillPath, renamed);
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'a stale companion-skill bullet reference must be caught, not reported clean');
  assert.ok(r.json.problems.some((p) => p.includes('first-run-renamed-stale')), `expected a problem naming the stale reference, got: ${JSON.stringify(r.json && r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV10: hooks.json regressing off the "Bash|PowerShell" matcher is caught (2026-07-12 Round 8 fix)', () => {
  // A reviewer proved live that reverting hooks.json's matcher back to just
  // "Bash" (silently disabling the whole publish-safety mechanism for the
  // PowerShell tool — exactly the Round 7-documented failure mode) still
  // left every other gate this project trusts before a commit fully green.
  // Nothing previously verified hooks.json's actual content, only that
  // referenced hook FILENAMES resolve (INV 4).
  const dir = mkTmp('gru-repointeg-inv10-');
  copyRepoTo(dir);
  const hooksJsonPath = path.join(dir, 'plugins', 'gru953-studio', 'hooks', 'hooks.json');
  const hj = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  hj.hooks.PreToolUse[0].matcher = 'Bash|Monitor';
  fs.writeFileSync(hooksJsonPath, JSON.stringify(hj, null, 2));
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'dropping PowerShell from the matcher must be caught, not reported clean');
  assert.ok(
    r.json.problems.some((p) => p.includes('PowerShell')),
    `expected a problem naming the missing PowerShell coverage, got: ${JSON.stringify(r.json && r.json.problems)}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV10: hooks.json regressing off the Monitor tool is caught (2026-07-12 Claude-Topics compliance fix)', () => {
  // The Monitor tool executes shell commands through the same `command`
  // field and the same Bash-style permission-rule format as Bash
  // (tools-reference.md: "Bash(npm run *)" applies to both Bash and
  // Monitor) — but was never in the matcher, so a push-capable command run
  // via Monitor bypassed both scan.mjs and gate.mjs entirely, no
  // obfuscation needed. Exactly the same class of total, silent bypass as
  // the already-fixed PowerShell gap.
  const dir = mkTmp('gru-repointeg-inv10-monitor-');
  copyRepoTo(dir);
  const hooksJsonPath = path.join(dir, 'plugins', 'gru953-studio', 'hooks', 'hooks.json');
  const hj = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  hj.hooks.PreToolUse[0].matcher = 'Bash|PowerShell';
  fs.writeFileSync(hooksJsonPath, JSON.stringify(hj, null, 2));
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'dropping Monitor from the matcher must be caught, not reported clean');
  assert.ok(
    r.json.problems.some((p) => p.includes('Monitor')),
    `expected a problem naming the missing Monitor coverage, got: ${JSON.stringify(r.json && r.json.problems)}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV10: a parenthesised/anchored pipe matcher is recognised as valid coverage, not false-BLOCKED', () => {
  // The old anchor-based regex (/(^|[|,])\s*Bash\s*($|[|,])/) required
  // "Bash"/"PowerShell" to be immediately preceded by "^", "|", or "," — so
  // a functionally-identical matcher wrapped in parens or full-string
  // anchors was wrongly reported BLOCKED, purely because "(" isn't one of
  // those three characters.
  for (const matcher of ['(Bash|PowerShell|Monitor)', '^(Bash|PowerShell|Monitor)$']) {
    const dir = mkTmp('gru-repointeg-inv10-parens-');
    copyRepoTo(dir);
    const hooksJsonPath = path.join(dir, 'plugins', 'gru953-studio', 'hooks', 'hooks.json');
    const hj = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    hj.hooks.PreToolUse[0].matcher = matcher;
    fs.writeFileSync(hooksJsonPath, JSON.stringify(hj, null, 2));
    const r = runRepoIntegrity(dir);
    assert.equal(r.json && r.json.status, 'clean', `matcher "${matcher}" is equivalent to "Bash|PowerShell" and must not be false-BLOCKED, got: ${JSON.stringify(r.json)}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repo-integrity.mjs INV10: a comma-separated matcher is recognised as valid coverage, not false-BLOCKED (2026-07-12 Claude-Topics compliance fix)', () => {
  // Claude Code's own hooks reference documents a matcher built from
  // letters/digits/_/-/spaces/,/| as "a list of exact strings separated by
  // | or , with optional surrounding whitespace" — comma IS a valid
  // OR-separator (v2.1.191+), the same as pipe. A prior version of this
  // test asserted the opposite (that "Bash,PowerShell" must be reported
  // BLOCKED) — that assertion was itself wrong, pinning in place a false
  // reading of the platform's own documented matcher syntax.
  const dir = mkTmp('gru-repointeg-inv10-comma-');
  copyRepoTo(dir);
  const hooksJsonPath = path.join(dir, 'plugins', 'gru953-studio', 'hooks', 'hooks.json');
  const hj = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
  hj.hooks.PreToolUse[0].matcher = 'Bash,PowerShell,Monitor';
  fs.writeFileSync(hooksJsonPath, JSON.stringify(hj, null, 2));
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'clean', `a comma-separated matcher is equivalent to "Bash|PowerShell|Monitor" and must not be false-BLOCKED, got: ${JSON.stringify(r.json)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('roster-check.mjs: decision-file "latest" selection sorts by actual date, not filename text (2026-07-12 MAJOR fix)', () => {
  // Decision files are named YYYY-MM-DD-*.md; the old code assumed lexical
  // sort was chronological, which breaks the moment any file uses a
  // non-zero-padded month/day. Reproduced live in the worse (false-clean)
  // direction: a stale `2026-9-5` file sorted AFTER a true-latest
  // `2026-12-01` rollback, reviving a superseded, higher baseline.
  const dir = mkTmp('gru-rostercheck-datesort-');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(dir, 'agents', `a${i}.md`), `---\nname: a${i}\n---\n`);
  fs.mkdirSync(path.join(dir, 'Dev-Memory', 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'decisions', '2026-12-01-roster-rollback.md'), 'role count: 5\n');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'decisions', '2026-9-5-roster-note.md'), 'role count: 20\n');
  const r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), dir, dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.equal(json.latestDecisionFile, '2026-12-01-roster-rollback.md', `must pick the numerically-latest file, not the lexically-latest one, got: ${json.latestDecisionFile}`);
  assert.equal(r.status, 1, '9 agents must be BLOCKED against the true-latest baseline of 5');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-progress.mjs: checks only the Status column, not every cell in the row (2026-07-12 MAJOR false-block fix)', () => {
  // A genuinely in-progress task whose Notes cell simply started with the
  // word "Done" was misclassified as a completed row via .find() across
  // every cell, then blocked for lacking evidence it was never expected to
  // have — even though its real Status cell plainly said "In Progress".
  const dir = mkTmp('gru-verifyprog-statuscol-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    [
      '| # | Task | Status | Notes |',
      '| :-- | :-- | :-- | :-- |',
      '| 1 | Ship feature X | In Progress | Done except manual QA still pending, no verification yet |',
    ].join('\n') + '\n'
  );
  const r = spawnSync('node', [path.join(HERE, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `an In Progress row must never be false-blocked just because its Notes cell starts with "Done": ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-progress.mjs: a stale "exit 0" claim no longer masks a later, live-failure claim in the same row (2026-07-12 MAJOR false-clean fix)', () => {
  const dir = mkTmp('gru-verifyprog-contradiction-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    [
      '| # | Task | Status | Notes |',
      '| :-- | :-- | :-- | :-- |',
      '| 1 | Payment webhook | Done | verified: node test.js -> exit 0 on the old build, but the current build now fails with exit 1 and has not been re-verified |',
    ].join('\n') + '\n'
  );
  const r = spawnSync('node', [path.join(HERE, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'a row documenting its own current failure must still be blocked despite an old "exit 0" mention');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-progress.mjs: a real multi-clause "done" row (exit 0 not the last clause) is not a false-block regression (2026-07-12)', () => {
  // This project's OWN real Dev-Memory has legitimate multi-clause done rows
  // where "exit 0" is deliberately not the row's final clause (more text
  // follows, e.g. a release/push confirmation) — guards against an
  // end-anchored fix that would have wrongly blocked these.
  const dir = mkTmp('gru-verifyprog-multiclause-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    [
      '| # | Task | Status | Notes |',
      '| :-- | :-- | :-- | :-- |',
      '| P13 | v2.0.1 audit-fix loop | done | Fixed bugs. verified: 15/15 tests, all gates clean on `update-clone6` -> exit 0; pushed `c9d8b50`; `gh release view v2.0.1` -> not draft, zip attached (2026-07-11). |',
    ].join('\n') + '\n'
  );
  const r = spawnSync('node', [path.join(HERE, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `a real multi-clause done row must not be a false-block regression: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: a stale publish/go-public confirmation past its TTL is no longer honoured (2026-07-12 Round 7 TOCTOU fix)', () => {
  // Neither confirmation record was ever deleted by any code path (the
  // publish skill's deletion instruction is prose the AGENT must remember,
  // and GO-PUBLIC-APPROVED had no deletion path anywhere at all) and the
  // token has no session/command nonce — so a real, legitimately-written
  // record authorised an unbounded number of LATER commands, in later
  // sessions, not just the one the user actually confirmed. A bounded
  // validity window closes the "valid forever" direction.
  const dir = mkTmp('gru-gate-ttl-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const publishToken = crypto.createHash('sha256').update(`studio-publish:${dir}`).digest('hex');
  const staleMs = Date.now() - 2 * 60 * 60 * 1000; // 2h old, past the 60-minute TTL
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PUBLISH-APPROVED'),
    `STUDIO-PUBLISH-CONFIRMED:${publishToken}\nISSUED:${staleMs}\n`,
    'utf8'
  );
  const stale = runHook('gate.mjs', 'git push origin main', dir);
  assert.equal(stale.decision, 'deny', 'a stale (past-TTL) publish confirmation must no longer be honoured');
  // a freshly-recorded confirmation must still work.
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' });
  const fresh = runHook('gate.mjs', 'git push origin main', dir);
  assert.equal(fresh.decision, 'allow', 'a fresh confirmation must still be honoured');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: array-subscript and printf -v assignment no longer bypass the push gate (2026-07-12 Round 7 CRITICAL fixes)', () => {
  // Two genuinely new assignment mechanisms, neither modelled by the
  // existing VAR=value variable-substitution step at all (a different
  // surface syntax, not a missing case of the same syntax): bash array
  // assignment + subscript access (`arr=(pull push); git "${arr[1]}"`),
  // and `printf -v NAME VALUE`. Both left the disguised keyword fully
  // unresolved, and because isPushCapable() returning false makes gate.mjs
  // allow() immediately (before it even checks for a studio project), both
  // were a complete, unconditional bypass of every gate — confirmed live
  // via real bash (`arr=(pull push); echo "${arr[1]}"` -> push; `printf -v
  // v push; echo $v` -> push) and via the real isPushCapable() before
  // fixing.
  for (const c of [
    'arr=(pull push); git "${arr[1]}" origin main',
    'printf -v v push; git $v origin main',
    'arr=(git push); ${arr[0]} ${arr[1]} origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // an array/printf -v use with no push-related content must not be misclassified.
  for (const c of ['arr=(one two); echo "${arr[1]}"', 'printf -v v hello; echo $v']) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary array/printf-v use: ${JSON.stringify(c)}`);
  }
});

test('gate.mjs: array-subscript, printf -v, and parameter-expansion-default visibility values no longer bypass the go-public gate (2026-07-12 Round 7 CRITICAL fixes)', () => {
  // Three more genuinely new mechanisms for supplying the --visibility
  // value, on top of the array/printf-v push-gate bypass above:
  // (1) array subscript (`arr=(private public); --visibility=${arr[1]}`),
  // (2) printf -v (`printf -v v public; --visibility=$v`),
  // (3) parameter-expansion default (`--visibility=${v:-public}`), which
  //     supplies a literal value with NO assignment anywhere in the string
  //     at all for any variable-resolution step to even attempt.
  // All three confirmed live via real bash and via the real
  // gate.mjs/isGoPublicCommand before fixing: with only the PRIVATE-publish
  // token recorded (no GO-PUBLIC-APPROVED), each command was `allow`ed,
  // defeating the private-then-public separately-confirmed guarantee.
  const dir = mkTmp('gru-gate-arrprintf-gopub-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of [
    'arr=(private public); gh repo edit me/app --visibility=${arr[1]}',
    'printf -v v public; gh repo edit me/app --visibility=$v',
    'gh repo edit me/app --visibility=${v:-public}',
  ]) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `a disguised visibility value must not bypass the go-public gate: ${cmd}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: scalar append-assignment (VAR+=value) no longer bypasses the push gate (2026-07-19 audit fix)', () => {
  // Bash's scalar `NAME+=value` append operator (distinct from the array
  // `+=` case, which remains an explicitly disclosed limitation) was not
  // modelled by the plain `NAME=value` regex at all, so a value built up
  // via `+=` stayed frozen at its FIRST assignment in the `known` map while
  // real bash resolves the appended value. Confirmed live before fixing:
  // `p=pu; p+=sh; git $p origin main` resolves in real bash to
  // `git push origin main`, but isPushCapable() returned false.
  for (const c of [
    'p=pu; p+=sh; git $p origin main',
    'p=pu; p+=sh; git ${p} origin main',
    'export p=pu; p+=sh; git $p origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `a scalar += appended push keyword must be caught: ${c}`);
  }
  // ordinary non-appending commands must stay clear
  assert.equal(isPushCapable('p=pu; echo $p'), false, 'an ordinary variable with no append and no push keyword must stay clear');
});

test('gate.mjs: scalar append-assignment (VAR+=value) no longer bypasses the go-public gate (2026-07-19 audit fix)', () => {
  // Same root cause as the isPushCapable case above, but against
  // isGoPublicCommand()'s --visibility value: `v=pub; v+=lic;
  // --visibility=$v` resolves in real bash to `--visibility=public`, and
  // with only the PRIVATE-publish token recorded (no GO-PUBLIC-APPROVED),
  // this previously let a repo be made public on nothing but a
  // private-publish confirmation.
  const dir = mkTmp('gru-gate-scalarappend-gopub-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  for (const cmd of [
    'v=pub; v+=lic; gh repo edit me/app --visibility=$v',
    'v=pub; v+=lic; gh repo create me/app --$v',
  ]) {
    const r = runHook('gate.mjs', cmd, dir);
    assert.equal(r.decision, 'deny', `a scalar += appended visibility value must not bypass the go-public gate: ${cmd}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: variable/arithmetic array indices, brace lists inside array literals, and array/scalar cross-contamination no longer bypass the push gate (2026-07-12 Round 8 CRITICAL fixes)', () => {
  // A re-attack pass on the Round 7 array fix (above) found it was
  // genuinely incomplete, all confirmed live before fixing:
  // (1) a variable index (`i=1; ${arr[$i]}`) and (2) a simple arithmetic
  // index (`${arr[$((0+1))]}`) both resolve to the same real element in
  // bash but were left unmodelled (only a literal digit was accepted).
  // (3) bash's array COMPOUND assignment expands a brace list INSIDE the
  // parens into multiple real elements (`arr=({pull,push})` genuinely
  // becomes a 2-element array) — a materially different rule from the
  // plain scalar case, where a bareword value is untouched unless a
  // declaration keyword makes it a real command argument; the original
  // element-splitting had no brace handling at all.
  // (4) the scalar assignment regex had no exclusion for a leading `(`,
  // so it ALSO wrongly captured every array assignment as a bogus scalar
  // (value `"(elem1 elem2)"`, parens included) — corrupting the
  // parameter-expansion-default step, which read that bogus entry
  // instead of correctly resolving the array's real element 0.
  for (const c of [
    'arr=(pull push); i=1; git "${arr[$i]}" origin main',
    'arr=(pull push); git "${arr[$((0+1))]}" origin main',
    'arr=({pull,push}); git "${arr[1]}" origin main',
    'arr=(push); git ${arr:-pull} origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary, non-push array/arithmetic/brace use must not be misclassified.
  for (const c of [
    'arr=(one two); i=1; echo "${arr[$i]}"',
    'arr=({red,blue}); echo "${arr[1]}"',
    'arr=(hello); echo ${arr:-world}',
  ]) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary array/arithmetic/brace use: ${JSON.stringify(c)}`);
  }
});

test('gate.mjs: an array/scalar cross-contamination visibility value no longer bypasses the go-public gate (2026-07-12 Round 8 CRITICAL fix)', () => {
  // The go-public analogue of the array/scalar cross-contamination fix
  // above: `arr=(public); gh repo edit me/app --visibility=${arr:-private}`
  // resolves in real bash to `--visibility=public` (the array's element 0,
  // since it's set/non-empty), but the bug read a bogus scalar entry
  // instead and fell through to the literal default "private", denying
  // the correctly-detected go-public check the confirmation it should have
  // needed for "public" — reproduced live before fixing.
  const dir = mkTmp('gru-gate-arr-contam-gopub-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  const r = runHook('gate.mjs', 'arr=(public); gh repo edit me/app --visibility=${arr:-private}', dir);
  assert.equal(r.decision, 'deny', 'the array-resolved visibility value must still require its own go-public token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: bare-name array subscripts, semicolon-glued printf -v values, and ANSI-C hex-escaped array elements no longer bypass the push gate (2026-07-12 Round 9 CRITICAL fixes)', () => {
  // A second re-attack pass on the Round 8 array rewrite found it was
  // STILL genuinely incomplete, all confirmed live before fixing:
  // (1) bash array subscripts are evaluated in ARITHMETIC context, where a
  //     bare variable name (no leading `$`) is valid and means that
  //     variable's value (`${arr[i]}`, not just `${arr[$i]}`) — the
  //     `$`/`${...}`-only requirement missed this bare form entirely.
  // (2) `printf -v i 1;` (no space before the semicolon — an entirely
  //     normal way to write this) captured the value as `"1;"` instead of
  //     `"1"`, because the unquoted-value branch used `\S+`, which doesn't
  //     stop at a shell metacharacter; the stray `;` then failed the digit
  //     test and left the variable unresolved.
  // (3) array-element parsing had its OWN, much weaker quote-handling than
  //     scalar values get — it never recognised ANSI-C `$'...'` quoting at
  //     all, so `arr=($'pu\x73h')` (which really decodes to the element
  //     `push` in bash) was corrupted into an unterminated fragment instead
  //     of being decoded.
  for (const c of [
    'arr=(pull push); i=1; git "${arr[i]}"',
    'arr=(pull push); printf -v i 1; git "${arr[$i]}"',
    "arr=($'pu\\x73h'); git \"${arr[0]}\"",
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary, non-push uses of each construct must not be misclassified.
  for (const c of [
    'arr=(one two); i=1; echo "${arr[i]}"',
    'arr=(one two); printf -v i 1; echo "${arr[$i]}"',
    "arr=($'he\\x6clo'); echo \"${arr[0]}\"",
  ]) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary use: ${JSON.stringify(c)}`);
  }
});

test('lib.mjs isPushCapable: negative array indices, array length used in arithmetic, and $IFS inside a subscript no longer bypass the push gate (2026-07-12 Round 10 fixes)', () => {
  // A systematic completeness sweep of the array-resolution code (rather
  // than another scattergun re-attack) found 3 narrow, bounded gaps worth
  // fixing directly (a further 4 broader ones — post-assignment element
  // writes, `+=` append, associative arrays, command substitution inside
  // an array element — were confirmed with the user as accepted, disclosed
  // residual limitations instead, matching this file's existing "closes
  // the concrete case, not general shell interpreter" pattern for scalar
  // command substitution):
  // (1) a negative literal index (`${arr[-1]}`, bash's "from the end"
  //     syntax) was rejected by the digit-only check.
  // (2) `${#arr[@]}` (array length) used inside a same-command arithmetic
  //     decrement (`i=${#arr[@]}; i=$((i-1))` — the realistic way anyone
  //     actually uses an array's length to reach its last valid index)
  //     was left as literal, unevaluated text.
  // (3) an ordering bug: array-subscript resolution ran BEFORE the final
  //     `$IFS` normalisation pass, so an IFS-obfuscated subscript
  //     (`${arr[$i${IFS}]}`, which real bash's word-splitting collapses to
  //     the plain index `$i`) was never recognised.
  for (const c of [
    'arr=(pull push); git "${arr[-1]}" origin main',
    'arr=(pull push); i=${#arr[@]}; i=$((i-1)); git "${arr[$i]}" origin main',
    'arr=(pull push); i=1; git "${arr[$i${IFS}]}" origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary, non-push uses of each construct must not be misclassified.
  for (const c of [
    'arr=(one two); echo "${arr[-1]}"',
    'arr=(one two); i=${#arr[@]}; i=$((i-1)); echo "${arr[$i]}"',
  ]) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary use: ${JSON.stringify(c)}`);
  }
});

test('lib.mjs isPushCapable: indirect expansion, read here-strings, positional parameters, and case-folding no longer bypass the push gate (2026-07-12 Round 13 CRITICAL fixes)', () => {
  // A dedicated adversarial pass hunting specifically for a genuinely NEW
  // class of assignment/retrieval syntax (not another array construct)
  // found four, all confirmed live before fixing:
  // (1) indirect parameter expansion (`${!ref}`) resolves to the value of
  //     the variable whose NAME is held by `ref` — a level of indirection
  //     none of the direct `$VAR`/`${VAR}` substitution modelled.
  // (2) `read NAME <<< "value"` (a here-string) is bash's third real way
  //     to assign a variable's value, a completely different surface
  //     syntax from `NAME=value` and `printf -v`.
  // (3) `set -- word1 word2` resets bash's positional parameters, so
  //     `$1`/`$2`/etc. refer to those words afterward — no variable NAME
  //     appears in the source text at all.
  // (4) case-modifying expansion (`${VAR,,}` lowercase-all, `${VAR^^}`
  //     uppercase-all) transforms an already-resolved value with no new
  //     assignment syntax at all.
  // Each one, on its own, made isPushCapable() return false for a command
  // that genuinely executes a push — the same complete, both-gates bypass
  // shape as every prior "new assignment mechanism" finding this session.
  for (const c of [
    'name=push; ref=name; git ${!ref} origin main',
    'read v <<< "push"; git $v origin main',
    'set -- push; git "$1" origin main',
    'x=PUSH; git ${x,,} origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary, non-push uses of each construct must not be misclassified.
  for (const c of [
    'name=hello; ref=name; echo ${!ref}',
    'read v <<< "hello"; echo $v',
    'set -- hello; echo "$1"',
    'x=HELLO; echo ${x,,}',
  ]) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary use: ${JSON.stringify(c)}`);
  }
});

test('gate.mjs: an indirect-expansion visibility value no longer bypasses the go-public gate (2026-07-12 Round 13 CRITICAL fix)', () => {
  // The go-public analogue of the indirect-expansion fix above:
  // `v=public; ref=v; gh repo edit me/app --visibility=${!ref}` resolves
  // in real bash to `--visibility=public`, but was `allow`ed with only the
  // private-publish token recorded before this fix — a live, end-to-end
  // bypass of the private-then-public separation gate.
  const dir = mkTmp('gru-gate-indirect-gopub-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // ONLY the private token
  const r = runHook('gate.mjs', 'v=public; ref=v; gh repo edit me/app --visibility=${!ref}', dir);
  assert.equal(r.decision, 'deny', 'the indirect-expansion-resolved visibility value must still require its own go-public token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isPushCapable: a real here-document (not here-string) feeding read, mapfile/readarray into an array, bash @-transform operators, and substring expansion no longer bypass the push gate (2026-07-12 Round 14 CRITICAL fixes)', () => {
  // A capped final adversarial pass, specifically hunting for one more
  // genuinely new bash variable-assignment/retrieval mechanism, found
  // four more, all confirmed live before fixing:
  // (1) a real here-DOCUMENT (`read v <<EOF` ... `EOF`, distinct from the
  //     here-STRING `<<<` form already fixed) — `read` consumes only the
  //     first line supplied on stdin.
  // (2) `mapfile`/`readarray` reading a here-string into an array is a
  //     structurally different array-population mechanism from the
  //     literal `NAME=(...)` compound assignment already modelled — each
  //     line of input becomes one array element.
  // (3) bash 4.4+'s `@` transformation operators (`${VAR@L}` lowercase,
  //     `${VAR@U}` uppercase) are a DISTINCT operator family from the
  //     `,,`/`^^` case-fold operators fixed in Round 13.
  // (4) substring expansion (`${VAR:offset:length}`) extracts a slice of
  //     an already-resolved value — a different colon-form from the
  //     `:-`/`:=` default-value pair.
  // Two related findings from the same round — process substitution
  // feeding `read` (`read v < <(echo push)`) and a co-process — are
  // DELIBERATELY not fixed here: both require actually executing a real
  // subprocess to know the produced value, the same already-disclosed
  // "this hook does not execute or simulate arbitrary shell commands"
  // limitation as ordinary command substitution, just reached via a
  // different syntax rather than a new bug class.
  for (const c of [
    'read v <<EOF\npush\nEOF\ngit $v origin main',
    "mapfile -t arr <<< $'pull\\npush'; git ${arr[1]} origin main",
    'x=PUSH; git ${x@L} origin main',
    'x=xxpushxx; git ${x:2:4} origin main',
  ]) {
    assert.equal(isPushCapable(c), true, `must catch the disguised push: ${JSON.stringify(c)}`);
  }
  // ordinary, non-push uses of each construct must not be misclassified.
  for (const c of [
    'read v <<EOF\nhello\nEOF\necho $v',
    "mapfile -t arr <<< $'one\\ntwo'; echo ${arr[1]}",
    'x=HELLO; echo ${x@L}',
    'x=xxhelloxx; echo ${x:2:5}',
  ]) {
    assert.equal(isPushCapable(c), false, `must not misclassify an ordinary use: ${JSON.stringify(c)}`);
  }
  // the deliberately-not-fixed process-substitution case must not crash
  // and must not be falsely reported as caught (it stays a disclosed gap).
  assert.equal(isPushCapable('read v < <(echo push); git $v origin main'), false, 'process substitution remains a disclosed, unresolved gap, not a crash or a false catch');
});

test('lib.mjs isPushCapable: declare -n namerefs remain a disclosed, documented gap (2026-07-12 Round 15)', () => {
  // Round 15 (dispatched as the absolute final round of this engagement,
  // per an explicit user cap) found bash's `declare -n` nameref variables
  // (`declare -n ref=v; v=push; echo $ref` -> `push`, a live alias
  // mechanism distinct from the `${!ref}` indirect expansion fixed in
  // Round 13) also defeat the matcher. The user then asked to stop the
  // audit loop entirely and publish, so this is documented in
  // SECURITY.md as an accepted residual limitation rather than
  // fixed. This test locks in that it fails SAFE — stays unresolved, no
  // crash, no false catch — not that it's caught.
  assert.equal(isPushCapable('declare -n ref=v; v=push; git $ref origin main'), false, 'declare -n namerefs remain a disclosed, unresolved gap, not a crash or a false catch');
});

test('lib.mjs deny(): exits 0, not 2, so Claude Code actually reads the JSON deny reason (2026-07-12 Claude-Topics compliance sweep fix)', () => {
  // Per Claude Code's own documented exit-code contract (hooks.md): "Exit 2
  // means a blocking error. Claude Code ignores stdout and any JSON in it.
  // Instead, stderr text is fed back to Claude as an error message." and
  // "Claude Code only processes JSON on exit 0. If you exit 2, any JSON is
  // ignored." deny() previously called process.exit(2) while writing its
  // reason to stdout as JSON and nothing to stderr — the tool call was still
  // blocked (exit 2 alone forces a PreToolUse block) but Claude never saw
  // WHY, since exit 2 discards the JSON and stderr was empty. The documented
  // correct pattern (hooks.md's own block-rm.sh example) is permissionDecision:
  // "deny" JSON on exit 0. This test proves both an unconfirmed push AND an
  // unconfirmed go-public attempt now exit 0 while still actually denying.
  const dir = mkTmp('gru-deny-exit-code-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });

  const pushResult = runHook('gate.mjs', 'git push origin main', dir);
  assert.equal(pushResult.code, 0, 'an unconfirmed push must exit 0 (not 2), so Claude Code actually reads the JSON deny reason instead of discarding it');
  assert.equal(pushResult.decision, 'deny', 'the push must still be denied despite exiting 0 — permissionDecision in the JSON is what blocks it, not the exit code');

  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // private token only, no go-public token
  const goPublicResult = runHook('gate.mjs', 'gh repo edit me/app --visibility public', dir);
  assert.equal(goPublicResult.code, 0, 'an unconfirmed go-public attempt must also exit 0, not 2');
  assert.equal(goPublicResult.decision, 'deny', 'the go-public attempt must still be denied despite exiting 0');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 0 guardrail spine — quality-gate.mjs (Definition of Done)
// and traceability-check.mjs (requirements ↔ tasks). Both are project-level
// CI/pre-Publish checks like verify-progress.mjs: they run against a project's
// Dev-Memory, no-op on a tree without one, and fail CLOSED on ambiguity.
// ---------------------------------------------------------------------------
function runScript(script, dir) {
  const r = spawnSync('node', [path.join(HERE, script), dir], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}
function writeGate(dir, table) {
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'QUALITY-GATE.md'), table);
}
const FULL_DOD = [
  '| Item | Status | Evidence |',
  '| :-- | :-- | :-- |',
  '| Acceptance criteria | pass | all criteria proven |',
  '| Automated tests | pass | `npm test` -> exit 0 (2026-07-19) |',
  '| Independent code review | pass | reviewer sign-off, 0 open findings |',
  '| Security / licence / privacy | pass | scan clean; licence-scan clean |',
  '| Accessibility | n/a | no user interface — CLI only |',
  '| Documentation | pass | README updated |',
  '| Reproducible build | pass | `make build` -> exit 0 on clean clone |',
  '',
].join('\n');

test('quality-gate.mjs: no Dev-Memory is a no-op (not a studio project), exit 0', () => {
  const dir = mkTmp('gru-qg-nostudio-');
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json && r.json.status, 'not a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: Dev-Memory but no QUALITY-GATE.md fails closed', () => {
  const dir = mkTmp('gru-qg-nofile-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.code, 1, 'a real studio project with no DoD record must BLOCK, not pass by absence');
  assert.equal(r.json.status, 'BLOCKED');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a complete DoD (pass + reasoned n/a) is clean', () => {
  const dir = mkTmp('gru-qg-clean-');
  writeGate(dir, FULL_DOD);
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json && r.json.status, 'clean', `expected clean: ${r.stdout}`);
  assert.equal(r.code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a required dimension cannot be hidden by omission', () => {
  const dir = mkTmp('gru-qg-omit-');
  writeGate(dir, FULL_DOD.split('\n').filter((l) => !/Security/.test(l)).join('\n'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.code, 1);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /missing required dimension: security/i.test(p)), `expected a missing-security finding: ${JSON.stringify(r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a pass with placeholder evidence is not accepted', () => {
  const dir = mkTmp('gru-qg-noevidence-');
  writeGate(dir, FULL_DOD.replace('| Automated tests | pass | `npm test` -> exit 0 (2026-07-19) |', '| Automated tests | pass | — |'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', 'a pass needs concrete evidence, not a placeholder');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: n/a without a reason is not accepted', () => {
  const dir = mkTmp('gru-qg-nareason-');
  writeGate(dir, FULL_DOD.replace('| Accessibility | n/a | no user interface — CLI only |', '| Accessibility | n/a | — |'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', 'n/a must carry a stated reason');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a row that says it is currently failing invalidates its own pass', () => {
  const dir = mkTmp('gru-qg-contradict-');
  writeGate(dir, FULL_DOD.replace('| Automated tests | pass | `npm test` -> exit 0 (2026-07-19) |', '| Automated tests | pass | passed on old build, now fails with exit 1 |'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', 'a self-contradicting row must not count as a pass');
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeReq(dir, req, prog) {
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'REQUIREMENTS.md'), req);
  if (prog !== undefined) fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), prog);
}
const REQ_HEADER = '| ID | Requirement | Phase | Tasks | Verification | Status |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n';
const PROG_HEADER = '| ID | Task | Status | Notes |\n| :-- | :-- | :-- | :-- |\n';

test('traceability-check.mjs: no Dev-Memory is a no-op, exit 0', () => {
  const dir = mkTmp('gru-tr-nostudio-');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, 'not a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: Dev-Memory but no REQUIREMENTS.md fails closed', () => {
  const dir = mkTmp('gru-tr-nofile-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.code, 1);
  assert.equal(r.json.status, 'BLOCKED');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a consistent two-way matrix is clean', () => {
  const dir = mkTmp('gru-tr-clean-');
  writeReq(dir,
    REQ_HEADER +
    '| R1 | Pause a task | 1 | T1 | `test_pause` -> exit 0 | met |\n' +
    '| R2 | Resume a task | 1 | T2 | pending | todo |\n' +
    '| R3 | Export to PDF | 3 | — | — | deferred |\n',
    PROG_HEADER +
    '| T1 | pause | done | verified: `test_pause` -> exit 0 (2026-07-19) |\n' +
    '| T2 | resume | todo | — |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'clean', `expected clean: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a live requirement with no task is a dropped requirement', () => {
  const dir = mkTmp('gru-tr-dropped-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause a task | 1 | — | — | todo |\n', PROG_HEADER + '| T1 | something | todo | — |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /maps to no task/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a deferred requirement may legitimately have no task', () => {
  const dir = mkTmp('gru-tr-deferred-');
  writeReq(dir, REQ_HEADER + '| R1 | Later feature | 3 | — | — | deferred |\n', PROG_HEADER + '| T1 | chore setup [chore] | done | verified: ok |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'clean', `deferred-with-no-task + chore-exempt task should be clean: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a task tracing back to no requirement is scope creep (unless [chore])', () => {
  const dir = mkTmp('gru-tr-creep-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause | 1 | T1 | test | met |\n', PROG_HEADER + '| T1 | pause | done | verified: ok |\n| T9 | secret extra | todo | — |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /T9.*no requirement/i.test(p)), `expected a scope-creep finding for T9: ${JSON.stringify(r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a met requirement without verification evidence is blocked', () => {
  const dir = mkTmp('gru-tr-noproof-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause | 1 | T1 | — | met |\n', PROG_HEADER + '| T1 | pause | done | verified: ok |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /no verification evidence/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a dangling task reference is caught', () => {
  const dir = mkTmp('gru-tr-dangling-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause | 1 | T1, T7 | test | todo |\n', PROG_HEADER + '| T1 | pause | todo | — |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /T7.*does not exist/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: without a PROGRESS id column the reverse check is reported not-run, never a false pass', () => {
  const dir = mkTmp('gru-tr-noidcol-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause | 1 | T1 | test | todo |\n',
    '| Task | Status | Notes |\n| :-- | :-- | :-- |\n| pause | todo | — |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'clean');
  assert.ok(r.json.notes.some((n) => /reverse.*not run/i.test(n)), `expected a disclosed not-run note: ${JSON.stringify(r.json.notes)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 1 — memory-integrity.mjs (recall index + knowledge graph
// consistency) and dashboard.mjs (self-contained HTML command centre).
// Both no-op on a tree without Dev-Memory; memory-integrity is a consistency
// check (validates what exists), dashboard is a deterministic renderer.
// ---------------------------------------------------------------------------
test('memory-integrity.mjs: no Dev-Memory is a no-op, exit 0', () => {
  const dir = mkTmp('gru-mi-nostudio-');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, 'not a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: absent INDEX/GRAPH is clean (nothing to validate)', () => {
  const dir = mkTmp('gru-mi-empty-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'clean');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: an INDEX row pointing at a missing file is a stale entry', () => {
  const dir = mkTmp('gru-mi-stale-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'INDEX.md'),
    '| Entity | Where | Summary | Tags |\n| :-- | :-- | :-- | :-- |\n| Gone | src/gone.js | deleted | x |\n| Note | (conceptual, not a path) | y | z |\n');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /src\/gone\.js/.test(p)));
  assert.ok(!r.json.problems.some((p) => /conceptual/.test(p)), 'a non-path cell must not be treated as a stale file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: a GRAPH link to an undefined node is dangling', () => {
  const dir = mkTmp('gru-mi-graph-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'GRAPH.md'),
    '## Nodes\n- [T1] task: a {tags: x}\n- [R1] requirement: b\n\n## Links\n- T1 implements R1\n- T1 depends-on T9\n');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /undefined node "T9"/.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: a well-formed graph + index is clean', () => {
  const dir = mkTmp('gru-mi-clean-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), 'x\n');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'INDEX.md'),
    '| Entity | Where | Summary | Tags |\n| :-- | :-- | :-- | :-- |\n| Tasks | Dev-Memory/PROGRESS.md | table | x |\n');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'GRAPH.md'),
    '## Nodes\n- [T1] task: a\n- [R1] requirement: b\n\n## Links\n- T1 implements R1\n');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'clean', r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: a dangling link with a punctuated or Bangla node id is still caught (2026-07-19 audit fix)', () => {
  // NODE_DEF_RE/LINK_RE previously only accepted ASCII [A-Za-z0-9_-] node
  // ids, so a link whose id contained punctuation (e.g. "T1.a") or
  // non-ASCII/Bangla text was never matched at all and silently skipped —
  // a false CLEAN even when the reference was genuinely undefined.
  const dir = mkTmp('gru-mi-graph-unicode-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'GRAPH.md'),
    '## Nodes\n- [T2] task: a\n\n## Links\n- T1.a implements T2\n- ধারণা১ implements T2\n');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /undefined node "T1\.a"/.test(p)), 'a dotted composite id must still be caught as dangling');
  assert.ok(r.json.problems.some((p) => /undefined node "ধারণা১"/.test(p)), 'a Bangla node id must still be caught as dangling');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: a stale non-ASCII or markdown-link INDEX cell is still caught (2026-07-19 audit fix)', () => {
  // LOOKS_LIKE_PATH_RE previously used ASCII-only \w for the extension form
  // and only otherwise caught cells containing a literal "/" — so a bare
  // non-ASCII filename (no slash) or a markdown-link-formatted cell (which
  // ends in ")", not the extension) both fell through and were silently
  // skipped from the stale-file check.
  const dir = mkTmp('gru-mi-stale-unicode-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'INDEX.md'),
    '| Entity | Where | Summary | Tags |\n| :-- | :-- | :-- | :-- |\n' +
    '| Note | নথি.md | missing bangla file | x |\n' +
    '| Link | [Notes](does-not-exist.md) | missing md-link target | x |\n');
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /নথি\.md/.test(p)), 'a bare non-ASCII stale filename must be caught');
  assert.ok(r.json.problems.some((p) => /does-not-exist\.md/.test(p)), 'a stale markdown-link target must be caught');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// session-start.mjs (2026-07-19 audit fix: previously had ZERO test coverage)
// ---------------------------------------------------------------------------
const EPHEMERAL_VARS = ['CLAUDE_CODE_WEB', 'CLAUDE_CODE_CLOUD', 'CLAUDE_CODE_REMOTE', 'CODESPACES', 'GITPOD_WORKSPACE_ID', 'CI'];
// `env` is the FULL environment to run with — the caller decides, rather than
// this helper silently re-merging process.env on top (which would put a
// deleted var right back if this test process itself happens to run inside
// one of these environments, as a CI or Claude Code Remote session does).
function runSessionStart(dir, env) {
  const input = JSON.stringify({ cwd: dir });
  const r = spawnSync('node', [path.join(HERE, 'session-start.mjs')], { input, encoding: 'utf8', env });
  let context = null;
  try { context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { context = null; }
  return { code: r.status, stdout: r.stdout, context };
}

function cleanEphemeralEnv(overrides) {
  const env = { ...process.env };
  for (const k of EPHEMERAL_VARS) delete env[k];
  return { ...env, ...overrides };
}

test('session-start.mjs: a studio project emits the focus-guard reminder', () => {
  const dir = mkTmp('gru-ss-studio-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runSessionStart(dir, cleanEphemeralEnv());
  assert.equal(r.code, 0);
  assert.ok(r.context && /focus-guard/i.test(r.context), 'must remind to run the focus-guard ritual');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session-start.mjs: no studio project stands down silently, exit 0', () => {
  const dir = mkTmp('gru-ss-nostudio-');
  const r = runSessionStart(dir, cleanEphemeralEnv());
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '', 'must emit nothing outside a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session-start.mjs: malformed stdin does not crash — silent stand-down', () => {
  const r = spawnSync('node', [path.join(HERE, 'session-start.mjs')], { input: 'not valid json{{{', encoding: 'utf8', env: cleanEphemeralEnv() });
  assert.equal(r.status, 0, 'malformed stdin must not crash the hook');
});

test('session-start.mjs: an ephemeral-environment marker adds the cloud-persistence paragraph', () => {
  const dir = mkTmp('gru-ss-ephemeral-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runSessionStart(dir, cleanEphemeralEnv({ CLAUDE_CODE_WEB: 'true' }));
  assert.ok(r.context && /cloud\/ephemeral session/i.test(r.context), 'must add the cloud-persistence note when the env marker is set');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session-start.mjs: without an ephemeral marker the cloud-persistence paragraph is absent', () => {
  const dir = mkTmp('gru-ss-notephemeral-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runSessionStart(dir, cleanEphemeralEnv());
  assert.ok(r.context && !/cloud\/ephemeral session/i.test(r.context), 'must not add the cloud-persistence note with no ephemeral marker');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session-start.mjs: a literal "false" string value no longer falsely triggers the ephemeral note (2026-07-19 audit fix)', () => {
  // A plain `||` truthy check treated ANY non-empty string as true, including
  // the literal text "false" — so explicitly setting CLAUDE_CODE_WEB=false
  // (with no other ephemeral marker present) still added the cloud note.
  const dir = mkTmp('gru-ss-falsestring-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runSessionStart(dir, cleanEphemeralEnv({ CLAUDE_CODE_WEB: 'false' }));
  assert.ok(r.context && !/cloud\/ephemeral session/i.test(r.context), 'CLAUDE_CODE_WEB=false must not trigger the ephemeral note');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard.mjs: no Dev-Memory is a no-op, exit 0', () => {
  const dir = mkTmp('gru-db-nostudio-');
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, 'not a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard.mjs: renders a self-contained, injection-safe HTML page', () => {
  const dir = mkTmp('gru-db-render-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'OBJECTIVE.md'), '# Expense Tracker\nbrief\n');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    '| ID | Task | Status | Notes |\n| :-- | :-- | :-- | :-- |\n| T1 | done thing | done | verified: ok |\n| T2 | <script>alert(1)</script> | todo | & "q" |\n| T3 | export | scheduled | tomorrow |\n');
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.json.status, 'written');
  const html = fs.readFileSync(path.join(dir, 'Dev-Memory', 'dashboard.html'), 'utf8');
  assert.ok(!/https?:\/\//i.test(html), 'the page must make no external references');
  assert.ok(!/<script>alert\(1\)<\/script>/.test(html), 'task text must be HTML-escaped, not rendered as markup');
  assert.ok(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(html), 'the escaped form must be present');
  assert.ok(/Expense Tracker/.test(html), 'the project name from OBJECTIVE.md should appear');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard.mjs: Dev-Memory present but PROGRESS.md unreadable is blocked, not a crash', () => {
  const dir = mkTmp('gru-db-noprog-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.code, 1);
  assert.equal(r.json.status, 'BLOCKED');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard.mjs: case-varied status values still land in the correct pill group (2026-07-19 audit fix — coverage gap)', () => {
  // Every GROUPS regex already carries an /i flag, so this behaves correctly
  // today — this test locks it in so a future refactor that drops the flag
  // on one of the seven groups is caught rather than silently misclassifying
  // that status into the generic "other" bucket.
  const dir = mkTmp('gru-db-casevariance-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    '| ID | Task | Status | Notes |\n| :-- | :-- | :-- | :-- |\n| T1 | a | DONE | x |\n| T2 | b | Blocked | x |\n');
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.json.status, 'written');
  const html = fs.readFileSync(path.join(dir, 'Dev-Memory', 'dashboard.html'), 'utf8');
  assert.ok(/pill done/.test(html), 'an upper-case "DONE" status must still land in the done pill group');
  assert.ok(/pill blocked/.test(html), 'a title-case "Blocked" status must still land in the blocked pill group');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dashboard.mjs: a header-only PROGRESS.md (zero data rows) renders the empty-board message, not a crash', () => {
  // Renders correctly today; this test locks the combination in so a future
  // regression (a crash on an empty rows array, or the Concept section
  // silently disappearing) is caught.
  const dir = mkTmp('gru-db-headeronly-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'OBJECTIVE.md'), '# My Project\nbrief\n');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PROGRESS.md'), '| ID | Task | Status | Notes |\n| :-- | :-- | :-- | :-- |\n');
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.json.status, 'written', r.stdout);
  assert.equal(r.json.tasks, 0);
  const html = fs.readFileSync(path.join(dir, 'Dev-Memory', 'dashboard.html'), 'utf8');
  assert.ok(/My Project/.test(html), 'the Concept section must still render with zero tasks');
  assert.ok(/No tasks are recorded yet/.test(html), 'the empty-board message must appear');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 2 — licence-scan.mjs grows beyond npm/Python/Dart to cover
// Rust (Cargo, real SPDX scan), JVM (Maven/Gradle, best-effort not-checked) and
// C++ (best-effort not-checked). SPDX EXPRESSION classification handles dual
// licences ("A OR B") without a false pass or a false block.
// ---------------------------------------------------------------------------
test('licence-scan classifySpdxExpr: dual "OR" is usable if any alternative is permissive', () => {
  assert.equal(classifySpdxExpr('MIT'), true);
  assert.equal(classifySpdxExpr('MIT OR Apache-2.0'), true);
  assert.equal(classifySpdxExpr('GPL-2.0 OR MIT'), true, 'a permissive alternative makes a dual licence usable');
  assert.equal(classifySpdxExpr('Apache-2.0 AND MIT'), true);
});

test('licence-scan classifySpdxExpr: all-copyleft blocks; AND-with-copyleft blocks; unknown is review', () => {
  assert.equal(classifySpdxExpr('GPL-3.0-only'), false);
  assert.equal(classifySpdxExpr('GPL-2.0 OR LGPL-3.0'), false, 'every alternative copyleft => blocked');
  assert.equal(classifySpdxExpr('MIT AND GPL-2.0'), false, 'AND with a copyleft term is not permissive');
  assert.equal(classifySpdxExpr('SomethingUnrecognised'), null);
  assert.equal(classifySpdxExpr(''), null);
});

test('licence-scan.mjs: a Maven project is honestly reported not-checked (INCOMPLETE), never a false pass', () => {
  const dir = mkTmp('gru-lic-mvn-');
  fs.writeFileSync(path.join(dir, 'pom.xml'), '<project/>\n');
  const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.equal(r.status, 1, 'an unscanned ecosystem must not exit 0 clean');
  assert.ok(/INCOMPLETE/.test(json.status));
  assert.ok(json.notChecked.some((n) => n.ecosystem === 'java/maven'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence-scan.mjs: a C++ project is honestly reported not-checked, never a false pass', () => {
  const dir = mkTmp('gru-lic-cpp-');
  fs.writeFileSync(path.join(dir, 'vcpkg.json'), '{}\n');
  const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.equal(r.status, 1);
  assert.ok(json.notChecked.some((n) => n.ecosystem === 'c++'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence-scan.mjs: a Cargo project is detected and scanned (real or honest not-checked), never dropped', () => {
  const dir = mkTmp('gru-lic-cargo-');
  fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n');
  const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], { encoding: 'utf8' });
  const json = JSON.parse(r.stdout);
  assert.ok(json.results.some((res) => res.ecosystem === 'rust/cargo'), 'the Cargo ecosystem must appear in the results, checked or not');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 command-centre enhancement — the dashboard is the organised
// command centre: Concept (OBJECTIVE), Architecture & specs (ARCHITECTURE) and
// the complete Build plan (PLAN), rendered by a small SAFE markdown renderer
// (everything escaped; a code span or injected tag never emits raw markup).
// ---------------------------------------------------------------------------
test('dashboard.mjs: renders Concept, Architecture and Build plan sections, safely', () => {
  const dir = mkTmp('gru-db-docs-');
  const dm = path.join(dir, 'Dev-Memory');
  fs.mkdirSync(dm, { recursive: true });
  fs.writeFileSync(path.join(dm, 'OBJECTIVE.md'), '# Expense Tracker\nLog expenses. **Tier: Standard.**\n');
  fs.writeFileSync(path.join(dm, 'ARCHITECTURE.md'), '# Architecture\n\n## Stack\n| Component | Choice |\n| :-- | :-- |\n| Store | local `sqlite` |\n| Evil | <img src=x onerror=alert(1)> |\n');
  fs.writeFileSync(path.join(dm, 'PLAN.md'), '# Build plan\n\n## Phase 1 — MVP\n- T1: add expense\n');
  fs.writeFileSync(path.join(dm, 'PROGRESS.md'), '| ID | Task | Status |\n| :-- | :-- | :-- |\n| T1 | add | done |\n');
  const r = runScript('dashboard.mjs', dir);
  assert.equal(r.json.status, 'written');
  assert.deepEqual(r.json.sections.sort(), ['architecture', 'objective', 'plan']);
  const html = fs.readFileSync(path.join(dm, 'dashboard.html'), 'utf8');
  assert.ok(!/https?:\/\//i.test(html), 'still self-contained');
  assert.ok(/<summary>Concept<\/summary>/.test(html));
  assert.ok(/<summary>Architecture &amp; specifications<\/summary>/.test(html));
  assert.ok(/<summary>Build plan<\/summary>/.test(html));
  assert.ok(/<th scope="col">Component<\/th>/.test(html), 'an architecture table should render as a real table with scoped (accessible) headers');
  assert.ok(/<code>sqlite<\/code>/.test(html), 'inline code should render');
  assert.ok(!/<img src=x onerror/.test(html), 'an injected tag in a doc file must be escaped, never emitted raw');
  assert.ok(/&lt;img src=x onerror/.test(html), 'the escaped form must be present');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 3 — per-phase checkpoint commits. A CHECKPOINT-APPROVED
// token authorises an ORDINARY (private) push only; it must never satisfy the
// go-public gate, and confirm-checkpoint.mjs itself must never be mistaken for
// a push (bootstrap-deadlock guard, same as confirm-publish.mjs).
// ---------------------------------------------------------------------------
test('gate.mjs: a checkpoint token authorises a private push', () => {
  const dir = mkTmp('gru-ckpt-allow-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  assert.equal(runHook('gate.mjs', 'git push origin main', dir).decision, 'deny', 'no token => deny');
  spawnSync('node', [path.join(HERE, 'confirm-checkpoint.mjs'), dir], { encoding: 'utf8' });
  assert.equal(runHook('gate.mjs', 'git push origin main', dir).decision, 'allow', 'checkpoint token => allow a private push');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: a checkpoint token does NOT authorise going public (critical)', () => {
  const dir = mkTmp('gru-ckpt-public-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-checkpoint.mjs'), dir], { encoding: 'utf8' });
  // With ONLY a checkpoint token, a visibility-changing command must still be denied.
  for (const c of ['gh repo edit me/app --visibility public', 'gh repo create me/app --public', 'gh repo edit me/app --visibility="public"']) {
    assert.equal(runHook('gate.mjs', c, dir).decision, 'deny', `checkpoint token must never authorise go-public: "${c}"`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: a checkpoint token is distinct — a publish token does not require it and vice-versa', () => {
  const dir = mkTmp('gru-ckpt-distinct-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  // publish token alone still authorises a private push (unchanged behaviour)
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' });
  assert.equal(runHook('gate.mjs', 'git push origin main', dir).decision, 'allow', 'publish token still authorises a private push');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isConfirmScriptOnly: confirm-checkpoint.mjs itself is never treated as a push', () => {
  assert.equal(isPushCapable('node confirm-checkpoint.mjs'), false);
  assert.equal(isPushCapable('node /abs/path/hooks/confirm-checkpoint.mjs /proj/root'), false);
  // The exemption is an EXACT basename match, not a substring: a chained push
  // after the confirm invocation is still caught (the compound operator defeats
  // the exemption), so the exemption can't be used to smuggle a real push.
  assert.equal(isPushCapable('node confirm-checkpoint.mjs; git push'), true);
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 4 — opt-in cloud memory persistence. A MEMORY-PERSIST token
// lets Dev-Memory be pushed to a PRIVATE branch, but ONLY: (a) the secret scan
// still runs on those files, so a secret in Dev-Memory is still blocked; and
// (b) it authorises a private push only, never going public. Both are the whole
// point of the "private only, still secret-scanned" design and are locked here.
// ---------------------------------------------------------------------------
function memPersistRepo() {
  const dir = mkTmp('gru-mempersist-');
  initRepo(dir);
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)\n');
  git(['add', 'app.js'], dir);
  git(['commit', '-qm', 'init'], dir);
  return dir;
}

test('scan.mjs: a Dev-Memory push is denied without a memory-persist token (unchanged guard)', () => {
  const dir = memPersistRepo();
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'OBJECTIVE.md'), 'my private brief\n');
  git(['add', '-f', 'Dev-Memory/OBJECTIVE.md'], dir);
  assert.equal(runHook('scan.mjs', 'git push origin memory', dir).decision, 'deny');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: with a memory-persist token, clean Dev-Memory may be pushed', () => {
  const dir = memPersistRepo();
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'OBJECTIVE.md'), 'my private brief and decisions\n');
  git(['add', '-f', 'Dev-Memory/OBJECTIVE.md'], dir);
  spawnSync('node', [path.join(HERE, 'confirm-memory-persist.mjs'), dir], { encoding: 'utf8' });
  assert.equal(runHook('scan.mjs', 'git push origin memory', dir).decision, 'allow');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: a memory-persist token NEVER lets a secret inside Dev-Memory ship (critical)', () => {
  const dir = memPersistRepo();
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'OBJECTIVE.md'), 'brief\nAKIAIOSFODNN7EXAMPLE\n');
  git(['add', '-f', 'Dev-Memory/OBJECTIVE.md'], dir);
  spawnSync('node', [path.join(HERE, 'confirm-memory-persist.mjs'), dir], { encoding: 'utf8' });
  assert.equal(runHook('scan.mjs', 'git push origin memory', dir).decision, 'deny', 'the secret scan must still run on Dev-Memory files under the token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: a memory-persist token authorises a private push but NEVER going public (critical)', () => {
  const dir = mkTmp('gru-mempersist-gate-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-memory-persist.mjs'), dir], { encoding: 'utf8' });
  assert.equal(runHook('gate.mjs', 'git push origin memory', dir).decision, 'allow', 'private push allowed by the persist token');
  for (const c of ['gh repo edit me/app --visibility public', 'gh repo create me/app --public']) {
    assert.equal(runHook('gate.mjs', c, dir).decision, 'deny', `persist token must never authorise go-public: "${c}"`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lib.mjs isConfirmScriptOnly: confirm-memory-persist.mjs itself is never treated as a push', () => {
  assert.equal(isPushCapable('node confirm-memory-persist.mjs'), false);
  assert.equal(isPushCapable('node /abs/hooks/confirm-memory-persist.mjs /proj'), false);
  assert.equal(isPushCapable('node confirm-memory-persist.mjs; git push'), true);
});

// ---------------------------------------------------------------------------
// 2026-07-19 Phase 5 — INV11 language-pack contract: a lang-* pack that omits
// one of the five standard command families (build/test/lint/format/deps) must
// be caught, so a language can never ship half-wired.
// ---------------------------------------------------------------------------
test('repo-integrity.mjs INV11: a language pack missing a command family is blocked', () => {
  const dir = mkTmp('gru-langpack-');
  copyRepoTo(dir);
  // A minimal lang-rust pack that mentions build/test/lint/deps but NOT format.
  fs.writeFileSync(
    path.join(dir, 'plugins', 'gru953-studio', 'skills', 'lang-rust', 'SKILL.md'),
    ['---', 'name: lang-rust', 'description: rust pack', '---', '', '# Rust', '',
      'build with `cargo build`, test with `cargo test`, lint with `cargo clippy`,',
      'dependencies live in `Cargo.toml`.'].join('\n') + '\n'
  );
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /lang-rust/.test(p) && /format/.test(p)), `expected a missing-format finding: ${JSON.stringify(r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 Content Creation — content-check.mjs verifies every asset in
// CONTENT.md has approval + provenance + rights (+ alt-text for media) before
// Publish. No-op when no content is declared; fails closed on an incomplete row.
// ---------------------------------------------------------------------------
function writeContent(dir, table) {
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'CONTENT.md'), table);
}
const CONTENT_HEADER = '| Asset | Medium | Source | Approved | Rights | Alt |\n| :-- | :-- | :-- | :-- | :-- | :-- |\n';

test('content-check.mjs: no Dev-Memory is a no-op, exit 0', () => {
  const dir = mkTmp('gru-cc-nostudio-');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, 'not a studio project');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: no CONTENT.md is clean (no content declared)', () => {
  const dir = mkTmp('gru-cc-none-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'clean');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: a complete manifest is clean', () => {
  const dir = mkTmp('gru-cc-clean-');
  writeContent(dir, CONTENT_HEADER +
    '| hero.png | image | Gemini image, prompt #4 | approved | AI-generated, user owns output | Family using the app |\n' +
    '| onboarding | text | Claude bn+en | approved | original | — |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'clean', r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: an unapproved (pending) asset is blocked', () => {
  const dir = mkTmp('gru-cc-pending-');
  writeContent(dir, CONTENT_HEADER + '| clip.mp4 | video | Veo, prompt #7 | pending | AI-generated | captions attached |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /not approved/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: a media asset with no alt-text is blocked (accessibility)', () => {
  const dir = mkTmp('gru-cc-alt-');
  writeContent(dir, CONTENT_HEADER + '| hero.png | image | Gemini image | approved | AI-generated | — |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /alt-text|caption|transcript/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: an asset with no rights note is blocked', () => {
  const dir = mkTmp('gru-cc-rights-');
  writeContent(dir, CONTENT_HEADER + '| onboarding | text | Claude bn+en | approved | — | — |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED');
  assert.ok(r.json.problems.some((p) => /rights/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: a Bangla-language Medium value still requires alt-text (2026-07-19 audit fix)', () => {
  // MEDIA_RE previously matched only English media keywords, so a row whose
  // Medium/Asset cells were written in Bangla (e.g. "ছবি" for "image") was
  // never classified as media and silently skipped the alt-text check —
  // a real accessibility gap given this project's Bangla+English content.
  // The check is now inverted (fail closed unless explicitly marked TEXT),
  // so this must be BLOCKED regardless of the language used.
  const dir = mkTmp('gru-cc-bangla-media-');
  writeContent(dir, CONTENT_HEADER + '| লোগো.png | ছবি | Gemini image | approved | CC0 | — |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /alt-text|caption|transcript/i.test(p)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: a Bangla-language "text" Medium value does not need alt-text', () => {
  const dir = mkTmp('gru-cc-bangla-text-');
  writeContent(dir, CONTENT_HEADER + '| স্বাগতম বার্তা | টেক্সট | Claude bn+en | approved | original | — |\n');
  const r = runScript('content-check.mjs', dir);
  assert.equal(r.json.status, 'clean', r.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-19 (v4.1.0 Phase B) licence-scan grows to Swift (SwiftPM), .NET
// (NuGet) and Go (modules) — best-effort not-checked, honestly INCOMPLETE,
// never a false pass. TypeScript is npm (already covered).
// ---------------------------------------------------------------------------
for (const [label, file] of [['swift/spm', 'Package.swift'], ['.net/nuget', 'app.csproj'], ['go/modules', 'go.mod']]) {
  test(`licence-scan.mjs: a ${label} project is honestly reported not-checked`, () => {
    const dir = mkTmp('gru-lic-newlang-');
    fs.writeFileSync(path.join(dir, file), file === 'go.mod' ? 'module x\n' : '\n');
    const r = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), dir], { encoding: 'utf8' });
    const json = JSON.parse(r.stdout);
    assert.equal(r.status, 1, 'an unscanned ecosystem must not exit 0 clean');
    assert.ok(json.notChecked.some((n) => n.ecosystem === label), `expected ${label} in notChecked: ${r.stdout}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// 2026-07-19 deep-audit fixes — scan.mjs now surfaces its redacted findings in
// the deny message (previously computed but discarded); quality-gate.mjs's
// PASS_RE now actually accepts a bare "✅"/"✓" status (previously dead code —
// a trailing \b after a symbol can never match in JS regex).
// ---------------------------------------------------------------------------
test('scan.mjs: a denied push surfaces the redacted findings (type+location), not just a generic message', () => {
  const dir = mkTmp('gru-scan-surface-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  fs.writeFileSync(path.join(dir, 'config.txt'), 'aws_key = "AKIAIOSFODNN7EXAMPLE"\n'); // scan-allow: known test fixture
  git(['add', 'config.txt'], dir);
  const r = runHook('scan.mjs', 'git push origin main', dir);
  assert.equal(r.decision, 'deny');
  const reason = JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes('"type":"secret"') && reason.includes('"file":"config.txt"'), `expected the redacted finding (type+file) surfaced in the deny reason, got: ${reason}`);
  assert.ok(!reason.includes('AKIAIOSFODNN7EXAMPLE'), 'the actual secret value must never appear, redacted or not');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a bare "✅" or "✓" status is accepted as a pass (previously dead code)', () => {
  const dir = mkTmp('gru-qg-emoji-');
  writeGate(dir, [
    '| Item | Status | Evidence |',
    '| :-- | :-- | :-- |',
    '| Acceptance criteria | ✅ | all criteria proven |',
    '| Automated tests | ✓ | `npm test` -> exit 0 (2026-07-19) |',
    '| Independent code review | pass | reviewer sign-off, 0 open findings |',
    '| Security / licence / privacy | pass | scan clean; licence-scan clean |',
    '| Accessibility | n/a | no user interface — CLI only |',
    '| Documentation | pass | README updated |',
    '| Reproducible build | pass | `make build` -> exit 0 on clean clone |',
    '',
  ].join('\n'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'clean', `a bare checkmark status must count as a pass: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: an unrelated later table with an Item+Status shape no longer leaks into required-dimension matching (2026-07-19 audit fix)', () => {
  // parseRows() previously reset and kept scanning EVERY subsequent table
  // sharing the generic Item+Status column shape, so an unrelated table
  // later in the same file (e.g. a backlog list) could inject a spurious
  // row into a required dimension's match set. Confirmed live: a
  // completely clean, all-passing DoD table followed by an unrelated
  // "Improve test coverage tooling" backlog row (status "todo") wrongly
  // BLOCKED the "tests" dimension. Only the first Item+Status table must
  // ever be read.
  const dir = mkTmp('gru-qg-unrelated-table-');
  writeGate(dir, [
    '| Item | Status | Evidence |',
    '| :-- | :-- | :-- |',
    '| Acceptance criteria | pass | all criteria proven |',
    '| Automated tests | pass | `npm test` -> exit 0 (2026-07-19) |',
    '| Independent code review | pass | reviewer sign-off, 0 open findings |',
    '| Security / licence / privacy | pass | scan clean; licence-scan clean |',
    '| Accessibility | n/a | no user interface — CLI only |',
    '| Documentation | pass | README updated |',
    '| Reproducible build | pass | `make build` -> exit 0 on clean clone |',
    '',
    '# Unrelated backlog of future feature ideas',
    '',
    '| Item | Status | Evidence |',
    '| :-- | :-- | :-- |',
    '| Improve test coverage tooling integration | todo | - |',
    '',
  ].join('\n'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'clean', `a genuinely complete DoD table must not be blocked by an unrelated later table: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a Bangla-only Item label is reported as a missing dimension, not a false pass (documented, deliberate)', () => {
  // REQUIRED dimension keywords are deliberately English-only (matching the
  // skill template's own English column/label convention for this
  // internal record) — a Bangla label fails in the SAFE direction (missing
  // dimension, never a silent pass).
  const dir = mkTmp('gru-qg-bangla-label-');
  writeGate(dir, [
    '| Item | Status | Evidence |',
    '| :-- | :-- | :-- |',
    '| গ্রহণযোগ্যতা মানদণ্ড | pass | verified manually |',
    '| Automated tests | pass | `npm test` -> exit 0 |',
    '| Independent code review | pass | reviewer sign-off |',
    '| Security / licence / privacy | pass | scan clean |',
    '| Accessibility | n/a | no user interface |',
    '| Documentation | pass | README updated |',
    '| Reproducible build | pass | `make build` -> exit 0 |',
    '',
  ].join('\n'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /missing required dimension: acceptance/i.test(p)), 'a Bangla-only label must be reported missing, never silently passed');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-21 gold-standard audit, Round 1 — a 7-lens panel (each finding
// adversarially verified against the real code) fixed 2 HIGH security issues
// (gh api gate bypass + ReDoS, tested above), and the correctness/coverage
// fixes locked in below.
// ---------------------------------------------------------------------------

test('verify-progress.mjs: an INDENTED table with an unverified "done" row is still caught (2026-07-21 false-clean fix)', () => {
  const dir = mkTmp('gru-vp-indent-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    [
      '  | # | Task | Status | Notes |',
      '  | :-- | :-- | :-- | :-- |',
      '  | 1 | Real task | done | shipped it, looks fine |',
    ].join('\n') + '\n'
  );
  const r = spawnSync('node', [path.join(HERE, 'verify-progress.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'a 2-space-indented done row with no verified: evidence must still be caught');
  assert.equal(JSON.parse(r.stdout).status, 'BLOCKED');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('content-check.mjs: a second, non-content table does not change the verdict (2026-07-21 spurious-block fix)', () => {
  const dir = mkTmp('gru-cc-2tab-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const manifest = [
    '# Content',
    '| Asset | Medium | Source | Approved | Rights | Alt |',
    '| :-- | :-- | :-- | :-- | :-- | :-- |',
    '| welcome-copy | text | Claude (prompt: greet) | approved | original content | n/a |',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'CONTENT.md'), manifest);
  const single = runScript('content-check.mjs', dir);
  assert.equal(single.json.status, 'clean', `manifest alone should be clean: ${single.stdout}`);
  // Append an unrelated second table; the verdict MUST stay clean (previously its
  // rows were swept into the content check against the first table's columns).
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'CONTENT.md'),
    manifest + '\n## Rejected drafts\n| Draft | Reason |\n| :-- | :-- |\n| hero-v1 | too busy |\n| hero-v2 | wrong colour |\n'
  );
  const withSecond = runScript('content-check.mjs', dir);
  assert.equal(withSecond.json.status, 'clean', `a second unrelated table must not cause a spurious BLOCK: ${withSecond.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('memory-integrity.mjs: a dangling GRAPH link with a trailing annotation is still caught (2026-07-21 false-clean fix)', () => {
  // LINK_RE was end-anchored, so any link row with a fourth token (a trailing
  // parenthetical note, an extra word) failed to match and was silently skipped.
  const dir = mkTmp('gru-mi-trailing-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'GRAPH.md'),
    '## Nodes\n- [T1] task: a\n\n## Links\n- T1 depends-on R99 (the payment module, not yet defined)\n'
  );
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /undefined node "R99"/.test(p)), 'a dangling link with a trailing note must still be caught');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('session-start.mjs: CI=false no longer falsely triggers the ephemeral note; CI=true does (2026-07-21 fix)', () => {
  const dirFalse = mkTmp('gru-ss-cifalse-');
  fs.mkdirSync(path.join(dirFalse, 'Dev-Memory'), { recursive: true });
  const rFalse = runSessionStart(dirFalse, cleanEphemeralEnv({ CI: 'false' }));
  assert.ok(rFalse.context && !/cloud\/ephemeral session/i.test(rFalse.context), 'CI=false must NOT add the cloud-persistence note');
  const dirTrue = mkTmp('gru-ss-citrue-');
  fs.mkdirSync(path.join(dirTrue, 'Dev-Memory'), { recursive: true });
  const rTrue = runSessionStart(dirTrue, cleanEphemeralEnv({ CI: 'true' }));
  assert.ok(rTrue.context && /cloud\/ephemeral session/i.test(rTrue.context), 'CI=true must add the cloud-persistence note');
  fs.rmSync(dirFalse, { recursive: true, force: true });
  fs.rmSync(dirTrue, { recursive: true, force: true });
});

// --- subagent-statusline.mjs (2026-07-21: previously ZERO test coverage) -----
function runStatusline(input) {
  const r = spawnSync('node', [path.join(HERE, 'subagent-statusline.mjs')], { input: JSON.stringify(input), encoding: 'utf8' });
  const lines = r.stdout.trim() ? r.stdout.trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { code: r.status, stdout: r.stdout, lines };
}

test('subagent-statusline.mjs: renders a friendly line for current studio roles, incl. the newer ones (2026-07-21 drift fix)', () => {
  // The ROLES set is now derived from agents/ at runtime, so a role added since
  // v3.6.0/v4.1.0 (content-director, python-developer, …) is recognised too —
  // the previous hardcoded 23-name Set had silently dropped 15 current roles.
  const out = runStatusline({
    columns: 80,
    tasks: [
      { id: 't1', name: 'builder', status: 'running' },
      { id: 't2', name: 'content-director', status: 'running' },        // added v4.1.0
      { id: 't3', name: 'python-developer', status: 'completed' },      // added v3.6.0
      { id: 't4', name: 'gru953-studio:tester', status: 'running' },    // qualified form
    ],
  });
  assert.equal(out.code, 0);
  const byId = Object.fromEntries(out.lines.map((l) => [l.id, l.content]));
  assert.equal(byId.t1, 'GRU953-Studio — builder (working)');
  assert.ok(byId.t2 && /content director \(working\)/.test(byId.t2), 'a role added in v4.1.0 must now be recognised');
  assert.ok(byId.t3 && /python developer \(done\)/.test(byId.t3), 'a language specialist must be recognised, and completed -> (done)');
  assert.ok(byId.t4 && /tester \(working\)/.test(byId.t4), 'the qualified plugin:role form must match');
});

test('subagent-statusline.mjs: leaves non-studio agents, id-less tasks and bad input at the default (2026-07-21 coverage)', () => {
  const out = runStatusline({
    columns: 80,
    tasks: [
      { id: 'x1', name: 'some-other-plugin-agent', status: 'running' }, // not ours
      { name: 'builder', status: 'running' },                            // no id -> skipped
    ],
  });
  assert.equal(out.lines.length, 0, 'no output line for a non-studio agent or an id-less task');
  const bad = spawnSync('node', [path.join(HERE, 'subagent-statusline.mjs')], { input: 'not json{{', encoding: 'utf8' });
  assert.equal(bad.status, 0, 'unparseable stdin must not crash');
  assert.equal(bad.stdout.trim(), '', 'unparseable stdin emits nothing');
});

// --- self-heal-nudge.mjs (2026-07-21: previously ZERO test coverage) ---------
function runSelfHeal(input) {
  const r = spawnSync('node', [path.join(HERE, 'self-heal-nudge.mjs')], { input: JSON.stringify(input), encoding: 'utf8' });
  let ctx = null;
  try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { ctx = null; }
  return { code: r.status, stdout: r.stdout, ctx };
}

test('self-heal-nudge.mjs: emits the bounded self-heal nudge inside a studio project (2026-07-21 coverage)', () => {
  const dir = mkTmp('gru-shn-studio-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const r = runSelfHeal({ tool_input: { command: 'npm test' }, cwd: dir });
  assert.equal(r.code, 0);
  assert.ok(r.ctx && /fixer/i.test(r.ctx), 'must hand the failure to the fixer role');
  assert.ok(r.ctx && /\b2\b/.test(r.ctx), 'must mention the bound of 2 quiet attempts (the SECURITY.md-documented behaviour)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('self-heal-nudge.mjs: stays silent outside a studio project and on a user interrupt (2026-07-21 coverage)', () => {
  const outside = mkTmp('gru-shn-outside-');
  const rOutside = runSelfHeal({ tool_input: { command: 'npm test' }, cwd: outside });
  assert.equal(rOutside.stdout.trim(), '', 'must not inject studio instructions into an unrelated project failure');
  assert.equal(rOutside.code, 0);
  const dir = mkTmp('gru-shn-interrupt-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const rInterrupt = runSelfHeal({ tool_input: { command: 'npm test' }, cwd: dir, is_interrupt: true });
  assert.equal(rInterrupt.stdout.trim(), '', 'a user interrupt (Ctrl+C) is not a bug to auto-fix');
  const rBad = spawnSync('node', [path.join(HERE, 'self-heal-nudge.mjs')], { input: 'not json{{', encoding: 'utf8' });
  assert.equal(rBad.status, 0, 'unparseable stdin must not crash');
  assert.equal(rBad.stdout.trim(), '', 'unparseable stdin emits nothing');
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- gate.mjs TTL fail-closed guards (2026-07-21 coverage) -------------------
test('gate.mjs: a confirmation token with no ISSUED line is not honoured (fail-closed)', () => {
  const dir = mkTmp('gru-gate-noissued-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const token = crypto.createHash('sha256').update(`studio-publish:${dir}`).digest('hex');
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PUBLISH-APPROVED'), `STUDIO-PUBLISH-CONFIRMED:${token}\n`, 'utf8');
  assert.equal(runHook('gate.mjs', 'git push origin main', dir).decision, 'deny', 'a token with no ISSUED timestamp must fail closed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: a confirmation token with a FUTURE ISSUED timestamp is not honoured', () => {
  const dir = mkTmp('gru-gate-future-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  const token = crypto.createHash('sha256').update(`studio-publish:${dir}`).digest('hex');
  const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'PUBLISH-APPROVED'), `STUDIO-PUBLISH-CONFIRMED:${token}\nISSUED:${future}\n`, 'utf8');
  assert.equal(runHook('gate.mjs', 'git push origin main', dir).decision, 'deny', 'a far-future timestamp must not satisfy the TTL forever');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- roster-check.mjs ROSTER.md fallback (the product-repo CI path) ----------
function writeAgents(dir, n) {
  const a = path.join(dir, 'agents');
  fs.mkdirSync(a, { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(a, `role-${i}.md`), `---\nname: role-${i}\ndescription: x\n---\n`);
}

test('roster-check.mjs: ROSTER.md fallback is clean when count <= baseline (2026-07-21 coverage of the CI path)', () => {
  const plugin = mkTmp('gru-rc-clean-'); writeAgents(plugin, 5);
  fs.writeFileSync(path.join(plugin, 'ROSTER.md'), '# roster\n\n**role count: 5**\n');
  const noDm = mkTmp('gru-rc-clean-dm-');
  const r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), plugin, noDm], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  assert.equal(r.status, 0); assert.equal(j.status, 'clean'); assert.equal(j.source, 'ROSTER.md');
  fs.rmSync(plugin, { recursive: true, force: true }); fs.rmSync(noDm, { recursive: true, force: true });
});

test('roster-check.mjs: ROSTER.md fallback BLOCKS when agents exceed the baseline / count is missing / ROSTER.md is absent', () => {
  const noDm = mkTmp('gru-rc-block-dm-');
  // (a) over-grown
  const over = mkTmp('gru-rc-over-'); writeAgents(over, 7);
  fs.writeFileSync(path.join(over, 'ROSTER.md'), '**role count: 5**\n');
  let r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), over, noDm], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).status, 'BLOCKED');
  // (b) ROSTER.md present but no numeric count
  const noCount = mkTmp('gru-rc-nocount-'); writeAgents(noCount, 3);
  fs.writeFileSync(path.join(noCount, 'ROSTER.md'), '# a roster file with no stated number\n');
  r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), noCount, noDm], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).status, 'BLOCKED');
  // (c) no ROSTER.md and no decision files
  const noRoster = mkTmp('gru-rc-noroster-'); writeAgents(noRoster, 3);
  r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), noRoster, noDm], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).status, 'BLOCKED');
  fs.rmSync(noDm, { recursive: true, force: true });
  fs.rmSync(over, { recursive: true, force: true });
  fs.rmSync(noCount, { recursive: true, force: true });
  fs.rmSync(noRoster, { recursive: true, force: true });
});

// --- scan.mjs unpushed-history secret scan (2026-07-21 fix) ------------------
test('scan.mjs: a secret committed then removed from the working tree is still caught in unpushed history', () => {
  const dir = mkTmp('gru-scan-history-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  // Build the AWS reserved example key in parts so this test file's own source
  // line does not contain the contiguous literal (which scan.mjs would flag).
  const secret = 'AKIA' + 'IOSFODNN7EXAMPLE';
  fs.writeFileSync(path.join(dir, 'config.txt'), `aws_key = "${secret}"\n`);
  git(['add', '-A'], dir); git(['commit', '-qm', 'add config'], dir);
  // Remove it from the working tree in a later commit — tree is now clean.
  fs.rmSync(path.join(dir, 'config.txt'));
  git(['add', '-A'], dir); git(['commit', '-qm', 'remove config'], dir);
  const r = runHook('scan.mjs', 'git push origin main', dir);
  assert.equal(r.decision, 'deny', 'a secret still present in unpushed history must block the push even when the working tree is clean');
  assert.ok(/history/i.test(r.stdout), 'the finding should be attributed to unpushed history');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV12: the publish protocol must enumerate all seven pre-flight check hooks (2026-07-21 fix)', () => {
  const dir = mkTmp('gru-repointeg-publish7-');
  copyRepoTo(dir);
  const skillPath = path.join(dir, 'plugins', 'gru953-studio', 'skills', 'publish-github', 'SKILL.md');
  // Simulate the exact drift the fix prevents: drop a required check reference.
  fs.writeFileSync(skillPath, fs.readFileSync(skillPath, 'utf8').replace(/content-check\.mjs/g, 'REMOVED-check'));
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'dropping a required pre-flight check from the publish protocol must be caught');
  assert.ok(r.json.problems.some((p) => p.includes('content-check.mjs')), `expected a problem naming the dropped check, got: ${JSON.stringify(r.json && r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-21 gold-standard audit, Round 2 — re-verify Round 1 fixes found some
// incomplete (gh api shorthand, publish-count in maintenance-agent) and surfaced
// new issues (licence-scan .bin false-block, roster-check first-match, etc.).
// ---------------------------------------------------------------------------

test('lib.mjs isPushCapable: gh api attached-shorthand body flags (-fname=x / -Fname=x) are caught (2026-07-21 Round 2 fix)', () => {
  for (const c of [
    'gh api /user/repos -fname=app',
    'gh api /user/repos -Fname=app',
    'gh api -Fprivate=false repos/o/r',
    'gh api repos/o/r -fvisibility=public',
  ]) {
    assert.equal(isPushCapable(c), true, `gh api attached-shorthand write must be caught: "${c}"`);
  }
  // reads with no body flag stay allowed
  assert.equal(isPushCapable('gh api user'), false);
  assert.equal(isPushCapable('gh api repos/o/r'), false);
});

test('gate.mjs: gh api default-visibility repo creation needs the go-public token (2026-07-21 Round 2 fix)', () => {
  const dir = mkTmp('gru-gate-apicreate-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // private-publish token only
  // POST /user/repos with visibility omitted -> PUBLIC by GitHub default -> must need go-public.
  assert.equal(runHook('gate.mjs', 'gh api -X POST /user/repos -f name=app', dir).decision, 'deny', 'default-visibility repo creation defaults to public and must need the go-public token');
  assert.equal(runHook('gate.mjs', 'gh api /user/repos -fname=app', dir).decision, 'deny', 'attached-shorthand repo creation must also need go-public');
  // explicitly private repo creation rides the ordinary private-publish token.
  assert.equal(runHook('gate.mjs', 'gh api -X POST /user/repos -f name=app -f private=true', dir).decision, 'allow', 'an explicitly-private repo creation is a private push');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: a key-file committed then removed is still caught in unpushed history (2026-07-21 Round 2 fix)', () => {
  const dir = mkTmp('gru-scan-histkey-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  initRepo(dir);
  // A deploy key whose *content* is innocuous base64 (matches no secret pattern),
  // caught only by the key-file NAME rule — which the history scan must now apply.
  fs.writeFileSync(path.join(dir, 'deploy.pem'), 'bm90LWEtcmVhbC1zZWNyZXQtanVzdC1iYXNlNjQ=\n');
  git(['add', '-A'], dir); git(['commit', '-qm', 'add key'], dir);
  fs.rmSync(path.join(dir, 'deploy.pem'));
  git(['add', '-A'], dir); git(['commit', '-qm', 'remove key'], dir);
  const r = runHook('scan.mjs', 'git push origin main', dir);
  assert.equal(r.decision, 'deny', 'a key file in unpushed history must block the push even when the working tree is clean');
  assert.ok(/key-file-history/.test(r.stdout), 'the finding should be a key-file-history hit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scan.mjs: each secret format and key-file name is caught (2026-07-21 coverage of the core scanner)', () => {
  const mk = () => { const d = mkTmp('gru-scan-fmt-'); fs.mkdirSync(path.join(d, 'Dev-Memory'), { recursive: true }); initRepo(d); return d; };
  const denies = (file, content) => {
    const d = mk();
    fs.writeFileSync(path.join(d, file), content);
    const r = runHook('scan.mjs', 'git push origin main', d);
    fs.rmSync(d, { recursive: true, force: true });
    return r.decision === 'deny';
  };
  // secret CONTENT formats (built in parts so this test file isn't self-flagged)
  assert.ok(denies('a.txt', 'key = "' + 'AIza' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"'), 'Google AIza key');
  assert.ok(denies('b.txt', 'tok = "' + 'ghp_' + 'abcdef0123456789ABCDEF0123456789abcd"'), 'GitHub token');
  assert.ok(denies('c.txt', 'k = "' + 'sk_live_' + '0123456789abcdefABCDEF"'), 'Stripe live key');
  assert.ok(denies('d.txt', '-----BEGIN' + ' RSA PRIVATE KEY-----'), 'PEM private key header');
  // key-file NAMES (content innocuous)
  assert.ok(denies('.env', 'X=1\n'), '.env file');
  assert.ok(denies('id_rsa', 'x\n'), 'id_rsa file');
  assert.ok(denies('app.key', 'x\n'), '*.key file');
  // a short AIza-like string is NOT a match (length bound holds)
  const d = mk(); fs.writeFileSync(path.join(d, 'ok.txt'), 'note = "' + 'AIza' + 'short"');
  assert.equal(runHook('scan.mjs', 'git push origin main', d).decision, 'allow', 'a too-short AIza string must not be flagged');
  fs.rmSync(d, { recursive: true, force: true });
});

test('licence-scan.mjs: npm .bin/.cache tooling dirs are not treated as packages (2026-07-21 false-block fix)', () => {
  const dir = mkTmp('gru-lic-bin-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app","version":"1.0.0"}');
  const nm = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(nm, 'goodpkg'), { recursive: true });
  fs.writeFileSync(path.join(nm, 'goodpkg', 'package.json'), '{"name":"goodpkg","license":"MIT"}');
  fs.mkdirSync(path.join(nm, '.bin'), { recursive: true });
  fs.writeFileSync(path.join(nm, '.bin', 'tsc'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(nm, '.cache', 'x'), { recursive: true });
  const r = runScript('licence-scan.mjs', dir);
  assert.equal(r.json.status, 'clean', `.bin/.cache must not be scanned as packages: ${r.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence-scan.mjs: a copyleft npm dependency is BLOCKED; an all-permissive tree is clean (2026-07-21 coverage)', () => {
  // blocked path
  const b = mkTmp('gru-lic-gpl-');
  fs.writeFileSync(path.join(b, 'package.json'), '{"name":"app"}');
  fs.mkdirSync(path.join(b, 'node_modules', 'copyleft-pkg'), { recursive: true });
  fs.writeFileSync(path.join(b, 'node_modules', 'copyleft-pkg', 'package.json'), '{"name":"copyleft-pkg","license":"GPL-3.0-only"}');
  const rb = runScript('licence-scan.mjs', b);
  assert.equal(rb.json.status, 'BLOCKED', `a GPL dependency must block: ${rb.stdout}`);
  assert.equal(rb.code, 1);
  fs.rmSync(b, { recursive: true, force: true });
  // clean path incl. object-form licence and a scoped package
  const c = mkTmp('gru-lic-clean-');
  fs.writeFileSync(path.join(c, 'package.json'), '{"name":"app"}');
  fs.mkdirSync(path.join(c, 'node_modules', 'mit-pkg'), { recursive: true });
  fs.writeFileSync(path.join(c, 'node_modules', 'mit-pkg', 'package.json'), '{"name":"mit-pkg","license":"MIT"}');
  fs.mkdirSync(path.join(c, 'node_modules', 'obj-pkg'), { recursive: true });
  fs.writeFileSync(path.join(c, 'node_modules', 'obj-pkg', 'package.json'), '{"name":"obj-pkg","license":{"type":"Apache-2.0"}}');
  fs.mkdirSync(path.join(c, 'node_modules', '@scope', 'scoped-pkg'), { recursive: true });
  fs.writeFileSync(path.join(c, 'node_modules', '@scope', 'scoped-pkg', 'package.json'), '{"name":"@scope/scoped-pkg","license":"ISC"}');
  const rc = runScript('licence-scan.mjs', c);
  assert.equal(rc.json.status, 'clean', `an all-permissive tree must be clean: ${rc.stdout}`);
  fs.rmSync(c, { recursive: true, force: true });
});

test('memory-integrity.mjs: prose under a ## Links heading is not mis-parsed as a link (2026-07-21 Round 2 fix)', () => {
  const dir = mkTmp('gru-mi-prose-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'GRAPH.md'),
    '## Nodes\n- [T1] task: a\n- [R1] requirement: b\n\n## Links\n- T1 implements R1\n- All links use present-tense verbs like implements and blocks.\n'
  );
  const r = runScript('memory-integrity.mjs', dir);
  assert.equal(r.json.status, 'clean', `a real link + a prose bullet must be clean, not a false BLOCK: ${r.stdout}`);
  // and a genuinely dangling documented link is still caught
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'GRAPH.md'), '## Nodes\n- [T1] task: a\n\n## Links\n- T1 depends-on R9\n');
  assert.equal(runScript('memory-integrity.mjs', dir).json.status, 'BLOCKED', 'a dangling documented link must still be caught');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('roster-check.mjs: the LAST role-count in ROSTER.md wins, so a narrated earlier number cannot hide scope creep (2026-07-21 fix)', () => {
  const plugin = mkTmp('gru-rc-last-'); writeAgents(plugin, 6);
  // An earlier hypothetical number precedes the authoritative one.
  fs.writeFileSync(path.join(plugin, 'ROSTER.md'), 'We considered 50 roles (role count: 50) but settled on\n**role count: 5**\n');
  const noDm = mkTmp('gru-rc-last-dm-');
  const r = spawnSync('node', [path.join(HERE, 'roster-check.mjs'), plugin, noDm], { encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).status, 'BLOCKED', '6 agents vs the authoritative baseline of 5 must BLOCK, not read the earlier 50');
  fs.rmSync(plugin, { recursive: true, force: true }); fs.rmSync(noDm, { recursive: true, force: true });
});

test('repo-integrity.mjs INV12: a stale "four ... checks" on the publish path (maintenance-agent) is caught (2026-07-21 Round 2 fix)', () => {
  const dir = mkTmp('gru-repointeg-four-');
  copyRepoTo(dir);
  const p = path.join(dir, 'plugins', 'gru953-studio', 'agents', 'maintenance-agent.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('seven blocking checks', 'four blocking checks'));
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'a stale "four ... checks" on the publish path must be caught');
  assert.ok(r.json.problems.some((p2) => /maintenance-agent\.md/.test(p2) && /four/.test(p2)), `expected a problem naming maintenance-agent, got: ${JSON.stringify(r.json && r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2026-07-21 gold-standard audit, Round 3 — fewer findings (5), all fixed here.
// ---------------------------------------------------------------------------

test('licence-scan.mjs: a pnpm-layout copyleft dependency (symlinked direct dep) is BLOCKED, not false-clean (2026-07-21 Round 3 regression fix)', () => {
  const dir = mkTmp('gru-lic-pnpm-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"app"}');
  const store = path.join(dir, 'node_modules', '.pnpm', 'evil-gpl@1.0.0', 'node_modules', 'evil-gpl');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'package.json'), '{"name":"evil-gpl","license":"GPL-3.0"}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true }); // tooling dir must still be skipped
  fs.symlinkSync(path.join('.pnpm', 'evil-gpl@1.0.0', 'node_modules', 'evil-gpl'), path.join(dir, 'node_modules', 'evil-gpl'), 'dir');
  const r = runScript('licence-scan.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', `a pnpm-symlinked GPL dep must be caught, not skipped: ${r.stdout}`);
  assert.equal(r.code, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gate.mjs: gh api create-from-template also needs the go-public token (2026-07-21 Round 3 fix)', () => {
  const dir = mkTmp('gru-gate-gen-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // private-publish token only
  const denied = runHook('gate.mjs', 'gh api -X POST repos/octocat/tmpl/generate -f owner=me -f name=new', dir);
  assert.equal(denied.decision, 'deny', 'template-generate defaults to a PUBLIC repo and must need the go-public token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('traceability-check.mjs: a met requirement whose own row admits it is failing is caught (2026-07-21 coverage)', () => {
  const dir = mkTmp('gru-trace-contra-');
  writeReq(dir, REQ_HEADER + '| R1 | Pause | 1 | T1 | verified: was ok, now fails with exit 1 | met |\n', PROG_HEADER + '| T1 | pause | done | verified: ok |\n');
  const r = runScript('traceability-check.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /marked met but its own row|currently failing\/unverified/i.test(p)), 'the contradiction branch must fire');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality-gate.mjs: a required dimension with a plain non-pass status (todo) is BLOCKED (2026-07-21 coverage)', () => {
  const dir = mkTmp('gru-qg-nonpass-');
  writeGate(dir, FULL_DOD.replace('| Automated tests | pass | `npm test` -> exit 0 (2026-07-19) |', '| Automated tests | todo | not run yet |'));
  const r = runScript('quality-gate.mjs', dir);
  assert.equal(r.json.status, 'BLOCKED', r.stdout);
  assert.ok(r.json.problems.some((p) => /is not a pass/i.test(p)), 'a non-pass required dimension must be reported');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Round 4 (2026-07-21): 2 findings, both fixed ---------------------------

test('gate.mjs: an incidental "private=..." inside an unrelated field VALUE does not downgrade a public repo-create (2026-07-21 Round 4 fix)', () => {
  const dir = mkTmp('gru-gate-fakepriv-');
  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  spawnSync('node', [path.join(HERE, 'confirm-publish.mjs'), dir], { encoding: 'utf8' }); // private-publish token only
  assert.equal(runHook('gate.mjs', 'gh api -X POST /user/repos -f name=app -f description="toggle private=true to hide"', dir).decision, 'deny', 'a fake private= buried in a description value must not suppress the go-public gate');
  // a REAL private field still rides the ordinary private-publish token
  assert.equal(runHook('gate.mjs', 'gh api -X POST /user/repos -f name=app -f private=true', dir).decision, 'allow', 'an explicitly-private repo create is a private push');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence-scan.mjs: a nonexistent or file-as-root path emits JSON, never a raw crash (2026-07-21 Round 4 fix)', () => {
  const missing = path.join(os.tmpdir(), 'gru-no-such-dir-' + process.pid + '-xyz');
  const r1 = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), missing], { encoding: 'utf8' });
  assert.doesNotThrow(() => JSON.parse(r1.stdout), `a nonexistent root must still emit parseable JSON, got stderr: ${r1.stderr}`);
  assert.ok(!/ENOENT|scandir/.test(r1.stderr), 'must not crash with a raw scandir error');
  const f = mkTmp('gru-lic-fileroot-');
  const fp = path.join(f, 'afile.txt');
  fs.writeFileSync(fp, 'x');
  const r2 = spawnSync('node', [path.join(HERE, 'licence-scan.mjs'), fp], { encoding: 'utf8' });
  assert.doesNotThrow(() => JSON.parse(r2.stdout), `a file-as-root must still emit parseable JSON, got stderr: ${r2.stderr}`);
  assert.ok(!/ENOTDIR|scandir/.test(r2.stderr), 'must not crash with a raw scandir error on a file path');
  fs.rmSync(f, { recursive: true, force: true });
});
