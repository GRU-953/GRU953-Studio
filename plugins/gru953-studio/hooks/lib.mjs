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
// 2026-07-11 v2.0.0 follow-up audit fix (MAJOR): an adversarial pass found
// that bash resolves `git${IFS}push` (IFS-based word-splitting) and
// `git pu""sh` / `git pu''sh` (empty-string quote splicing) to a real
// `git push` — but the matcher only ever sees the UN-expanded literal text,
// so both returned false (non-push), skipping the secret scan and the
// publish gate entirely. Neither is a variant of the quote-tolerance fix
// above (that handles a whole token wrapped in quotes, not mid-word
// splicing or a shell variable expanding to whitespace). Fix: canonicalise
// the two concrete techniques found — strip empty adjacent quote pairs, and
// replace `$IFS`/`${IFS}` with a literal space — before running every check
// below. This closes the two proof-of-concept bypasses; it does NOT close
// shell obfuscation in general, which has effectively unlimited variations
// (see SECURITY.md's disclosed-limitations section, extended for this).
// 2026-07-11 Round 2 follow-up: adversarial re-testing found the first pass
// only stripped EMPTY adjacent quote pairs, missing the more general (and
// equally trivial) case of quoting real characters mid-word — `git
// p"u"s"h"` splices to a real `push` in bash the same way `pu""sh` does,
// just with non-empty quoted segments — plus backslash-escaped mid-word
// characters (`p\ush`) and backslash-newline line continuations. Now
// stripped generally: repeatedly remove any quote character touching a
// word character on either side (a fixed-point loop, so cascading splices
// like `p"u"s"h"` fully resolve, not just the first pair), remove
// backslash-newline continuations, and un-escape a backslash before an
// ordinary word character. Still not a full shell parser — command
// substitution and variable-reuse-based obfuscation remain open, disclosed
// limitations (see SECURITY.md).
function normalizeForPushCheck(c) {
  let n = c;
  n = n.replace(/\\\r?\n/g, ''); // backslash-newline line continuation
  n = n.replace(/\\([A-Za-z0-9])/g, '$1'); // p\ush -> push
  n = n.replace(/\$\{IFS\}|\$IFS\b/g, ' '); // git${IFS}push -> git push
  let prev;
  do {
    prev = n;
    // strip a quote char that touches a word char on either side (mid-word
    // splicing), one layer per pass; loop to a fixed point so chained
    // splices like p"u"s"h" fully resolve, not just the first pair.
    n = n.replace(/([A-Za-z0-9_-])(["'])/g, '$1').replace(/(["'])([A-Za-z0-9_-])/g, '$2');
  } while (n !== prev);
  return n;
}
// 2026-07-11 v2.0.1 follow-up fix (real deadlock, found live): the
// "script name contains deploy/release/publish/ship" indirection rule
// below correctly treats an arbitrary project script that might hide a
// push as push-capable — but `confirm-publish.mjs` and
// `confirm-go-public.mjs` themselves match it purely because their OWN
// filenames contain "publish"/"go-public", even though neither script
// pushes anything; each only writes a local marker file recording that
// the user already confirmed. That made gate.mjs deny the very script
// that RECORDS a confirmation on the grounds that "no confirmation is
// recorded yet" — a bootstrap deadlock with no way out, since the record
// can never be written.
//
// The exemption below is deliberately narrow — it strips at most one simple
// leading `cd ... &&`/`cd ...;` prefix, then requires NO compound operator
// anywhere in what remains (so nothing can be chained before or after), and
// only THEN checks that what's left is a plain `node <path-to-one-of-the-
// two-scripts> [one optional argument]` invocation. This is NOT a bare
// substring check: `git push origin main; node confirm-publish.mjs` still
// has a `;` left after stripping (there's no leading cd to strip, so the
// whole string is scanned for compound operators and the `;` is found) and
// is correctly NOT exempted — still caught by the checks below as a real
// push.
//
// 2026-07-11 Round 3 adversarial-audit fix (CRITICAL, found by independent
// verification, not trusted from the first report): the original version of
// this function matched the path with `\S.*(confirm-publish|confirm-go-
// public)\.mjs`, which is a SUFFIX/substring test, not an identity check —
// `node ./evil-confirm-publish.mjs` and `node /tmp/attacker/z-confirm-
// publish.mjs` both matched, because the literal text "confirm-publish.mjs"
// merely appears at the end of a longer, unrelated filename. Since
// isPushCapable() returning false makes BOTH gate.mjs and scan.mjs allow()
// immediately — skipping the secret scan and the publish-confirmation check
// entirely — this let any node script with a crafted filename run completely
// unchecked. The same over-broad match also had a second bug: a BARE
// invocation with no directory prefix at all (`node confirm-publish.mjs`,
// which is exactly the usage documented in that script's own header
// comment) failed the old regex, because `\S.*` required at least one
// character to exist strictly BEFORE the matched filename text — recreating,
// for that literal invocation form, the exact bootstrap deadlock this
// function was written to fix.
//
// Fixed by extracting the actual path argument and comparing its real
// `path.basename()` for an EXACT match against the two known script names,
// rather than testing whether the filename merely ends with that text. This
// closes both bugs: a bare `confirm-publish.mjs` has basename
// `confirm-publish.mjs` (exact match, exempted); `evil-confirm-publish.mjs`
// has basename `evil-confirm-publish.mjs` (not an exact match, NOT
// exempted, falls through to the ordinary push-capable checks below).
//
// Disclosed, not eliminated: this still trusts a FILENAME, not a
// cryptographic identity — a file deliberately created with the exact name
// `confirm-publish.mjs` in a location the session can reach would still be
// exempted, the same residual risk every filename-based check in this
// project carries (see SECURITY.md). Requiring the resolved path to also
// live under a fixed directory was considered and rejected: the legitimate
// invocation form varies by design (an absolute `${CLAUDE_PLUGIN_ROOT}/...`
// path from the plugin cache, or a relative `hooks/confirm-publish.mjs` from
// within the project root), so no single directory prefix covers every real
// use without also blocking it.
function isConfirmScriptOnly(c) {
  const afterCd = c.replace(/^[ \t]*cd[ \t]+(?:"[^"]+"|'[^']+'|[^ \t;&|]+)[ \t]*(?:&&|;)[ \t]*/, '');
  if (/(&&|\|\||;|\||`|\$\()/.test(afterCd)) return false;
  const m = /^node[ \t]+(?:"([^"]+)"|'([^']+)'|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\S+))?[ \t]*$/.exec(afterCd);
  if (!m) return false;
  const scriptPath = m[1] || m[2] || m[3];
  const base = path.basename(scriptPath);
  return base === 'confirm-publish.mjs' || base === 'confirm-go-public.mjs';
}
export function isPushCapable(rawC) {
  if (!rawC) return true;
  const c = normalizeForPushCheck(rawC);
  if (isConfirmScriptOnly(c)) return false;
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
