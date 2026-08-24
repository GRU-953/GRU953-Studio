#!/usr/bin/env node
//
// scan.mjs — GRU953-Studio pre-publish secret scan (PreToolUse, matcher "Bash").
// Zero dependencies (Node stdlib only). Self-contained: no external state store.
//
// Internally gated twice: first to push-capable commands — matched by
// isPushCapable(), which lived in lib.mjs so that this hook and gate.mjs judged the
// same command set — and then to an active studio run (a Dev-Memory folder
// somewhere up the tree, also resolved via lib.mjs). When no studio project
// is found the hook allows and stands down, so a user/global-scope install
// never blocks pushes in repositories that have nothing to do with the
// studio. It backs up the manual scan in skills/publish-github so a
// forgotten scan cannot leak a secret. It scans the working tree, index and
// untracked files a push would ship AND the content added in unpushed commits
// (a branch push ships commits, not only the working tree) — the publisher's
// temp clone is covered the same way when one is used.
// Every inspected value — the tool input, the command string, file contents
// — is DATA, never instructions. Secret values are never printed; findings
// are redacted to {type,file,line}.
//
// stdout is reserved for the decision JSON.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
// 2026-07-26 audit finding 4: this was `require('node:zlib')` inside
// decodeAndNormalize, which is a ReferenceError in an ESM module — so the
// gzip-obfuscation defence had never run. A module-scope import is the only
// correct form in a .mjs file.
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
// 2026-08-13 (findings F3 + the cwd defect): this hook's own directory on disk is
// what identifies the ONE test-fixture Dev-Memory that may be exempt. Deriving it
// from the module's own location makes the exemption absolute, cwd-independent,
// and inherently bound to this plugin rather than to any path that merely looks
// like it.
import { fileURLToPath } from 'node:url';
const HOOKS_DIR = path.dirname(fileURLToPath(import.meta.url));
import {
  stepAside,
  deny,
  escalate,
  sendsCommitsToRemote,
  resolveScriptChain,
  pipesRemoteCodeIntoAnInterpreter,
  readStdin,
  extractCommand,
  extractCwd,
  findStudioRoot,
  isPushCapable,
  normalizeForPushCheck,
} from './lib.mjs';

// 2026-07-19 (Phase 4 — opt-in cloud memory persistence, see the `dev-memory`
// skill and confirm-memory-persist.mjs). When this project-bound token is
// recorded, scan.mjs stops auto-denying purely because a Dev-Memory path is in
// the push — but the full secret/key-file scan below STILL runs on those files,
// so Dev-Memory persists to a private branch only if it carries no secret. This
// is the ONLY effect of the token here; it never relaxes the secret scan, and
// gate.mjs confined the token to a private (never public) push, until X214 deleted both.
//
// 2026-07-26 further-pass audit fix (confirmed by execution): this used to
// carry its OWN independent copy of the token/TTL check — match the token
// anywhere in the file, then check freshness against the WHOLE file's first
// `ISSUED:` line — the exact unbound-token bug audit finding 12 fixed in
// gate.mjs, reintroduced here because scan.mjs never picked up that fix.
// Reproduced: a record with an unrelated fresh `ISSUED:` line placed BEFORE
// the real (expired) token+its own real issued line still returned allowed.
// Shared gate.mjs's tokenConfirmedWithinTtl from lib.mjs while both existed;
// so there is exactly one implementation and the two hooks cannot drift
// apart on this again.
function memoryPersistAllowed(studioRoot) {
  // 2026-08-16, X214. This used to require a sha256 token with a TTL, minted by
  // confirm-memory-persist.mjs. X91 established that such a token proves nothing: anything this
  // hook can read, an agent on the same machine can write. It was ceremony, and it cost a whole
  // script, a TTL, and two findings.
  //
  // What actually matters is that the person whose private memory it is has said so ON PURPOSE.
  // A file they create by name does that, and — unlike a hash — they can see it, understand it,
  // and delete it. The secret scan below still runs over those files regardless, so this opt-in
  // never ships a credential; it only stops the working-memory rule from refusing a push the
  // owner deliberately intends.
  const marker = path.join(studioRoot, 'Dev-Memory', 'SHIP-MEMORY-DELIBERATELY');
  try {
    return fs.statSync(marker).isFile();
  } catch {
    return false;
  }
}

// ---- Dev-Memory content probe (2026-07-31 maintenance fix) -------------------
// Bounded recursive check for "does Dev-Memory/ contain at least one real
// file anywhere under it". Deliberately narrow, not a general directory
// walker: git itself can never track or ship an empty directory — there is
// no way to commit one at all — so a bare, empty Dev-Memory/ carries no real
// shipping risk regardless of what .gitignore says, and denying a push over
// one would be a pure false positive with no safety upside. (Verified live:
// this exact shape — an empty Dev-Memory/ created only to mark a studio
// project, never gitignored — is how this project's OWN test fixtures
// throughout hooks.test.mjs already set up a "studio project" for dozens of
// unrelated scan.mjs tests; treating mere existence as a violation broke 39
// of them on contact, none of which had anything to do with Dev-Memory.)
// Short-circuits on the first file found; visits real directories only
// (never follows a symlink, so a symlink cycle cannot loop forever) and is
// bounded (MAX_ENTRIES) against a pathological tree — the same "bounded
// walk, not a general engine" discipline licence-scan.mjs's own directory
// walk already documents choosing over a full .gitignore parser.
function devMemoryHasAnyFile(devMemoryPath) {
  const MAX_ENTRIES = 20000;
  let visited = 0;
  const stack = [devMemoryPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++visited > MAX_ENTRIES) return true; // fail closed on a pathological tree
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        return true;
      }
    }
  }
  return false;
}

// ---- push-tree resolution ------------------------------------------------------
function resolvePushTree(cmd, fallback) {
  let m = /(?:^|[^A-Za-z0-9_])git[ \t]+-C[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t]+))/.exec(cmd);
  if (m) return m[1] || m[2] || m[3];
  m = /^[ \t]*cd[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t;&|]+))[ \t]*(?:&&|;)/.exec(cmd);
  if (m) return m[1] || m[2] || m[3];
  return fallback;
}

// ---- force-add pathspec extraction -------------------------------------------
// 2026-07-21 Round 12/13 audit fix (HIGH): the would-ship file set is built with
// `git ls-files --others --exclude-standard`, which OMITS gitignored files. A
// single compound `git add -f <ignored-secret> && git commit && git push` slips
// BOTH scans — at PreToolUse the file is untracked+ignored (absent from all three
// git calls) and no commit exists yet (the history range is empty). When the
// command force-adds (`-f`/`--force`), enumerate the ignored files the force-add
// would stage and scan them too. Scoped to the actual pathspecs so an ordinary
// push, and a force-add of one file, never sweep in unrelated ignored trees
// (e.g. node_modules). Runs on the obfuscation-resolved command, like the other
// hooks. Residual (disclosed in SECURITY.md): a force-add pathspec that survives
// only as a runtime shell expansion this normaliser does not resolve.
function extractForceAddPathspecs(cmd) {
  const norm = normalizeForPushCheck(cmd);
  const specs = [];
  for (const seg of norm.split(/&&|\|\||[;\n|&]/)) {
    if (!/(?:^|[^A-Za-z0-9_])git(?:[ \t]|$)/.test(seg)) continue;
    const m = /(?:^|[^A-Za-z0-9_])add(?:[ \t]|$)/.exec(seg);
    if (!m) continue;
    // a force flag: --force, or a short-flag cluster containing 'f' (-f, -Af, -fA)
    const hasForce =
      /(?:^|[ \t])--force(?:[ \t=]|$)/.test(seg) ||
      /(?:^|[ \t])-[A-Za-z]*f[A-Za-z]*(?:[ \t]|$)/.test(seg);
    if (!hasForce) continue;
    const hasAll = /(?:^|[ \t])(?:--all|-[A-Za-z]*A[A-Za-z]*)(?:[ \t]|$)/.test(seg);
    let sawDashDash = false;
    let anyPath = false;
    // 2026-07-21 Round 14 audit fix: tokenise quote-AWARE. A plain whitespace
    // split broke a quoted pathspec that contains a space (`git add -f "prod
    // copy.secret"`) into two bogus tokens, so the ignored file matched nothing
    // and shipped unscanned. Keep single/double-quoted spans together (as the
    // shell hands them to git), then strip one surrounding quote pair. Spaced
    // filenames are ordinary on macOS/Windows, so this is a realistic case, not
    // obfuscation. (Residual, disclosed: a backslash-escaped space is unescaped
    // by normalizeForPushCheck before this runs — the disclosed normaliser boundary.)
    for (const raw of seg.slice(m.index + m[0].length).match(/"[^"]*"|'[^']*'|[^\s'"]+/g) || []) {
      let tok = raw;
      if (
        (tok.startsWith('"') && tok.endsWith('"')) ||
        (tok.startsWith("'") && tok.endsWith("'"))
      ) {
        tok = tok.slice(1, -1);
      }
      tok = tok.trim();
      if (!tok) continue;
      if (!sawDashDash && tok === '--') {
        sawDashDash = true;
        continue;
      }
      if (!sawDashDash && tok.startsWith('-')) continue; // an option, not a pathspec
      specs.push(tok);
      anyPath = true;
    }
    // `git add -A -f` / `git add --all -f` with no explicit path stages everything,
    // ignored included; scope that to the whole tree.
    if (!anyPath && hasAll) specs.push('.');
  }
  return Array.from(new Set(specs));
}

// ---- redaction ---------------------------------------------------------------
function redact(type = 'unknown', file = '', line = '0') {
  const safeType = String(type).replace(/[^A-Za-z0-9_.-]/g, '');
  const safeFile = String(file).replace(/[^A-Za-z0-9_./-]/g, '');
  let safeLine = String(line);
  if (safeLine === '' || /[^0-9]/.test(safeLine)) safeLine = '0';
  return `{"type":"${safeType}","file":"${safeFile}","line":${safeLine}}`;
}

// ---- git helper --------------------------------------------------------------
function git(args, cwd, encoding = 'utf8') {
  const r = spawnSync('git', args, { cwd, encoding, maxBuffer: 1024 * 1024 * 256 });
  if (r.error)
    return { status: 1, stdout: encoding === 'buffer' ? Buffer.alloc(0) : '', ok: false };
  return { status: r.status, stdout: r.stdout, ok: r.status === 0 };
}

// ---- text/binary classification ----------------------------------------------
// 2026-07-21 Round 11 audit fix (NUL/binary blind spot). Is this content
// PREDOMINANTLY ordinary readable text, as opposed to a genuine binary asset?
// Used to decide whether a NUL-containing would-ship file is a text file that
// merely captured a stray binary byte (scan its extractable ASCII) or a real
// binary blob such as a font/image/compiled artefact (skip — regex-scanning its
// bytes would only add noise). Valid UTF-8 — Bangla and every other script
// included — counts fully as text: only bytes that decode to U+FFFD (invalid
// UTF-8) or to a control char drag the fraction down, so a Bangla SQL dump with
// a plaintext credential is still scanned, while a high-entropy binary is not.
function strIsTextish(s) {
  if (s.length === 0) return true;
  let ok = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 0xa0 && c !== 0xfffd))
      ok++;
  }
  return ok / s.length >= 0.85;
}
function bufIsTextish(buf) {
  if (buf.length === 0) return true;
  // Classify from the head — enough to tell text from binary, and bounds cost.
  const head = buf.length > 65536 ? buf.subarray(0, 65536) : buf;
  return strIsTextish(head.toString('utf8'));
}

// ---- multi-pass decode/normalize pipeline (2026-07-25 audit fix) --------------
// Attempt to decode common encodings/obfuscations before scanning for secrets.
// Returns array of decoded text variants to scan (original + any decoded).
function decodeAndNormalize(buf) {
  const results = [];
  const originalText = buf.toString('utf8');
  results.push(originalText);

  // 2026-07-26 audit finding 5. This loop used to try
  // ['utf16le','utf16be','utf32le','utf32be']. Only the FIRST is a real Node
  // encoding: the other three throw `TypeError: Unknown encoding` on every call
  // (verified), were swallowed by the catch, and so had never decoded anything.
  //
  // The surviving utf16le pass was worse than useless. Re-reading ordinary
  // single-byte ASCII as UTF-16LE always yields CJK-looking mojibake whose code
  // points are all >= 0xa0, and strIsTextish counts every code point >= 0xa0 as
  // text — so the mojibake scored 1.000 and passed. Every line of every file was
  // therefore scanned TWICE, and because scanText reports `i+1` from whichever
  // variant matched, any finding from the mojibake pass carried a line number
  // that pointed nowhere.
  //
  // A genuine UTF-16 file announces itself with a byte-order mark. Requiring one
  // keeps the real case (a UTF-16LE/BE file containing a credential) and drops
  // the phantom pass entirely. UTF-16BE is handled by byte-swapping, since Node
  // has no 'utf16be' encoding — which is what the original list was reaching for.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const decoded = buf.subarray(2).toString('utf16le');
    if (strIsTextish(decoded) && decoded !== originalText) results.push(decoded);
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    if (swapped.length % 2 === 0) {
      swapped.swap16();
      const decoded = swapped.toString('utf16le');
      if (strIsTextish(decoded) && decoded !== originalText) results.push(decoded);
    }
  }

  // Try base64 decode (common for embedded secrets)
  try {
    const b64 = originalText.trim();
    // Check if it looks like base64 (proper length, valid chars)
    if (/^[A-Za-z0-9+/=]+$/.test(b64) && b64.length % 4 === 0 && b64.length >= 20) {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (strIsTextish(decoded) && decoded !== originalText) {
        results.push(decoded);
        // Recursively try nested encodings
        const nested = decodeAndNormalize(Buffer.from(decoded, 'utf8'));
        for (const n of nested) if (!results.includes(n)) results.push(n);
      }
    }
  } catch {
    // ignore
  }

  // 2026-07-26 audit finding 4. This branch used `require('node:zlib')` inside
  // a .mjs module, where `require` is not defined — so it threw
  // `ReferenceError: require is not defined` (verified) the instant it was
  // reached, on every platform and every Node version. The catch swallowed it,
  // so gzip-packed secrets were never decoded and the scanner still reported
  // success. In scanLargeFile the same ReferenceError was thrown and discarded
  // once PER LINE.
  //
  // zlib is now imported at module scope (see the top of this file), which is
  // the only correct form here and cannot regress silently.
  try {
    const decompressed = zlib.gunzipSync(buf);
    const decoded = decompressed.toString('utf8');
    if (strIsTextish(decoded) && decoded !== originalText) {
      results.push(decoded);
      const nested = decodeAndNormalize(decompressed);
      for (const n of nested) if (!results.includes(n)) results.push(n);
    }
  } catch {
    // ignore
  }

  // Deduplicate
  return [...new Set(results)];
}

// 2026-08-24, X8. These two patterns were declared inside main(), which was fine while the only
// thing that scanned was a push. They are hoisted to module scope so the Write/Edit content scan
// added below uses the SAME definitions. A second copy of a security regex is exactly how this
// project's SEPARATOR_ROW_RE drifted out of sync with its siblings — one definition cannot drift.
//
// The reasoning behind each pattern is left in place at its original site inside main(), because it
// is long, dated and worth reading where it was written.
const SECRET_RE =
  /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]{16,}|sk-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRETVAR_RE =
  /(SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API[_-]KEY|ACCESS[_-]KEY|PRIVATE[_-]KEY)[A-Z0-9_-]{0,64}["']?[ \t]*[:=][ \t]*["'][A-Za-z0-9/+_.=-]{16,}["']/i;

// Hoisted with the two patterns above, and for the same reason: the write-content scan must honour
// the SAME opt-out marker as the push scan, or a line the project has deliberately exempted would
// be exempt in one scan and flagged in the other.
const SCAN_ALLOW_MARKER = '// scan-allow: known test fixture';
const isScanAllowed = (ln) => String(ln).trimEnd().endsWith(SCAN_ALLOW_MARKER);

function main() {
  // 2026-07-31 maintenance fix (F1): readStdin() now throws StdinReadFailure
  // rather than returning '' when it could not reliably read the tool-call
  // payload (see lib.mjs). Losing the payload here means losing both the
  // command text AND the cwd, which can make the studio-run check below
  // stand down on a command this scan never actually inspected — the exact
  // opposite of what a secret scan is for. Deny, don't allow, when the read
  // itself could not be trusted.
  let INPUT;
  try {
    INPUT = readStdin();
  } catch (e) {
    deny(
      `studio scan: refusing to allow — could not reliably read the tool-call payload from ` +
        `stdin (${e && e.message ? e.message : 'read failure'}). This can happen under a ` +
        `transient timing race between this hook and the process invoking it. Retry the ` +
        `command; refusing to let an unread command through unscanned.`,
    );
  }
  // 2026-07-31 further maintenance fix (R1 part 2, defence in depth): a
  // NON-EMPTY stdin payload that isn't valid JSON is not "no input" — it is
  // evidence of a read that produced something untrustworthy (truncated,
  // corrupted, or otherwise malformed), which extractCommand()/extractCwd()
  // both quietly turn into '' on a parse failure. Falling through on that ''
  // the same way genuinely-empty stdin does is exactly the bypass a lost or
  // truncated read created (see lib.mjs's readStdinCore fix above this same
  // maintenance pass): isPushCapable('') fails closed, but extractCwd('')
  // falling back to this process's own cwd can still resolve the WRONG
  // studio root and stand aside on a command this scan never actually inspected.
  // Denying here closes that residual regardless of how a future caller
  // might reintroduce a partial read. A genuinely empty string (real "no
  // data") is unaffected — only "got something, but it doesn't parse" denies.
  if (INPUT !== '') {
    try {
      JSON.parse(INPUT);
    } catch {
      deny(
        `studio scan: refusing to allow — the tool-call payload read from stdin is non-empty ` +
          `but is not valid JSON, so its command and working directory cannot be trusted. This ` +
          `can happen under a partial/corrupted read. Retry the command; refusing to let an ` +
          `unparsed payload fall through to an unscanned command.`,
      );
    }
  }
  const CMD = extractCommand(INPUT);

  // ---- X8 / X7: scan what is being WRITTEN, not only what is being pushed ---------
  //
  // `dev-memory/SKILL.md` carries a section headed "Scan before every write — never skip". Nothing
  // enforced it. The only PreToolUse matcher was `Bash|PowerShell|Monitor|run_command`, so no
  // `Write`, `Edit`, `MultiEdit` or `NotebookEdit` call ever reached this hook, and no `mcp__*` tool
  // did either unless its name happened to contain one of those four words (X7).
  //
  // WIDENING THE MATCHER ALONE WOULD HAVE BEEN A DISASTER, and measuring before changing it is the
  // only reason that is known rather than discovered afterwards. With the matcher widened and this
  // branch absent, a `Write` falls straight through to the push path — `isPushCapable('')` fails
  // closed to true on an empty command — and comes back `ask`. Measured: a Write of "hello world"
  // returned the PUBLISHING-CONSENT prompt, and a Write whose content held an AWS-shaped key
  // returned that same prompt saying "no secrets ... were found", because the scan had looked at the
  // git tree and never at the content. A consent prompt on every file write is the false alarm that
  // gets a plugin switched off within the hour.
  //
  // So a tool call that writes content is answered HERE and never reaches the push logic. It is
  // silent unless it finds something, which is what makes scanning every write affordable.
  //
  // 2026-08-24 — THIS BRANCH WAS GATED ON `if (!CMD)` AND THAT WAS WRONG THREE TIMES OVER. Found by
  // an axis-enumeration lens, every case reproduced against this hook, and the mistake was a single
  // false premise: that "carries a command" and "writes content" are mutually exclusive. They are
  // not, and the gate turned that premise into a switch anyone could flip.
  //
  //   1. `extractCommand()` returns `tool_input.command`, else `.script`, else `.CommandLine`. So ANY
  //      tool_input carrying one of those three field names made CMD truthy and skipped this entire
  //      branch. Measured: a `Write` with `{command:"echo hi", content:"<AWS-shaped key>"}` was
  //      SILENT, while the same payload without the command field denied. `command` is one of the
  //      commonest MCP parameter names, and the mcp__ arm below exists precisely for tools whose
  //      schema cannot be known — so the arm written to scan unknown tools was switched off by the
  //      commonest field an unknown tool has.
  //   2. Zero parts fell THROUGH to the push path, where `isPushCapable('')` fails closed to true.
  //      Ordinary deletions — `new_string: ""`, `content: ""`, `edit_mode: "delete"` — drew the
  //      publishing-consent prompt inside a git repo, and were DENIED outright in a studio project
  //      that is not yet a git repository. My own commit message for this branch claimed cases B,
  //      G1, G2, I and K locked exactly that out. They did not; see case K below.
  //   3. The mcp__ whole-input scan was gated on `!parts.length`, so an unrelated `content` key
  //      turned it off and a secret in any other field went unscanned.
  //
  // The shape of a call is now read from the TOOL, never from the absence of a command: the content
  // scan always runs, and only a write-shaped tool with NO command answers the call here. Anything
  // carrying a real command continues to the paths below, so X39's catastrophic-command refusal and
  // the push scan still see it — a `Write` payload with a stray `rm -rf /` in a command field must
  // not become unreachable in the course of fixing this.
  {
    // readStdin() returns the raw payload as a STRING — every helper here parses it internally — so
    // this parses it once rather than assuming an object. Getting that wrong cost a debugging pass:
    // `INPUT.tool_input` was silently `{}`, the branch fell through, and a Write kept returning the
    // publishing prompt.
    let payload = {};
    try {
      const parsed = JSON.parse(String(INPUT));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
    } catch {
      /* an unparseable payload is left to the paths below, which already refuse on a bad read */
    }
    const ti =
      payload.tool_input &&
      typeof payload.tool_input === 'object' &&
      !Array.isArray(payload.tool_input)
        ? payload.tool_input
        : {};
    const toolName = String(payload.tool_name || '');
    const parts = [];
    const take = (v) => {
      if (typeof v === 'string' && v.length) parts.push(v);
    };
    take(ti.content); // Write
    take(ti.new_string); // Edit
    take(ti.new_source); // NotebookEdit
    if (Array.isArray(ti.edits)) {
      // MultiEdit. `typeof [] === 'object'`, so the array check is not redundant.
      for (const e of ti.edits) {
        if (e && typeof e === 'object' && !Array.isArray(e)) take(e.new_string);
      }
    }
    // An MCP tool has no schema this hook can rely on, so its whole input is searched as text. That
    // is deliberately cruder than the named fields above, and it can only ever over-look rather than
    // over-claim: a hit is still a real pattern match on text the tool was about to send.
    // NOT gated on `!parts.length` — that was defect 3 above. An MCP input carrying a harmless
    // `content` key turned the whole-input scan off, so the same secret in the same field was
    // denied or ignored depending on whether an unrelated key happened to be present.
    const WRITE_TOOL = /^(?:Write|Edit|MultiEdit|NotebookEdit)$/i.test(toolName);
    const MCP_TOOL = /^mcp__/i.test(toolName);
    if (MCP_TOOL) {
      try {
        parts.push(JSON.stringify(ti));
      } catch {
        /* an input that will not serialise is left to the paths below */
      }
    }
    // A write-shaped tool with no command has nothing to do with pushing, so it is answered here
    // whatever the scan finds — including when it finds nothing to scan at all. That is defect 2:
    // falling through with zero parts is what put a publishing prompt on an ordinary deletion.
    const answersHere = (WRITE_TOOL || MCP_TOOL) && !CMD;

    // `findStudioRoot(...) === null` used to stepAside() from here. That is right for a call this
    // branch answers and WRONG for one it is only inspecting: a Bash command in a non-studio
    // directory would have had its push scan swallowed. So the not-a-studio-project case now skips
    // the content scan and lets the decision fall to `answersHere` below.
    const WRITE_DIR = extractCwd(INPUT) || process.cwd();
    const inStudio = findStudioRoot(WRITE_DIR) !== null;
    if (parts.length && inStudio) {
      const found = [];
      parts
        .join('\n')
        .split(/\r?\n/)
        .forEach((ln, n) => {
          if (isScanAllowed(ln)) return;
          if (SECRET_RE.test(ln)) found.push(`line ${n + 1}: a vendor-shaped key or token`);
          else if (SECRETVAR_RE.test(ln)) found.push(`line ${n + 1}: a secret-looking assignment`);
        });
      if (found.length) {
        // Names the LINE and the SHAPE, never the value — the same rule the push scan follows, so a
        // refusal message can never itself leak the thing it refused.
        deny(
          `studio scan: refusing to write — this ${toolName || 'edit'} would put ` +
            `${found.length === 1 ? 'a secret' : `${found.length} secrets`} into ` +
            `${typeof ti.file_path === 'string' ? ti.file_path : 'a file'}. ${found.join('; ')}. ` +
            'Nothing has been written. Put the value in an environment variable, or in a file your ' +
            'project ignores, and reference it from the code instead. If it is a deliberate test ' +
            'fixture, end the line with the scan-allow marker the dev-memory skill documents.',
        );
      }
    }
    if (answersHere) stepAside();
  }

  // ---- X39: refuse the irreversible ------------------------------------------------
  //
  // 2026-08-17. Until now nothing in this product refused `rm -rf /`, a raw write to a whole
  // disk, `mkfs` over a partition, or a history rewrite. Measured at the parent commit: all nine
  // such commands reached the machine with no decision from anything.
  //
  // WHY THIS IS NOT THE LAYER X214 REMOVED, because that distinction is the whole design. The
  // token layer was authorisation theatre — it tried to establish that a person had agreed, from
  // a file an agent could write, and X91 proved that cannot work. Here the evidence is IN THE
  // COMMAND TEXT: `rm -rf /` says what it does. Nothing is inferred about intent, nothing is
  // trusted, and there is no token to forge. Same basis as the secret scan that was kept: refuse
  // on evidence, never on a claim.
  //
  // WHY IT IS WORTH HAVING when Claude Code already prompts: the prompt protects an ATTENDED
  // session. In auto-accept it is absent, which is precisely when an inexperienced user — this
  // product's stated audience — is least able to catch `rm -rf /` scrolling past.
  //
  // WHY NAMED RULES AND NOT ONE REGEX. Four fixes this week over-reached by widening a pattern
  // past the case in front of it (L15: enumerate, never sweep). Each rule below is a named
  // predicate over TOKENS, so it can be read, and its reason is reported to the user rather than
  // a pattern being quoted at them. `rm -rf ./build` and `rm -rf node_modules` are among the most
  // common commands in software work; a block that caught either would be switched off and take
  // the real protection with it (L5). X39's reproduction holds 14 such commands as controls.
  // Each shell segment is judged on its OWN command position. Tokenising the whole line and
  // asking "does `mkfs` appear anywhere" cannot tell a command from a quotation: the hunt for
  // false alarms caught `echo "do not run mkfs.ext4 /dev/sda1"` and `echo rm -rf / > notes.txt`,
  // both of which only TALK about the danger. Same confusion as X206 (prose about the guardrail
  // satisfying the check for the guardrail) and X207 (commentary read as data).
  const PREFIXES = new Set(['sudo', 'env', 'time', 'nice', 'ionice', 'command', 'exec', 'xargs']);
  // 2026-08-18, X224: this split the RAW command text, so every bypass the canonicaliser exists to
  // close was open here — `r""m -rf /` and `\rm -rf /` both reached the machine with no decision at
  // all. normalizeForPushCheck is imported by this very file and relied on by its two other security
  // callers since July; the catastrophic rules were simply never routed through it.
  // 2026-08-18, X227: the SEPARATOR SET was incomplete and shell wrappers were absent entirely.
  // X223 varied POSITION and X224 varied SPELLING; neither varied the separator, so a lone
  // background `&`, a command substitution, and a `bash -c` / `sh -c` / `eval` wrapper were not
  // separators to this splitter at all. Six forms reached the machine with NO decision, and
  // `bash -c "rm -rf /"` defeated all four rules at once because the dangerous text was never a
  // segment.
  //
  // The correct set was already written down. X107's requirement, verbatim in the register: "a
  // separator, a pipe, a background `&`, a newline, or a substitution". X107 went `not-applicable`
  // when X214 deleted gate.mjs — the file that requirement lived in — so the knowledge was retired
  // with the file and this guard was never re-asked. L15 compounding L14.
  //
  // `&&` precedes `&` in the alternation so a logical-and is never split into two backgrounds.
  const SEGMENT_SEPARATORS = /(?:&&|\|\||[;|\n&])/;
  // Text inside a substitution or a shell wrapper is a command in its own right. Bounded at three
  // levels so a pathological nesting cannot spin; the bound is a real limit, not a claim of
  // completeness, and is disclosed in X227's reproduction.
  const unwrapShellText = (text, depth = 0) => {
    const out = [text];
    if (depth >= 3) return out;
    for (const m of String(text).matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
      const inner = m[1] ?? m[2];
      if (inner && inner.trim()) out.push(...unwrapShellText(inner, depth + 1));
    }
    // `bash -c "..."`, `sh -c '...'`, and `eval "..."`. The wrapper binary is matched at a command
    // position, so prose merely mentioning it contributes nothing (the X39 false-alarm lesson).
    for (const m of String(text).matchAll(
      /(?:^|[\s;&|(])(?:(?:ba|z|k|da)?sh\s+(?:--?[A-Za-z][A-Za-z0-9-]*\s+)*-[A-Za-z]*c|eval)\s+(['"])([\s\S]*?)\1/g,
    )) {
      const inner = m[2];
      if (inner && inner.trim()) out.push(...unwrapShellText(inner, depth + 1));
    }
    // 2026-08-24, X285: the flag was `(?:-[A-Za-z]+\s+)*-c`, which requires `-c` to stand ALONE as
    // its own token. `bash -lc "rm -rf /"` and `bash --login -c "rm -rf /"` therefore reached the
    // machine with no decision from the only guard that exists to stop it being destroyed — and
    // `bash -lc` is one of the commonest spellings of `bash -c` in existence. Now: any run of short
    // or long options, then a cluster whose LAST letter is `c`, because `-c` consumes the argument
    // after it and so must be last in its cluster. `-cl` is deliberately not matched.
    //
    // And the UNQUOTED payload, `bash -c rm\ -rf\ /`, which the pattern above cannot see at all
    // because it requires a quote pair. Everything after the flag is taken as the payload; the
    // canonicaliser resolves the escapes when the payload is re-normalised on the next pass.
    for (const m of String(text).matchAll(
      /(?:^|[\s;&|(])(?:(?:ba|z|k|da)?sh\s+(?:--?[A-Za-z][A-Za-z0-9-]*\s+)*-[A-Za-z]*c|eval)\s+([^'"\s][^\n]*)/g,
    )) {
      const inner = m[1];
      if (inner && inner.trim()) out.push(...unwrapShellText(inner, depth + 1));
    }
    return out;
  };
  // Each unwrapped payload is canonicalised in its own right, not just the outer command. Found by
  // testing the CROSS PRODUCT of the four axes rather than each alone: `bash -c "\rm -rf /"` slipped
  // through because the outer normalisation does not reach an escape inside quotes, so the payload had
  // to be normalised after unwrapping. 54 cross cases now hold; three did not before this line.
  const segments = unwrapShellText(String(normalizeForPushCheck(String(CMD || '')) || ''))
    .flatMap((text) =>
      String(normalizeForPushCheck(String(text)) || text).split(SEGMENT_SEPARATORS),
    )
    .map((seg) => seg.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
  // The tokens of every segment whose command position is one we care about; a segment led by
  // `echo`, `grep` or `man` contributes nothing.
  const commandSegments = segments.map((t) => {
    let i = 0;
    while (i < t.length && (PREFIXES.has(t[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]))) i += 1;
    return t.slice(i);
  });
  // 2026-08-18, X224: the command word is stripped of surrounding quotes before matching, because
  // `"rm" -rf /` and `'rm' -rf /` are the same command to a shell and were silent here. The
  // canonicaliser above resolves splicing and escapes but leaves a wholly quoted word intact.
  const cmdWord = (t) =>
    String(t[0] || '')
      .replace(/^['"]+/, '')
      .replace(/['"]+$/, '');
  // 2026-08-24, X285: the command WORD was canonicalised here since X224 and the OPERAND never was,
  // so the danger simply moved one token to the right. `rm -rf //`, `rm -rf /.`, `rm -rf "/*"`,
  // `dd if=/dev/zero of="/dev/disk0"` and `mkfs.ext4 "/dev/sda1"` all rendered NO DECISION while
  // their unquoted, single-slash twins were refused. Found by an axis-enumeration lens: X39 varied
  // position, separator, wrapper and command-word spelling — four axes, thoroughly, with 24
  // false-alarm controls — and held the operand at exactly one canonical form throughout.
  //
  // Quotes off, then the path RESOLVED: `//`, `/.`, `/./`, `/..` and `/foo/..` all name the root
  // directory to a shell and must be judged as the root. `.` and `..` segments are resolved rather
  // than stripped, so `/tmp/..` collapses to `/` and is caught while `/tmp/x` does not.
  //
  // WHAT MUST NOT CHANGE, and the reason this is a resolver and not a looser pattern: `./build`,
  // `node_modules`, `../x` and `/tmp/x` are among the commonest operands in software work. Each
  // resolves to itself or to a relative path, never to `/`. A rule that caught any of them would be
  // switched off within the week and take the real protection with it (L5). X39 holds 24 such
  // commands as controls and every one of them still passes.
  const pathWord = (raw) => {
    const bare = String(raw || '')
      .replace(/^['"]+/, '')
      .replace(/['"]+$/, '');
    if (!bare.startsWith('/')) return bare;
    const kept = [];
    for (const seg of bare.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        kept.pop();
        continue;
      }
      kept.push(seg);
    }
    return '/' + kept.join('/');
  };
  const leads = (re) => commandSegments.filter((t) => t.length && re.test(cmdWord(t)));
  // 2026-08-18, X223: `const tokens = commandSegments.flat()` and `const has = (t) =>
  // tokens.includes(t)` stood here, computed for exactly the job below and never consumed once —
  // eslint had been reporting "'has' is assigned a value but never used" throughout. Removed rather
  // than wired in: a variable that LOOKS like it inspects the whole command, sitting beside code that
  // inspects one segment of it, is how a reader concludes the compound case is covered.
  const CATASTROPHIC_RULES = [
    {
      why: 'this deletes the entire filesystem, not a directory in your project',
      lead: /^(.*\/)?rm$/i,
      judge: (seg) => {
        const f = seg.filter((t) => /^-[a-zA-Z]+$/.test(t)).join('');
        const recursive = /r/i.test(f) || seg.includes('--recursive');
        // 2026-08-18, X224: `-RF` is the same flag set as `-rf` to rm, and the recursive test was
        // already case-insensitive while the force test was not — so the pair disagreed with itself.
        const forced = /f/i.test(f) || seg.includes('--force');
        const targets = seg.slice(1).filter((t) => !t.startsWith('-'));
        // The ROOT itself, or the root glob — never /tmp/x, ./build or node_modules. Both are now
        // read through pathWord, so `//`, `/.`, `/./`, `"/"`, `'/*'` and `/tmp/..` are the same
        // target as `/`, which is what they are to a shell.
        const root = targets.some((t) => {
          const p = pathWord(t);
          return p === '/' || p === '/*';
        });
        return recursive && (forced || seg.includes('--no-preserve-root')) && root;
      },
    },
    {
      why: 'this writes raw bytes over a whole disk device, destroying every partition on it',
      lead: /^(.*\/)?dd$/i,
      judge: (seg) => {
        // of=/dev/<device>. The pseudo-devices are ordinary and stay allowed.
        const SAFE = /^\/dev\/(null|zero|random|urandom|stdout|stderr|tty|fd\/\d+)$/;
        return seg.some((t) => {
          // The quotes may sit around the whole assignment or only its value — `"of=/dev/disk0"`
          // and `of="/dev/disk0"` are the same to a shell, and neither was seen before.
          const m = pathWord(t).match(/^of=(.+)$/) || String(t).match(/^of=(.+)$/);
          if (!m) return false;
          const dev = pathWord(m[1]);
          return dev.startsWith('/dev/') && !SAFE.test(dev);
        });
      },
    },
    {
      why: 'this formats a disk device, erasing everything already on it',
      lead: /^(.*\/)?mkfs(\.[a-z0-9]+)?$/i,
      judge: (seg) => {
        if (seg.includes('--help') || seg.includes('-h')) return false;
        return seg.some((t) => pathWord(t).startsWith('/dev/'));
      },
    },
    {
      why: 'this rewrites the whole history of the repository and cannot be undone',
      lead: /^(.*\/)?git$/i,
      judge: (seg) => {
        if (!seg.includes('filter-branch')) return false;
        return !(seg.includes('--help') || seg.includes('-h'));
      },
    },
  ];

  for (const rule of CATASTROPHIC_RULES) {
    let fired = false;
    try {
      // 2026-08-18, X223: this was `rule.hit()`, and each rule resolved its own segment with
      // `leads(re)[0]` — the FIRST segment led by that binary, every later one discarded. So
      // `rm -rf ./build && rm -rf /` produced NO DECISION AT ALL while `rm -rf /` alone was
      // refused, and the same held for dd, mkfs and filter-branch: six holes, verified. The
      // splitter above was written precisely to handle compounds, and then the enumeration stopped
      // at index 0 — L15 in its purest form, and L14 because all four rules carried it.
      //
      // Every matching segment is now judged, in ONE place, so the four rules cannot drift apart.
      fired = leads(rule.lead).some((seg) => rule.judge(seg));
    } catch {
      fired = false; // a rule that throws must never become a denial of ordinary work
    }
    if (fired) {
      deny(
        `studio: refusing to run this — ${rule.why}.\n\n` +
          `    ${CMD}\n\n` +
          'This is one of a very short list of commands the studio will not run, because they ' +
          'destroy work irreversibly and no confirmation can undo them. If you genuinely intend ' +
          'it, run it yourself in a terminal outside this session.',
      );
    }
  }

  // 2026-08-24, X5 / X6 / X15 — Phase 3, "escalate instead of guess". PROGRESS.md gated this on
  // Phase 0's effect being measured first; that measurement was taken on 2026-08-22 (RESIDUALS gap 9).
  //
  // Before standing aside, RESOLVE the indirection rather than guessing at it from the command's
  // wording. `isPushCapable` decides whether `npm run build` might publish by testing the string
  // against six words (deploy|release|publish|ship|public|visibility), so `npm run deploy` was
  // scanned and `npm run build` was not — on nothing but the name someone gave the script. Measured
  // at HEAD before this change, the three commands X5 names — `bash build.sh`, `npm run build`,
  // `make all` — reached the network with no scan whatever.
  //
  // Widening the word list is the move that has already failed eleven times, and X15 says why: you
  // cannot enumerate what people call their scripts. So the script is READ instead. A resolved script
  // that does not push stays silent, which is what makes this safe to turn on — it is not a new guess
  // that can be wrong in a new direction, it is the same question asked of the real content.
  const SESSION_DIR = extractCwd(INPUT) || process.cwd();
  let indirection = null;

  if (!isPushCapable(CMD)) {
    indirection = resolveScriptChain(CMD, SESSION_DIR);
    if (indirection === null || !isPushCapable(indirection.text)) {
      // X6's unresolvable half. `curl … | sh` runs code that does not exist on this machine until the
      // moment it runs, so no amount of reading finds it, and the ratified architecture — fail closed
      // to `ask` on anything that cannot be classified — is the only honest answer. Narrow on purpose:
      // an ask on every pipeline would be the false alarm that gets a guard switched off.
      if (pipesRemoteCodeIntoAnInterpreter(CMD) && findStudioRoot(SESSION_DIR) !== null) {
        escalate(
          'studio scan: this downloads a script from the internet and runs it straight away, so there ' +
            'is no moment at which anyone — including me — can read what it will do. I cannot tell you ' +
            'whether it publishes anything, changes your files or sends anything out. If you know and ' +
            'trust the source, say yes. If you would rather look first, save it to a file, read it, ' +
            'then run that file.',
        );
      }
      // Not push-capable, and nothing resolvable says otherwise: nothing to scan. NO decision (X1).
      stepAside();
    }
  }
  const STUDIO_ROOT = findStudioRoot(SESSION_DIR);
  if (STUDIO_ROOT === null) {
    // Not a studio project: never interfere.
    stepAside();
  }

  // 2026-07-10 audit fix (MAJOR): the fallback used to be STUDIO_ROOT, an
  // already-absolute path, which made path.resolve() silently discard
  // SESSION_DIR — so a `cd <temp-clone>` in one Bash call followed by a bare
  // `git push` in a LATER call scanned the original project root instead of
  // the tree actually being pushed. Fallback is now SESSION_DIR, the actual
  // working directory of THIS command.
  //
  // 2026-07-31 maintenance fix: moved above the Dev-Memory-gitignore check
  // just below (it used to run after this), because that check now needs
  // REPO to compare the push target's work tree against STUDIO_ROOT's — see
  // that check's own comment for why.
  const REPO = path.resolve(SESSION_DIR, resolvePushTree(CMD, SESSION_DIR));

  if (!git(['rev-parse', '--is-inside-work-tree'], REPO).ok) {
    deny('studio scan: not a git work tree; cannot prove the push set is clean');
  }

  // 2026-07-31 maintenance fix (real gap, found live): this project's own
  // documented rule — Dev-Memory/ never ships, it stays local-only (the
  // "Local-only, and never shipped" section of the dev-memory skill, and the
  // matching line in checkpoint-commit's skill) — had NO mechanical check
  // proving that rule is actually in force. The scan further below
  // (DEVMEMORY_RE / addFinding('dev-memory', …)) only ever catches a
  // Dev-Memory FILE that happens to already be in THIS push's tracked,
  // staged, or untracked-non-ignored file set — it says nothing about
  // whether Dev-Memory/ is genuinely excluded by .gitignore at all. An
  // empty, just-created Dev-Memory folder (nothing in it yet, so nothing for
  // git ls-files to report) or a project whose .gitignore was later edited
  // to drop the rule sails through with zero findings until the next file
  // happens to land inside it. This is a second, independent, PREVENTIVE
  // check — not a replacement for the one below — firing purely on whether
  // Dev-Memory/ exists on disk and is actively excluded, regardless of what
  // this particular push happens to contain.
  //
  // "Actively excluded" is decided by asking git itself (`git check-ignore`),
  // never a hand-rolled pattern matcher: this file already delegates every
  // other gitignore decision to git (the FILES set below is built from `git
  // ls-files --exclude-standard`; the force-add path further down uses `git
  // ls-files --ignored --exclude-standard`) rather than parsing .gitignore
  // text by hand — the same discipline licence-scan.mjs documents choosing
  // ("a bounded recursive walk rather than a full .gitignore parser").
  // Reusing git's real matcher also gets a subtlety right for free that a
  // naive string/regex check would not: git does NOT report an
  // already-TRACKED path as ignored, no matter how the pattern reads —
  // correctly so, since a Dev-Memory folder committed before any .gitignore
  // rule existed will still ship on this push regardless of the rule, and
  // this check must fail closed in exactly that case, not pass it.
  //
  // Only fires when Dev-Memory/ holds at least one real file (see
  // devMemoryHasAnyFile above) — an empty Dev-Memory/ cannot be tracked or
  // shipped by git at all, so it is not a violation of anything.
  //
  // Suspended, exactly once, by a fresh memory-persist-approved token
  // (memoryPersistAllowed) — the same opt-in the dev-memory finding below
  // already defers to. Without this exemption, a deliberate, freshly
  // confirmed opt-in push of Dev-Memory to a private branch would be denied
  // by THIS check for the very reason it was just approved (Dev-Memory not
  // being gitignored is the point of that opt-in) — weakening, not
  // reinforcing, the existing mechanism, which the fix for this gap must not
  // do.
  // 2026-07-31 further-pass maintenance fix (F5, independent reviewer
  // finding): findStudioRoot() walks up the FILESYSTEM looking for a
  // Dev-Memory/ folder — it can find one in a PARENT directory that isn't a
  // git repository at all (or is a different, unrelated repository), while
  // the tree actually being pushed (REPO, just resolved above) is a
  // separate, clean child repo with no Dev-Memory/ of its own. The check
  // below used to run `git check-ignore` at STUDIO_ROOT unconditionally and
  // treat "git errored because there's no repository there" (exit 128) the
  // same as "genuinely not ignored" (exit 1) — denying an entirely innocent
  // push, with advice ("add Dev-Memory/ to .gitignore") that cannot possibly
  // fix the reported problem since there is no relevant .gitignore to add it
  // to. Reproduced: a parent folder holding a real Dev-Memory/notes.md with
  // NO .git anywhere in it, containing a genuinely separate, clean git repo
  // with no Dev-Memory/ of its own — a push from that clean child repo was
  // denied.
  //
  // Fixed by only running this check when STUDIO_ROOT and REPO resolve to
  // the SAME work tree (`git rev-parse --show-toplevel` from each,
  // compared) — if they differ, or if STUDIO_ROOT isn't a git repository at
  // all (rev-parse fails there), this check does not apply and is skipped
  // entirely, never denied. Separately, `git check-ignore` exit 1 ("not
  // ignored" — the genuine violation) is now distinguished from any OTHER
  // non-zero exit (e.g. 128, "not a git repository" — an execution failure,
  // not an answer): only exit 1 denies; any other failure skips the check
  // rather than denying on a tool failure with a misleading fix suggestion.
  if (!memoryPersistAllowed(STUDIO_ROOT)) {
    const devMemoryPath = path.join(STUDIO_ROOT, 'Dev-Memory');
    let devMemoryExists = false;
    try {
      devMemoryExists = fs.statSync(devMemoryPath).isDirectory();
    } catch {
      devMemoryExists = false;
    }
    if (devMemoryExists && devMemoryHasAnyFile(devMemoryPath)) {
      // Deliberately checked against STUDIO_ROOT (the project root
      // findStudioRoot just resolved), not REPO — REPO is the tree THIS push
      // command targets (which a `cd <temp-clone> && git push` can point
      // somewhere else entirely), while Dev-Memory/ always lives at the
      // studio project's own root by construction (see findStudioRoot). git
      // resolves the enclosing repository and the pathspec relative to the
      // given cwd on its own, exactly as every other git(...) call in this
      // file already relies on — but ONLY when that repository is actually
      // the one being pushed; see the same-work-tree guard immediately below.
      const studioTop = git(['rev-parse', '--show-toplevel'], STUDIO_ROOT);
      const repoTop = git(['rev-parse', '--show-toplevel'], REPO);
      const sameWorkTree =
        studioTop.ok &&
        repoTop.ok &&
        path.resolve(studioTop.stdout.trim()) === path.resolve(repoTop.stdout.trim());
      if (sameWorkTree) {
        const ignoreCheck = git(['check-ignore', '-q', '--', 'Dev-Memory'], STUDIO_ROOT);
        if (ignoreCheck.status === 1) {
          deny(
            'studio scan: refusing to push — Dev-Memory/ exists in this project but is not ' +
              "excluded by .gitignore, so it would ship. This project's rule is that Dev-Memory/ " +
              'never ships and always stays local-only (see the dev-memory and checkpoint-commit ' +
              'skills). Fix: add Dev-Memory/ to .gitignore at the project root, then retry.',
          );
        }
      }
    }
  }

  // ---- build the working-tree/index/untracked would-ship file set ------------
  // (the unpushed-commit history is scanned separately, after this loop)
  //
  // 2026-07-31 further-pass maintenance fix (F6, independent reviewer
  // finding). `git ls-files` (and `git ls-files --others --exclude-standard`)
  // with NO pathspec defaults to "files under the current directory", not
  // "files in the repository" — unlike `git diff --cached --name-only`
  // just below, which is already always repo-root-relative regardless of
  // cwd. REPO is the actual working directory of the command being scanned
  // (resolved above from `git -C`/`cd`, or SESSION_DIR); when a push is run
  // from a SUBDIRECTORY of the repo rather than its root, REPO is that
  // subdirectory, and both bare `ls-files` calls silently went blind to
  // every file elsewhere in the repo — tracked files outside REPO, and
  // untracked files (including a secret-shaped one) outside REPO — despite
  // those files still being part of what a `git push` from there ships.
  // Reproduced: from a repo root, `other/creds.txt` (tracked) and
  // `sub/untracked-secret.txt` (untracked); run from `sub/`, plain `git
  // ls-files` returned nothing (missing `other/creds.txt`, which is not
  // under `sub/`) and `git ls-files --others --exclude-standard` returned
  // only `untracked-secret.txt` relative to `sub/` — `other/creds.txt` never
  // appeared in either. Run from the repo root, both calls saw it.
  //
  // Fixed with the `:/` pathspec (git's "top of the work tree, regardless of
  // cwd" magic pathspec — see gitglossary(7) — not used elsewhere in this
  // codebase yet, so introduced here rather than reusing an existing
  // convention). Anchoring to `:/` restores full-repo coverage while git
  // still reports each path RELATIVE TO cwd (REPO), using a leading `../` for
  // anything outside REPO — so the existing `path.join(REPO, f)` a few lines
  // below (and in the force-add loop just after this) keeps resolving to the
  // correct absolute file with no further change: `path.join('/repo/sub',
  // '../other/creds.txt')` correctly yields `/repo/other/creds.txt`. Verified
  // by execution against the same reproduction above.
  //
  // 2026-07-31 second further-pass fix (R2, independent reviewer finding):
  // `git diff --cached --name-only` returns paths relative to the REPO ROOT
  // regardless of cwd (verified by execution — unlike the two `ls-files`
  // calls above, it never adopted the `:/`-relative-to-REPO convention).
  // Joined against REPO with the same `path.join(REPO, f)` as the other two
  // sources, a repo-root-relative path from a subdirectory push resolves to
  // the wrong (usually nonexistent) file — harmless for coverage today, since
  // every staged file is also reported correctly by the `ls-files -- :/` call
  // above, but it leaves a dead, wrongly-resolved entry in FILES. Converted
  // below to the same REPO-relative convention as the other two sources by
  // resolving each path against the repo's own toplevel, then taking it
  // relative to REPO — so all three sources agree before path.join(REPO, f).
  const repoToplevelForDiff = git(['rev-parse', '--show-toplevel'], REPO);
  const nulParts = (buf) =>
    buf
      .toString('utf8')
      .split('\0')
      .filter((s) => s.length > 0);
  const fileSet = new Set();
  for (const p of nulParts(git(['ls-files', '-z', '--', ':/'], REPO, 'buffer').stdout))
    fileSet.add(p);
  for (const p of nulParts(git(['diff', '--cached', '--name-only', '-z'], REPO, 'buffer').stdout)) {
    if (repoToplevelForDiff.ok) {
      fileSet.add(path.relative(REPO, path.join(repoToplevelForDiff.stdout.trim(), p)));
    } else {
      fileSet.add(p); // couldn't resolve toplevel; fall back to the raw (possibly wrong) path rather than dropping it
    }
  }
  for (const p of nulParts(
    git(['ls-files', '--others', '--exclude-standard', '-z', '--', ':/'], REPO, 'buffer').stdout,
  ))
    fileSet.add(p);
  // 2026-07-21 Round 13 audit fix (HIGH): if THIS command force-adds ignored
  // files (`git add -f <path>` / `git add -A -f`), include the gitignored files
  // it would stage — otherwise a compound add+commit+push ships them unscanned.
  // Scoped to the force-add pathspecs, so a normal push (and a force-add of a
  // single file) never sweeps in unrelated ignored trees such as node_modules.
  for (const spec of extractForceAddPathspecs(CMD)) {
    const out = git(
      ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', spec],
      REPO,
      'buffer',
    );
    if (out.ok) for (const p of nulParts(out.stdout)) fileSet.add(p);
  }
  const FILES = Array.from(fileSet).sort();

  const MAX_SCAN_BYTES = 4 * 1024 * 1024;
  // 2026-07-26: the ceiling on how large a COMPRESSED/UTF-16 file we will fully
  // read into memory to attempt decompression/decoding for a large file (see the
  // st.size > MAX_SCAN_BYTES branch below). Kept modest and separate from
  // MAX_SCAN_BYTES itself so this stays a bounded, proportionate peek rather
  // than a general licence to buffer arbitrarily large files.
  const MAX_PACKED_PEEK_BYTES = 4 * MAX_SCAN_BYTES;
  // The cap on the DECOMPRESSED size we'll accept (via gunzipSync's
  // maxOutputLength). This deliberately is NOT the same as MAX_SCAN_BYTES:
  // setting it equal to MAX_SCAN_BYTES was tried first and was wrong — verified
  // by execution, it reintroduced the exact bug it was meant to fix. The whole
  // reason a file lands in this branch is that its SIZE exceeds MAX_SCAN_BYTES,
  // and a realistic large gzip archive (a log dump, a bundled config) commonly
  // decompresses to well over 4 MB of perfectly ordinary text, so capping the
  // OUTPUT at the same 4 MB threw on exactly the realistic case and silently
  // fell through to the byte-level streaming scan, which cannot see inside
  // compressed data. A materially larger ceiling is still finite — it bounds a
  // malicious decompression bomb to a fixed amount of memory — while actually
  // covering the case this fix exists for.
  const MAX_PACKED_INFLATED_BYTES = 64 * 1024 * 1024;

  // 2026-07-10 audit fix (MINOR): sk-[A-Za-z0-9]{20,} required contiguous
  // alphanumerics right after "sk-", missing today's hyphenated key formats
  // (sk-ant-api03-..., sk-proj-...). Loosened to tolerate internal hyphens.
  // SECRET_RE is now defined at module scope — see the note above main(). Moved
  // 2026-08-24 (X8) so the write-content scan uses the SAME pattern rather than a
  // second copy; a hand-maintained duplicate of a security regex is how this project
  // found SEPARATOR_ROW_RE drifted out of sync with its siblings.
  // 2026-07-11 fix (found live, pushing this very repo): this project's own
  // test fixtures (hooks.test.mjs) deliberately embed a realistic-looking
  // fake secret (AWS's own reserved "EXAMPLE"-suffixed placeholder key) so
  // the tests can prove the scanner actually catches AKIA-shaped keys —
  // which means the scanner then flags its own test file's source line.
  // A blanket allow-list for that string would be wrong: the test also
  // writes the identical string into a fresh temp repo and asserts scan.mjs
  // DENIES it there, so exempting the string everywhere would silently
  // break that real detection case too. Instead, only a line ending in the
  // explicit marker `// scan-allow: known test fixture` is exempt — this
  // marks ONE deliberately-annotated source line, not the string itself.
  // SCAN_ALLOW_MARKER is now at module scope (X8, 2026-08-24) so the write-content scan shares it.
  // 2026-08-17 X218 fix (the code half of X205): ten enforcement sites each asked
  // whether the line merely CONTAINED the marker, which is not the question the
  // comment above states. Containment honours the marker ANYWHERE on the line — inside a JSON
  // string value, inside a `/* */` block, or with further code after it — so a real
  // secret sharing such a line went unreported. Now one named helper asks the
  // documented question, in one place, for all ten: is the marker the LAST thing on
  // the line?
  //
  // Measured before tightening, because a fix that withdraws a real exemption is
  // worse than the loose test it replaces: 16 lines in this repository carry the
  // marker, 12 as a trailing comment (the genuine exemptions, all in test files) and
  // 4 inside scan.mjs's own definition and comments — and those four carry no
  // secret, so they never needed exempting. The tightening therefore costs nothing
  // real. X218 control A pins the trailing case and control D pins the whole tree.
  //
  // The register recorded SIX sites; there are ten. That miscount is precisely why
  // this is a helper and not ten corrected call sites (L14): sites that each carry
  // their own copy of a rule are sites that drift.
  // isScanAllowed is now at module scope (X8, 2026-08-24) so the write-content scan shares it.
  // Widened variable-name class to [A-Z0-9_-] so hyphenated header/field
  // names like "x-api-key" are also caught, not just underscore_case.
  // 2026-07-10 Round 2 fix: also allow an optional closing quote between the
  // key name and the colon/equals, so quoted JSON/dict-style keys like
  // `"x-api-key": "..."` match, not just unquoted `X_API_KEY = "..."`.
  //
  // 2026-07-11 fix (found by actually running the scanner against this
  // repo, not just reviewing the regex): the value side previously had an
  // OPTIONAL leading quote, so `token = crypto.createHash(...)` — completely
  // ordinary code, not a secret — matched, because "token", "=", and 17
  // letters-and-a-dot ("crypto.createHash") satisfied the pattern. The
  // value's quotes are now REQUIRED: a real hardcoded secret is a string
  // literal, not a function call or expression, so requiring the value to
  // actually be quoted eliminates this whole class of false positive
  // without losing real detections (every example in this file's own
  // security review used a quoted literal).
  // SECRETVAR_RE is now defined at module scope — see the note above main(). Moved
  // 2026-08-24 (X8) so the write-content scan uses the SAME pattern rather than a
  // second copy; a hand-maintained duplicate of a security regex is how this project
  // found SEPARATOR_ROW_RE drifted out of sync with its siblings.
  // 2026-07-26 further-pass audit fix (false-allow, confirmed by execution):
  // no `/i` flag, and — unlike DEVMEMORY_RE just below, whose case
  // sensitivity is explained and deliberate — nothing here says this was on
  // purpose, because it wasn't. `.ENV`, `id_rsa.PEM` (any case variant of a
  // key-file name) are ordinary, legal filenames on every OS this project
  // targets, not something requiring a case-insensitive filesystem. This
  // filename check is the ONLY backstop for `.env`-style files: SECRETVAR_RE
  // above requires a quoted value, but real .env files conventionally use
  // unquoted `KEY=value`, which matches neither secret regex. So a file
  // named `.ENV` holding ordinary unquoted secrets shipped undetected.
  // 2026-08-07 audit fix (found by execution). This listed only `id_rsa` — the
  // LEGACY SSH key name — and missed every modern one. `id_ed25519` has been
  // ssh-keygen's recommended type since OpenSSH 7.8 (2018) and is the common
  // default today, so the backstop covered the name that is going away and not
  // the one people actually have.
  //
  // Scoped honestly: for a normal SSH key this changed nothing, because a real
  // key is PEM text and SECRET_RE's `-----BEGIN [A-Z ]*PRIVATE KEY-----` already
  // catches it whatever the file is called (verified — an OpenSSH ed25519 key and
  // an EC key were both caught as `secret` before this fix). The gap was the case
  // this filename rule exists for: content the regexes cannot see. Reproduced
  // with a DER-encoded (binary) private key, which is not textish so it is never
  // content-scanned — byte-identical files shipped as `allow` when named
  // `id_ed25519` and were correctly blocked when named `id_rsa`.
  //
  // The `$` anchor is load-bearing and deliberately kept: `id_ed25519.pub` is a
  // PUBLIC key and must stay clear, exactly as `id_rsa.pub` already did.
  const KEYFILE_RE =
    /(^|\/)(\.env(\..+)?|.+\.env|id_(rsa|dsa|ecdsa|ed25519|ed448)|.+\.pem|.+\.key)$/i;
  // 2026-07-11 Round 5 audit fix (case-sensitive ON PURPOSE — the `/i` flag
  // was removed): the studio always creates a project's private working
  // memory as `Dev-Memory` (capital D, capital M — see findStudioRoot,
  // confirm-publish.mjs, every skill). With `/i`, this ALSO matched the
  // plugin's OWN `plugins/gru953-studio/skills/dev-memory/` skill directory,
  // so once that skill was correctly committed (it had been silently
  // gitignored by the same case confusion), the scanner flagged the
  // plugin's own legitimate skill as if it were the forbidden private-memory
  // folder — which would block every push of GRU953-Studio itself. Matching
  // the exact canonical `Dev-Memory` casing protects the real target (a
  // built project's private memory) without catching the lowercase skill.
  const DEVMEMORY_RE = /(^|\/)Dev-Memory(\/|$)/;

  // 2026-08-13, finding X22 (reproduced by execution — see
  // test/repro/X22-cannot-push-own-repo.mjs). This scanner refused to let its OWN
  // repository be pushed: eight of the sixteen findings came from its own
  // committed golden test fixture, which lives at
  // `plugins/gru953-studio/hooks/test/fixtures/dev-memory/golden/Dev-Memory/` and
  // is named that way precisely because it is a fixture OF a Dev-Memory folder.
  //
  // The consequence was not cosmetic. Either the maintainer pushed with these
  // hooks inactive — so the product's flagship protection was never dogfooded on
  // its own source — or releasing was blocked outright. During the session that
  // found this, the hook denied seven ordinary maintenance commands, several
  // merely for mentioning publishing in passing.
  //
  // 2026-08-13, independent-review findings F3 and a cwd defect found alongside
  // it. My first attempt used a path REGEX,
  // `/(^|\/)plugins\/gru953-studio\/hooks\/test\/fixtures\/[^\s]*Dev-Memory(\/|$)/`,
  // and it was wrong in both directions at once:
  //
  //   * TOO WIDE. It was not bound to this plugin's repository at all, and
  //     `[^\s]*` crosses `/`. Reproduced: an unrelated throwaway repo tracking
  //     `plugins/gru953-studio/hooks/test/fixtures/anything/Dev-Memory/PROGRESS.md`
  //     shipped that private memory completely unflagged. Only the directory NAMES
  //     matched; nothing tied it to this product.
  //   * TOO NARROW. `scan.mjs` reports paths relative to the pushing command's own
  //     working directory, not the repository root. Reproduced: pushing from the
  //     repo root was exempt, and pushing the identical tree from the `hooks/`
  //     subdirectory reported all eight findings again — so X22 came back
  //     depending on where the person happened to be standing.
  //
  // Both are fixed by not pattern-matching a path at all. This hook lives INSIDE
  // the plugin, so its own location on disk identifies the one fixture directory
  // that may be exempt, absolutely and unambiguously. A file qualifies only if its
  // resolved absolute path is inside that exact directory. Nothing about the
  // scanned repository's layout, name, or the caller's cwd can satisfy it by
  // accident, and a real project's `Dev-Memory/` can never be inside this
  // plugin's own committed test fixtures.
  //
  // The secret-shaped strings in `hooks.test.mjs` are handled separately, by the
  // existing `// scan-allow: known test fixture` marker — one annotated LINE, so
  // the tests asserting those same strings ARE caught in a real project keep
  // working.
  // Windows filesystems are case-insensitive, so a path that differs only in case
  // is the SAME file there. Comparing case-sensitively would silently fail to
  // recognise this plugin's own fixture on the windows CI leg and reinstate X22 —
  // a failure that would look like a Windows-only mystery rather than a comparison
  // bug. Normalised on win32 only, so nothing changes on Linux or macOS where case
  // genuinely distinguishes two different files.
  const samePathCase = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const OWN_FIXTURE_DIR = samePathCase(
    path.resolve(HOOKS_DIR, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory') + path.sep,
  );
  // 2026-08-17 X217 fix (HIGH): `base` is a REQUIRED argument, because the two callers
  // below hold paths measured from DIFFERENT directories and this helper cannot tell
  // which it was handed. It previously resolved everything against REPO — the directory
  // the command was issued from — which is right for the working-tree scan and wrong for
  // the history scan, whose paths `git diff` prints relative to the repository TOPLEVEL.
  // From the repo root the two coincide, so the exemption worked; from a subdirectory they
  // do not, and this plugin's own committed fixture was refused. Naming the base at each
  // call site is what stops that being assumed again. Omitting it makes `path.resolve`
  // throw, which lands in the `catch` and refuses — the safe direction, never a silent
  // exemption.
  const isOwnTestFixture = (f, base) => {
    try {
      return samePathCase(path.resolve(base, String(f)) + path.sep).startsWith(OWN_FIXTURE_DIR);
    } catch {
      return false; // unresolvable path is never exempt
    }
  };
  // Where a HISTORY path is measured from. `git diff` prints paths relative to the
  // repository toplevel regardless of cwd. If the toplevel cannot be read the fallback is
  // REPO, which is exactly the old behaviour: correct from the root, over-strict from a
  // subdirectory — so an unreadable toplevel costs an exemption, never a missed secret.
  const HISTORY_PATH_BASE = repoToplevelForDiff.ok ? repoToplevelForDiff.stdout.trim() : REPO;

  // Opt-in cloud memory persistence: with a valid token, a Dev-Memory path is
  // no longer an automatic finding — but the secret/key-file scan below still
  // runs on every file, Dev-Memory included, so a secret can never ride along.
  const allowDevMemory = memoryPersistAllowed(STUDIO_ROOT);

  const findings = [];
  const addFinding = (type, file, line) => {
    findings.push(redact(type, file, line));
  };
  // Scan one file's text for both secret patterns in a single pass over its lines
  // (was two separate passes). The `// scan-allow` marker exempts an annotated
  // test-fixture line, exactly as the per-file scan did.
  // 2026-07-25: Multi-pass decode/normalize pipeline — try base64, gzip, UTF-16/32
  // before scanning so encoded secrets are caught.
  const scanText = (text, file) => {
    const variants = decodeAndNormalize(Buffer.from(text, 'utf8'));
    for (const variant of variants) {
      const lines = variant.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (SECRET_RE.test(ln) && !isScanAllowed(ln)) addFinding('secret', file, String(i + 1));
        // 2026-08-13, found while fixing X22. The SCAN_ALLOW_MARKER check was
        // applied to SECRET_RE but NOT to SECRETVAR_RE, so the project's own
        // documented escape hatch — "only a line ending in the explicit marker
        // `// scan-allow: known test fixture` is exempt" — worked for a
        // vendor-shaped secret (AKIA…, gh_…, AIza…) and silently did nothing for
        // a variable-assignment one (`api_key = "…"`). A maintainer annotating a
        // deliberate test vector had no way to tell which half of the scanner
        // would honour the annotation. Reproduced: line 6167 of hooks.test.mjs
        // carried the marker and was still reported. Both halves now honour it.
        if (SECRETVAR_RE.test(ln) && !isScanAllowed(ln))
          addFinding('secret-var', file, String(i + 1));
      }
    }
  };
  // 2026-07-21 Round 12 audit fix (undisclosed size cap, medium): a would-ship
  // file over MAX_SCAN_BYTES used to be skipped ENTIRELY before any text/binary
  // check — so a plaintext secret in a large ordinary text file (a Terraform
  // .tfstate, a SQL/DB dump, a verbose .log) shipped unflagged, and for a compound
  // `git add && git commit && git push` the history scan cannot backstop it (the
  // commit does not exist yet at PreToolUse). Large files are now STREAM-scanned
  // line-by-line in bounded memory: classify from the head chunk (a genuine large
  // binary — video, model, image — is still skipped, exactly like the working-tree
  // NUL/binary path), then scan the rest. NUL→newline mirrors the working-tree
  // scan so a co-located secret is still found.
  const scanLargeFile = (abs, file) => {
    let fd;
    try {
      fd = fs.openSync(abs, 'r');
    } catch {
      return;
    }
    try {
      const CHUNK = 1024 * 1024;
      const chunk = Buffer.allocUnsafe(CHUNK);
      let leftover = '';
      let lineNo = 0;
      let first = true;
      let n;
      const scanLine = (ln) => {
        lineNo++;
        if (SECRET_RE.test(ln) && !isScanAllowed(ln)) addFinding('secret', file, String(lineNo));
        if (SECRETVAR_RE.test(ln) && !isScanAllowed(ln))
          addFinding('secret-var', file, String(lineNo));
      };
      while ((n = fs.readSync(fd, chunk, 0, CHUNK, null)) > 0) {
        const slice = chunk.subarray(0, n);
        if (first) {
          first = false;
          if (!bufIsTextish(slice)) return; // genuine large binary — not content-scanned
        }
        const text = leftover + slice.toString('utf8').split(String.fromCharCode(0)).join('\n');
        const parts = text.split('\n');
        leftover = parts.pop(); // carry the incomplete last line to the next chunk
        for (const ln of parts) {
          // 2026-07-25: Multi-pass decode/normalize for large files too
          const variants = decodeAndNormalize(Buffer.from(ln, 'utf8'));
          for (const variant of variants) {
            const lines = variant.split(/\r?\n/);
            for (const vln of lines) scanLine(vln);
          }
        }
      }
      if (leftover.length > 0) {
        const variants = decodeAndNormalize(Buffer.from(leftover, 'utf8'));
        for (const variant of variants) {
          const lines = variant.split(/\r?\n/);
          for (const vln of lines) scanLine(vln);
        }
      }
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  };
  // 2026-07-21 audit fix: a branch push ships COMMITS, not the working tree, so a
  // secret committed and then removed (git commit is never push-capable, so is
  // never scanned) would still ride an incremental checkpoint/memory-persist
  // branch push inside the earlier commit. Scan the content ADDED in unpushed
  // commits across ALL local branches and tags (`--branches --tags HEAD --not
  // --remotes` = every pushable local ref not yet on any remote — see the Round 14
  // note on the git invocation below). Added coverage only — it never relaxes the
  // working-tree scan; any git error or empty range returns silently and the
  // working-tree scan still stands. (Residual, disclosed in SECURITY.md: a value
  // living only in a file referenced by `--input`/curl body is still not parsed.)
  const scanUnpushedHistory = () => {
    // 2026-07-21 Round 11 audit fix: `--text` forces git to emit the real added
    // content of NUL-containing blobs instead of rendering them as "Binary files
    // a/x and b/x differ" — without it, a secret committed then removed inside a
    // text file carrying one stray binary byte was invisible to the history scan
    // (git's binary heuristic suppressed the diff). The added content is then
    // classified PER FILE below (see flushHistory), so a genuine binary blob that
    // `--text` dumps as pseudo-lines is not regex-scanned.
    // 2026-07-21 Round 13 audit fix: `-m` emits a per-parent diff for MERGE
    // commits. Without it `git log -p` shows NO diff for a merge, so a secret
    // unique to a merge resolution (present in neither parent — an "evil merge"),
    // later removed, shipped in the merge commit's tree undetected. `-m` uses the
    // ordinary single-`+` diff format the parser below already handles; merged-in
    // side-branch content is re-scanned redundantly but harmlessly.
    // 2026-07-21 Round 14 audit fix: walk ALL local branches and tags, not only
    // HEAD. `HEAD --not --remotes` only equals "what a push sends" when the pushed
    // ref is the current checkout — but `git push --all`, `git push --mirror`, and
    // `git push origin <branch>` (while standing on a different branch) all ship
    // commits on NON-HEAD refs, which HEAD-only excluded (and the working-tree scan
    // reflects only the checkout, so both paths missed them). `--branches --tags
    // HEAD --not --remotes` is the finite superset of every pushable local ref not
    // already on a remote (HEAD kept explicitly to cover a detached-HEAD push).
    const r = git(
      [
        'log',
        '-p',
        '-m',
        '-U0',
        '--no-color',
        '--no-textconv',
        '--text',
        '--branches',
        '--tags',
        'HEAD',
        '--not',
        '--remotes',
      ],
      REPO,
      'buffer',
    );
    if (!r.ok || !r.stdout || r.stdout.length === 0) return;
    let file = '(unpushed history)';
    // 2026-07-21 Round 8 fix: parse the unified diff with minimal state instead of
    // by bare prefix. A `+++ ` line is a real FILE HEADER only when it immediately
    // follows a `--- a/`|`/dev/null` header; otherwise an ordinary added line whose
    // own content starts with '+' (diff line '++…'/'+++…') was wrongly swallowed as
    // a header or excluded — silently skipping its secret scan (a false-negative
    // that also broke the working-tree/history parity this scanner documents).
    // Content lines strip exactly ONE leading '+', so content beginning with '+' is
    // still scanned.
    // 2026-07-21 Round 9 fix: track hunk state so `--- `/`+++ ` are treated as FILE
    // HEADERS only in the pre-hunk header region (between `diff --git` and the first
    // `@@`), never inside a hunk body. The Round 8 single-boolean parser had no hunk
    // tracking, so a REMOVED content line whose text is `-- a/z` (diff `--- a/z`)
    // inside a hunk masqueraded as a header and made the next ADDED secret line
    // (diff `+++ …`) be consumed as a header and skipped — a history false-negative.
    // In a hunk, every `+` line is added content (scanned) and every `-` line is
    // removed content (ignored); neither can be a header.
    let inHunk = false;
    let afterMinusHeader = false;
    // 2026-07-21 Round 12 audit fix: accumulate the ADDED content per file and
    // classify/scan it as a UNIT, mirroring the working-tree path's per-FILE
    // decision (bufIsTextish → scanText). The Round 11 per-line strIsTextish
    // guard broke that parity: a real ASCII secret sharing ONE diff line with a
    // short binary run dropped that single line's text fraction below 0.85, so
    // the whole line (secret included) was skipped even though the file is
    // overwhelmingly text — while the working-tree path caught the identical
    // content. Now a predominantly-text file's added content is scanned in full
    // (NUL→newline, no per-line guard, exactly like scanText), and only a
    // predominantly-binary file's added content (a font/image/blob `--text`
    // dumped as pseudo-lines) is skipped.
    let added = [];
    const flushHistory = () => {
      if (added.length === 0) return;
      const content = added.join('\n');
      added = [];
      // 2026-07-21 Round 13 audit fix: classify from the HEAD of the added content
      // (first 64 KB), mirroring the working-tree bufIsTextish head sample. Testing
      // the WHOLE content diverged from the working-tree scan for a text-headed but
      // binary-tailed file (e.g. a DB dump): the tree scan caught its secret, the
      // history scan skipped it. Head-sampling restores true parity.
      if (!strIsTextish(content.length > 65536 ? content.slice(0, 65536) : content)) return; // genuine binary file — not content-scanned
      // 2026-07-25: Multi-pass decode/normalize for history scan
      const variants = decodeAndNormalize(Buffer.from(content, 'utf8'));
      for (const variant of variants) {
        for (const ln of variant.split(String.fromCharCode(0)).join('\n').split('\n')) {
          if (SECRET_RE.test(ln) && !isScanAllowed(ln)) addFinding('secret-history', file, '0');
          if (SECRETVAR_RE.test(ln) && !isScanAllowed(ln))
            addFinding('secret-var-history', file, '0');
        }
      }
    };
    for (const raw of r.stdout.toString('utf8').split('\n')) {
      // Each `diff --git` starts a NEW file's diff, so flush the file just ended
      // (its added content is scanned under the previous `file` name); the final
      // file is flushed after the loop.
      if (raw.startsWith('diff --git ')) {
        flushHistory();
        inHunk = false;
        afterMinusHeader = false;
        continue;
      }
      if (raw.startsWith('@@')) {
        inHunk = true;
        afterMinusHeader = false;
        continue;
      }
      if (!inHunk) {
        // pre-hunk header region: the only place `--- `/`+++ ` are real file headers
        if (raw.startsWith('--- a/') || raw.startsWith('--- /dev/null')) {
          afterMinusHeader = true;
          continue;
        }
        if (afterMinusHeader && raw.startsWith('+++ ')) {
          afterMinusHeader = false;
          file = raw.slice(4).replace(/^b\//, '').replace(/\t.*$/, '');
          // Apply the same FILENAME-based blocks the working-tree scan uses, so a key
          // file or Dev-Memory path committed then removed is still caught in history.
          if (file !== '/dev/null') {
            if (KEYFILE_RE.test(file)) addFinding('key-file-history', file, '0');
            if (
              DEVMEMORY_RE.test(file) &&
              !allowDevMemory &&
              !isOwnTestFixture(file, HISTORY_PATH_BASE)
            )
              addFinding('dev-memory-history', file, '0');
          }
          continue;
        }
        afterMinusHeader = false;
        continue; // other pre-hunk metadata (index, mode, rename, etc.)
      }
      // in a hunk body: only added ('+') lines carry shippable new content
      if (raw.startsWith('+')) added.push(raw.slice(1));
    }
    flushHistory(); // the final file's added content
  };

  // 2026-07-21 Round 15 audit fix (HIGH): a branch push ships whole commit OBJECTS,
  // whose MESSAGE the diff-based history scan never sees (messages sit in the
  // pre-hunk region, not in a `+` diff line). A credential pasted into a commit
  // message — one of the most common real-world leak vectors — shipped unscanned.
  // Scan each unpushed commit's message over the same ref range as the diff scan.
  const scanCommitMessages = () => {
    // %H<NUL>%B<RS> per commit: NUL splits sha from the (possibly multi-line) body,
    // RS (0x1e) separates records — neither occurs in a git commit message.
    const r = git(
      [
        'log',
        '--no-color',
        '--format=%H%x00%B%x1e',
        '--branches',
        '--tags',
        'HEAD',
        '--not',
        '--remotes',
      ],
      REPO,
      'buffer',
    );
    if (!r.ok || !r.stdout || r.stdout.length === 0) return;
    const RS = String.fromCharCode(30);
    const Z = String.fromCharCode(0);
    for (const rec of r.stdout.toString('utf8').split(RS)) {
      const z = rec.indexOf(Z);
      if (z === -1) continue;
      const sha = (rec.slice(0, z).match(/[0-9a-f]+/i) || ['commit'])[0].slice(0, 12);
      const message = rec.slice(z + 1);
      // 2026-07-25: Multi-pass decode/normalize for commit messages
      const variants = decodeAndNormalize(Buffer.from(message, 'utf8'));
      for (const variant of variants) {
        for (const ln of variant.split('\n')) {
          if (SECRET_RE.test(ln) && !isScanAllowed(ln))
            addFinding('secret-commit-message', sha, '0');
          if (SECRETVAR_RE.test(ln) && !isScanAllowed(ln))
            addFinding('secret-var-commit-message', sha, '0');
        }
      }
    }
  };

  // 2026-07-21 Round 15 audit fix (HIGH): an ANNOTATED tag carries its own message,
  // shipped by `git push --tags`/`--follow-tags`/`--mirror` (and a tag refspec), yet
  // absent from `git log -p` entirely. Scan annotated-tag messages, but only when the
  // command actually pushes tags — so an ordinary `git push origin main` is untouched.
  // (Residual, disclosed: pushing a single annotated tag by BARE name — ambiguous with
  // a branch — is not detected as a tag push, so its message is not scanned.)
  const scanTagMessages = () => {
    const norm = normalizeForPushCheck(CMD);
    if (!(
      /(?:^|[ \t])--tags(?![A-Za-z0-9_])/.test(norm) ||
      /(?:^|[ \t])--follow-tags(?![A-Za-z0-9_])/.test(norm) ||
      /(?:^|[ \t])--mirror(?![A-Za-z0-9_])/.test(norm) ||
      /refs\/tags\//.test(norm)
    ))
      return;
    const listing = git(
      ['for-each-ref', '--format=%(objecttype) %(refname:short)', 'refs/tags'],
      REPO,
    );
    if (!listing.ok || !listing.stdout) return;
    for (const line of listing.stdout.split('\n')) {
      const sp = line.indexOf(' ');
      if (sp === -1) continue;
      if (line.slice(0, sp) !== 'tag') continue; // annotated only; a lightweight tag is 'commit'
      const name = line.slice(sp + 1).trim();
      if (!name) continue;
      const msg = git(['tag', '-l', '--format=%(contents)', name], REPO); // exact-name match (no glob chars)
      if (!msg.ok || !msg.stdout) continue;
      const tag = name.replace(/[^A-Za-z0-9_./-]/g, '') || 'tag';
      // 2026-07-25: Multi-pass decode/normalize for tag messages
      const variants = decodeAndNormalize(Buffer.from(msg.stdout, 'utf8'));
      for (const variant of variants) {
        for (const ln of variant.split('\n')) {
          if (SECRET_RE.test(ln) && !isScanAllowed(ln)) addFinding('secret-tag-message', tag, '0');
          if (SECRETVAR_RE.test(ln) && !isScanAllowed(ln))
            addFinding('secret-var-tag-message', tag, '0');
        }
      }
    }
  };

  for (const f of FILES) {
    if (!f) continue;
    if (KEYFILE_RE.test(f)) {
      addFinding('key-file', f, '0');
    }
    // FILES entries are REPO-relative — proved by `path.join(REPO, f)` four lines below.
    if (DEVMEMORY_RE.test(f) && !allowDevMemory && !isOwnTestFixture(f, REPO)) {
      addFinding('dev-memory', f, '0');
    }
    const abs = path.join(REPO, f);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > MAX_SCAN_BYTES) {
      // 2026-07-26, found while re-testing findings 4/5 after fixing the
      // small-file path: the gzip/UTF-16-BOM handling added below (for files
      // <= MAX_SCAN_BYTES) does NOT apply here. A file whose COMPRESSED size
      // exceeds MAX_SCAN_BYTES went straight to scanLargeFile, which streams
      // the raw bytes looking for plaintext patterns — it never attempts
      // decompression, so a secret inside a large gzip blob was still invisible.
      // Verified by execution: a gzip file just over 4 MB (built from 5 MB of
      // random, incompressible padding plus a real AWS key) shipped with
      // decision "allow".
      //
      // A capped peek-and-decompress closes the realistic case without
      // reintroducing the compression-bomb risk MAX_SCAN_BYTES exists to bound:
      // the COMPRESSED input read here is itself capped at
      // MAX_PACKED_PEEK_BYTES, and gunzipSync's own maxOutputLength caps the
      // DECOMPRESSED result — so a maliciously tiny file that expands to
      // gigabytes throws and is skipped rather than exhausting memory.
      // Ordinary large binaries (video, images, real archives) are unaffected:
      // they either aren't gzip/UTF-16 at all, or fail one of the two bounds
      // and fall through to the existing streaming path unchanged.
      if (st.size <= MAX_PACKED_PEEK_BYTES) {
        let head2 = null;
        try {
          const fd0 = fs.openSync(abs, 'r');
          try {
            const b2 = Buffer.alloc(2);
            fs.readSync(fd0, b2, 0, 2, 0);
            head2 = b2;
          } finally {
            fs.closeSync(fd0);
          }
        } catch {
          /* fall through to the streaming path below */
        }

        if (head2 && head2[0] === 0x1f && head2[1] === 0x8b) {
          try {
            const packed = fs.readFileSync(abs);
            const inflated = zlib.gunzipSync(packed, {
              maxOutputLength: MAX_PACKED_INFLATED_BYTES,
            });
            if (bufIsTextish(inflated)) {
              scanText(inflated.toString('utf8'), f);
              continue;
            }
          } catch {
            /* not valid gzip, or exceeded the output cap — fall through */
          }
        } else if (
          head2 &&
          ((head2[0] === 0xff && head2[1] === 0xfe) || (head2[0] === 0xfe && head2[1] === 0xff))
        ) {
          try {
            const littleEndian = head2[0] === 0xff;
            const packed = fs.readFileSync(abs);
            const body = Buffer.from(packed.subarray(2));
            if (body.length % 2 === 0) {
              if (!littleEndian) body.swap16();
              const decoded = body.toString('utf16le');
              if (strIsTextish(decoded)) {
                scanText(decoded, f);
                continue;
              }
            }
          } catch {
            /* fall through */
          }
        }
      }
      // Do NOT silently skip on size: stream-scan the file instead (a large
      // ordinary text file can carry a plaintext secret; a genuine large binary
      // is skipped inside scanLargeFile after a head classification).
      scanLargeFile(abs, f);
      continue;
    }
    let buf;
    try {
      // readFileSync throws EACCES/ENOENT on an unreadable/vanished file, caught
      // here — the previous fs.accessSync() immediately before it was a pure
      // redundant syscall (same catch handled both).
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.includes(0)) {
      // 2026-07-21 Round 11 audit fix (NUL/binary blind spot, medium): a single
      // NUL byte used to skip the file's WHOLE content scan, so an ordinary
      // would-ship text file carrying one stray binary byte beside a real ASCII
      // secret (a log that captured a byte of binary output next to a logged
      // key; a SQL/DB dump with a BLOB column beside a plaintext credential)
      // shipped unflagged. Now: skip only GENUINE binary assets (predominantly
      // non-text — fonts, images, compiled blobs), and for a file that is
      // overwhelmingly text with a stray NUL, scan its extractable ASCII
      // (NUL→newline preserves line numbers). The high-signal regexes plus the
      // text-fraction guard keep false positives on real binaries at zero.
      // (Residual, disclosed in SECURITY.md: a genuine binary blob is not
      // content-scanned, and a NUL-interleaved encoding such as UTF-16LE — ~50%
      // NUL — classifies as non-text, so is not scanned either.)
      // 2026-07-25: Also run multi-pass decode/normalize on NUL-containing files
      //
      // 2026-07-26 audit finding 4, SECOND HALF. Fixing the ESM `require` in
      // decodeAndNormalize was necessary but NOT sufficient, and the audit
      // initially understated this: the gzip branch was also architecturally
      // UNREACHABLE. A real gzip blob contains NUL bytes and is not textish, so
      // control reached the `continue` below and the file was skipped before any
      // decoding was attempted. decodeAndNormalize only ever received text
      // buffers, on which gunzipSync fails with "incorrect header check".
      // Verified by execution: with the import fixed but this guard unchanged, a
      // gzipped AWS key still shipped with decision "allow".
      //
      // So the compressed case is now handled HERE, before the binary skip:
      // check the gzip magic bytes (1f 8b) and, if the content decompresses to
      // text, scan the decompressed text. Findings are attributed to the
      // container file, with the line number being the position within the
      // DECOMPRESSED stream — which is the only meaningful line number there is
      // for packed content, and is genuinely useful for locating the secret once
      // the file is unpacked.
      //
      // 2026-08-07 audit fix (found by execution). This call had NO
      // maxOutputLength, unlike its twin in the >MAX_SCAN_BYTES branch above,
      // which has been capped at MAX_PACKED_INFLATED_BYTES since 2026-07-26 —
      // and the catch below already CLAIMED "a compression bomb guard
      // tripped", describing a guard that did not exist on this path. So a
      // gzip file small enough to land here (under 4 MiB) could inflate
      // without bound. Reproduced: a 1 MiB gzip of 1 GiB of zeros made this
      // hook allocate roughly a gigabyte and stall for ~10 seconds on a push
      // it then allowed. It degrades gracefully rather than bypassing the scan
      // (the inflated bomb is not textish, so it is skipped either way, and
      // under a memory ceiling gunzipSync throws into the catch below), so
      // this is a resource-exhaustion and consistency defect rather than a
      // secret bypass — recorded at that severity, not inflated beyond it.
      // The cap is the same constant the sibling path uses: for an input under
      // 4 MiB it permits a 16x expansion, far above what real text archives
      // reach (gzip on prose is ~3-4x, on logs/JSON ~5-10x) and far below the
      // 1000x+ a bomb needs.
      if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
        try {
          const inflated = zlib.gunzipSync(buf, { maxOutputLength: MAX_PACKED_INFLATED_BYTES });
          if (bufIsTextish(inflated)) {
            scanText(inflated.toString('utf8'), f);
            continue;
          }
        } catch {
          // Not valid gzip, or the compression-bomb guard above tripped — fall
          // through to the ordinary binary handling below.
        }
      }
      // 2026-07-26 audit finding 5, same architectural cause. SECURITY.md
      // honestly disclosed this as a residual: "a NUL-interleaved encoding such
      // as UTF-16LE — ~50% NUL — classifies as non-text, so is not scanned
      // either." That disclosure was accurate, and it means the UTF-16 handling
      // inside decodeAndNormalize was ALSO unreachable for whole files, for the
      // same reason the gzip branch was: control never got past the binary skip.
      //
      // A UTF-16 file that carries a byte-order mark is unambiguous, so decode
      // and scan it here. This closes the disclosed residual for the announced
      // case; a UTF-16 file with NO byte-order mark remains out of scope and
      // stays disclosed, because guessing at unmarked wide encodings is how
      // false positives on genuine binaries start.
      if (
        buf.length >= 2 &&
        ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
      ) {
        const littleEndian = buf[0] === 0xff;
        const body = Buffer.from(buf.subarray(2));
        if (body.length % 2 === 0) {
          if (!littleEndian) body.swap16(); // Node has no 'utf16be'; swap then decode as LE
          const decoded = body.toString('utf16le');
          if (strIsTextish(decoded)) {
            scanText(decoded, f);
            continue;
          }
        }
      }
      if (!bufIsTextish(buf)) continue;
      // Replace each NUL with a newline (String.fromCharCode(0) avoids an
      // easily-mangled literal NUL byte in source): the ASCII lines around a
      // stray binary byte stay intact and line numbers stay accurate.
      scanText(buf.toString('utf8').split(String.fromCharCode(0)).join('\n'), f);
      continue;
    }
    scanText(buf.toString('utf8'), f);
  }

  scanUnpushedHistory();
  scanCommitMessages();
  scanTagMessages();

  if (findings.length === 0) {
    // No secrets found — so this scanner has no OBJECTION. That has never been the same thing as
    // approving the push, and until now nothing filled the gap.
    //
    // 2026-08-23, X272. Authorisation was gate.mjs's job and required a confirmed token (X1). X214
    // deleted both on 2026-08-16, and its own decision note gives the reason: "The token layer was
    // reimplementing the permission prompt Claude Code" already provides. That premise has since
    // been MEASURED, and it does not hold in the mode that is now the default.
    //
    // The live-runtime measurement of 2026-08-22 (RESIDUALS gap 9) established two things from a real
    // session transcript: a `deny` from this hook genuinely blocks a tool call, AND the session ran
    // in `auto` mode, where a hook that stays silent produces NO user prompt — auto mode makes its
    // own risk assessment and may simply proceed. So after X214 a clean push had nothing asking
    // anybody, in the default mode, which is precisely what X214 assumed the platform would do.
    //
    // `operating-charter/SKILL.md:133-135` is unambiguous that it must: "Publishing, going public, a
    // per-phase checkpoint push … each still need their own explicit, fresh \"yes\" — every time."
    // `escalate()` has existed in lib.mjs since that layer was removed and NO hook has ever called
    // it, so the charter's rule has been enforced by nothing.
    //
    // This is NOT a return to the token layer. It records no state, proves nothing about a past
    // answer, and cannot be satisfied by a file on disk — the three properties X91 and X110 deleted
    // authorise() for. It asks the person, once, at the moment the charter names. And `ask` is not
    // `deny`: a user who wants the push says yes and it proceeds, so this does not block honest work.
    //
    // Gated on `sendsCommitsToRemote`, NOT on the `isPushCapable` that decided whether to scan. The
    // first version of this fix used the latter and X214's own controls caught it: `gh repo clone`
    // (read-only) and `node scripts/build.mjs --outdir public` are both push-CAPABLE, because that
    // classifier is deliberately wide so the scan errs on the side of looking. Neither publishes
    // anything, and both were being handed a prompt whose text claims "this command sends code out
    // of your machine". Asking a false question is not a small cosmetic fault — it is how a guard
    // earns the reputation that gets it switched off (L5).
    //
    // 2026-08-24, X5: the RESOLVED text counts as well as the command itself. Without this the hook
    // was incoherent in a way a user would notice — `git push` asked for consent on a clean tree
    // while `bash build.sh`, whose script does nothing but push, was silent. The charter's rule is
    // about publishing, and a script that publishes is publishing.
    const publishes = sendsCommitsToRemote(CMD)
      ? null
      : indirection && sendsCommitsToRemote(indirection.text)
        ? indirection
        : undefined;
    if (publishes !== undefined) {
      escalate(
        'studio scan: no secrets, keys or private Dev-Memory files were found in what this would ' +
          'ship — so nothing here objects. But ' +
          (publishes === null
            ? 'this command sends code out of your machine'
            : `this runs ${publishes.source}, which sends code out of your machine`) +
          ', and your operating charter says publishing needs your own fresh "yes" every time. ' +
          'Say yes to go ahead.',
      );
    }
    return stepAside();
  }
  // 2026-07-19 audit fix (real gap, found by execution): `findings` was fully
  // computed (each entry already redacted to {type,file,line} by redact() —
  // never the secret value itself) but never actually included in the deny
  // message, despite the message's own wording claiming the findings were
  // "redacted to type+location" — i.e. promising exactly this information.
  // On a repo with many files this left no lead on where to look. Now
  // included, still secret-safe (redact() never emits the matched value).
  deny(
    `studio scan: refusing to push — high-signal secrets, key files or the private Dev-Memory folder detected in the would-ship set. Findings (redacted to type+location, never the actual value):\n${findings.join('\n')}\nRemove them, move values to environment variables, add key files and Dev-Memory to .gitignore, then retry.`,
  );
}

main();
