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
