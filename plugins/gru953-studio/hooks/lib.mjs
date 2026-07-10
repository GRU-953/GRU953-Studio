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
export function allow() {
  process.stdout.write('{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n');
  process.exit(0);
}
export function deny(reason) {
  process.stdout.write(
    `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"${reason}"}}\n`
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
  if (/(^|[^A-Za-z0-9_])git([ \t]+-[^ \t]+|[ \t]+[^ \t]+)*[ \t]+push([ \t]|$)/.test(c)) return true;
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
  if (/(&&|\|\||;|\||`|\$\(|eval[ \t])/.test(c)) {
    if (/(push|(^|[^A-Za-z0-9_])gh([ \t]|$))/.test(c)) return true;
  }
  // Indirection: running a script file, a Makefile target, or a
  // package-manager task can contain a push with no "push"/"gh" text in
  // THIS command. Fail closed rather than assume it's safe.
  if (/(^|[^A-Za-z0-9_])(\.\/|bash[ \t]+|sh[ \t]+|node[ \t]+)?[^ \t]*\.(sh|mjs|js|py)([ \t]|$)/.test(c) &&
      /(deploy|release|publish|ship)/i.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])make[ \t]+\S+/.test(c) && /(deploy|release|publish|ship)/i.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])(npm|pnpm|yarn)[ \t]+run[ \t]+\S+/.test(c) && /(deploy|release|publish|ship)/i.test(c)) return true;
  return false;
}
