// lib.mjs — shared helpers for the GRU953-Studio Bash hooks (scan.mjs, gate.mjs).
// Zero dependencies (Node stdlib only). Both hooks run on every Bash call via
// the same PreToolUse chain in hooks.json, so importing this costs nothing
// extra and keeps the two hooks' shared logic (decisions, tool-call parsing,
// the studio-run marker and the push-capable matcher) defined in exactly one
// place instead of two copies that could quietly drift apart.
//
// Adapted from GRU953-Crew's proven hooks of the same name (2026-07-07
// design) — reused deliberately rather than re-invented, per the lesson
// recorded in this project's own memory that redesigning proven mechanisms
// is a cost, not a feature.

import fs from 'node:fs';
import path from 'node:path';

// ---- decision helpers --------------------------------------------------------
// Output is built with JSON.stringify, never hand-interpolated: a reason
// string can legitimately contain quotes, backslashes or newlines (several of
// this project's own deny reasons do — they quote shell commands), and a
// hand-built JSON string silently produced INVALID JSON for those. An
// unparseable PreToolUse deny risks failing OPEN (the block not being
// honoured). 2026-07-11 v2.0.0 audit fix — caught by hooks.test.mjs.
export function allow() {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }) + '\n'
  );
  process.exit(0);
}
export function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: String(reason),
      },
    }) + '\n'
  );
  process.exit(2);
}

// ---- read the tool call ------------------------------------------------------
export function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}
export function extractCommand(input) {
  let obj;
  try {
    obj = JSON.parse(input);
  } catch {
    return '';
  }
  const ti = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj.tool_input : undefined;
  if (ti === null || ti === undefined || typeof ti !== 'object' || Array.isArray(ti)) return '';
  const cmd = ti.command;
  return typeof cmd === 'string' ? cmd : '';
}
export function extractCwd(input) {
  let obj;
  try {
    obj = JSON.parse(input);
  } catch {
    return '';
  }
  const c = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj.cwd : undefined;
  return typeof c === 'string' ? c : '';
}

// ---- studio run marker (the run-scope gate) --------------------------------------
// The studio's project marker is its Dev-Memory folder. Walk up from `start`
// looking for one; return the project root that contains it, or null when no
// studio project exists anywhere up the tree (=> no active studio run here).
export function findStudioRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    try {
      if (fs.statSync(path.join(d, 'Dev-Memory')).isDirectory()) return d;
    } catch {
      // not present at this level; keep walking
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

// ---- push-capable command matcher (fail CLOSED) ------------------------------
// Shared by scan.mjs and gate.mjs, so the phase gate and the secret scan cover
// exactly the same command set: a push-capable command cannot slip past one
// while still being caught by the other. If we cannot POSITIVELY prove the
// command is NON-push, treat it as push.
//
// 2026-07-10 gold-standard audit finding (MAJOR, fixed here): the original
// matcher only pattern-matched literal "push"/"gh" text, so `git -c
// alias.p=push p` (a one-line git alias) defeated it completely — the
// literal substring "push" never appears with the required whitespace
// before it. Also, indirection (a project's own deploy.sh / Makefile /
// `npm run release` that itself runs `git push`) is invoked via a Bash
// command containing neither word. Changes here close the two Round-1
// proof-of-concept bypasses (alias definition, script/Makefile/npm-run
// indirection) plus `git send-pack` and `gh alias set` (Round 2 additions).
//
// Disclosed, NOT fully closed (see SECURITY.md): because each hook call
// judges one command string in isolation with no persistent state, an
// alias DEFINED in an earlier command (or in the user's pre-existing global
// gitconfig, never touched by this plugin at all) can still be REUSED later
// by bare name (`git p`) without the word "push" appearing in that later
// command. Catching that would require a state store or inspecting
// `.git/config` on every command, which this hook design doesn't do.
export function isPushCapable(c) {
  if (!c) return true;
  // 2026-07-11 Round-A adversarial-audit fix: tolerate quotes around the
  // git binary or the `push` subcommand. `git "push"`, `git 'push'` and
  // `"git" push` all run a real push once the shell strips the quotes, but
  // the un-quoted matcher rated them NON-push — a fail-OPEN bypass that
  // contradicted this matcher's own "prove non-push or treat as push" rule.
  // Optional `['"]?` around `git` and `push` closes it; a battery in
  // hooks.test.mjs locks it in, and the safe-command set was re-verified to
  // confirm no new false positives (gitk/github/xgit/`git pushx` stay clear).
  if (/(^|[^A-Za-z0-9_])['"]?git['"]?([ \t]+-[^ \t]+|[ \t]+[^ \t]+)*[ \t]+['"]?push['"]?([ \t]|$)/.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])gh[ \t]+(repo[ \t]+(create|edit|sync|clone)|pr[ \t]+create|release[ \t]+(create|upload)|gist[ \t]+create)/.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])gh[ \t].*--push([ \t]|=|$)/.test(c)) return true;
  // git aliases that resolve to push (e.g. `git -c alias.p=push p`, or
  // `git config alias.foo push` followed later by `git foo`).
  if (/(^|[^A-Za-z0-9_])git[ \t]+(-c[ \t]+)?alias\.[A-Za-z0-9_.-]+[ \t]*=[ \t]*['"]?push/.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])git[ \t]+config([ \t]+--\S+)*[ \t]+alias\.[A-Za-z0-9_.-]+[ \t]+['"]?push/.test(c)) return true;
  // git plumbing command that performs a push without the word "push".
  if (/(^|[^A-Za-z0-9_])git[ \t]+send-pack([ \t]|$)/.test(c)) return true;
  // gh's own alias mechanism, same shape of risk as git aliases.
  if (/(^|[^A-Za-z0-9_])gh[ \t]+alias[ \t]+set/.test(c)) return true;
  // 2026-07-11 fix (found live, in real use, not just review): there used
  // to be a blanket fallback here — "if the command has any compound
  // operator (&&, ;, |, etc.) AND contains the bare substring 'gh', treat
  // it as push-capable." It was meant to catch obfuscated pushes hidden
  // behind chaining, but every regex above is UNANCHORED, so `.test()`
  // already finds a real `git push`/`gh repo create`/etc. anywhere in the
  // string, compound or not — the fallback added no real detection power.
  // What it DID do: block nearly every ordinary `cd <dir> && gh <anything>`
  // command — including harmless reads like `gh repo view`/`gh auth
  // status`/`gh api user` — because this environment's Bash tool doesn't
  // reliably persist a working directory, so "cd X && gh Y" is the normal
  // way to run almost any gh command here. Removed: it failed at stopping
  // real obfuscation (the `$(...)`-construction bypass below defeats it
  // just the same as everything else) while blocking completely ordinary,
  // safe usage. Indirection: running a script file, a Makefile target, or a
  // package-manager task can contain a push with no "push"/"gh" text in
  // THIS command. Fail closed rather than assume it's safe.
  if (/(^|[^A-Za-z0-9_])(\.\/|bash[ \t]+|sh[ \t]+|node[ \t]+)?[^ \t]*\.(sh|mjs|js|py)([ \t]|$)/.test(c) &&
      /(deploy|release|publish|ship)/i.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])make[ \t]+\S+/.test(c) && /(deploy|release|publish|ship)/i.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])(npm|pnpm|yarn)[ \t]+run[ \t]+\S+/.test(c) && /(deploy|release|publish|ship)/i.test(c)) return true;
  return false;
}
