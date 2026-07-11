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
    'The full list below (23 specialist roles in total)',
    'We once evaluated 23 specialist roles for a sibling product. The full list below (99 specialist roles in total)'
  );
  fs.writeFileSync(readmePath, readme);
  const r = runRepoIntegrity(dir);
  assert.equal(r.json && r.json.status, 'BLOCKED', 'a conflicting later role-count mention must not be masked by an earlier correct one');
  assert.ok(r.json.problems.some((p) => p.includes('23') && p.includes('99')), `expected a problem naming both counts, got: ${JSON.stringify(r.json.problems)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo-integrity.mjs INV5: an unrelated historical "<n> roles" mention does not falsely block a correct README', () => {
  const dir = mkTmp('gru-repointeg-decoy-');
  copyRepoTo(dir);
  const readmePath = path.join(dir, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  readme = readme.replace(
    'The full list below (23 specialist roles in total)',
    'The studio grew from 16 roles in early versions. The full list below (23 specialist roles in total)'
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
