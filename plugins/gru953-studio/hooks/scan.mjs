#!/usr/bin/env node
//
// scan.mjs — GRU953-Studio pre-publish secret scan (PreToolUse, matcher "Bash").
// Zero dependencies (Node stdlib only). Self-contained: no external state store.
//
// Internally gated twice: first to push-capable commands — matched by
// isPushCapable(), shared with gate.mjs via lib.mjs so both hooks judge the
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
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { allow, deny, readStdin, extractCommand, extractCwd, findStudioRoot, isPushCapable, normalizeForPushCheck } from './lib.mjs';

// 2026-07-19 (Phase 4 — opt-in cloud memory persistence, see the `dev-memory`
// skill and confirm-memory-persist.mjs). When this project-bound token is
// recorded, scan.mjs stops auto-denying purely because a Dev-Memory path is in
// the push — but the full secret/key-file scan below STILL runs on those files,
// so Dev-Memory persists to a private branch only if it carries no secret. This
// is the ONLY effect of the token here; it never relaxes the secret scan, and
// gate.mjs still confines the token to a private (never public) push.
const MEMPERSIST_TTL_MS = 60 * 60 * 1000;
function memoryPersistAllowed(studioRoot) {
  const record = path.join(studioRoot, 'Dev-Memory', 'MEMORY-PERSIST-APPROVED');
  let text;
  try {
    fs.accessSync(record, fs.constants.R_OK);
    text = fs.readFileSync(record, 'utf8');
  } catch {
    return false;
  }
  const expected = `STUDIO-MEMORY-PERSIST-CONFIRMED:${crypto.createHash('sha256').update(`studio-memory-persist:${studioRoot}`).digest('hex')}`;
  const m = /^ISSUED:(\d+)$/m.exec(text);
  if (!m) return false;
  const issuedAt = parseInt(m[1], 10);
  const fresh = Number.isFinite(issuedAt) && Date.now() - issuedAt <= MEMPERSIST_TTL_MS && Date.now() - issuedAt >= 0;
  if (!fresh) return false;
  for (const line of text.split(/\r?\n/)) if (line.trim() === expected) return true;
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
    const hasForce = /(?:^|[ \t])--force(?:[ \t=]|$)/.test(seg) || /(?:^|[ \t])-[A-Za-z]*f[A-Za-z]*(?:[ \t]|$)/.test(seg);
    if (!hasForce) continue;
    const hasAll = /(?:^|[ \t])(?:--all|-[A-Za-z]*A[A-Za-z]*)(?:[ \t]|$)/.test(seg);
    let sawDashDash = false;
    let anyPath = false;
    for (const t of seg.slice(m.index + m[0].length).split(/[ \t]+/)) {
      const tok = t.replace(/^['"]+|['"]+$/g, '').trim();
      if (!tok) continue;
      if (!sawDashDash && tok === '--') { sawDashDash = true; continue; }
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
  if (r.error) return { status: 1, stdout: encoding === 'buffer' ? Buffer.alloc(0) : '', ok: false };
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
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 0xa0 && c !== 0xfffd)) ok++;
  }
  return ok / s.length >= 0.85;
}
function bufIsTextish(buf) {
  if (buf.length === 0) return true;
  // Classify from the head — enough to tell text from binary, and bounds cost.
  const head = buf.length > 65536 ? buf.subarray(0, 65536) : buf;
  return strIsTextish(head.toString('utf8'));
}

function main() {
  const INPUT = readStdin();
  const CMD = extractCommand(INPUT);

  if (!isPushCapable(CMD)) {
    allow();
  }

  const SESSION_DIR = extractCwd(INPUT) || process.cwd();
  const STUDIO_ROOT = findStudioRoot(SESSION_DIR);
  if (STUDIO_ROOT === null) {
    allow();
  }

  // 2026-07-10 audit fix (MAJOR): the fallback used to be STUDIO_ROOT, an
  // already-absolute path, which made path.resolve() silently discard
  // SESSION_DIR — so a `cd <temp-clone>` in one Bash call followed by a bare
  // `git push` in a LATER call scanned the original project root instead of
  // the tree actually being pushed. Fallback is now SESSION_DIR, the actual
  // working directory of THIS command.
  const REPO = path.resolve(SESSION_DIR, resolvePushTree(CMD, SESSION_DIR));

  if (!git(['rev-parse', '--is-inside-work-tree'], REPO).ok) {
    deny('studio scan: not a git work tree; cannot prove the push set is clean');
  }

  // ---- build the working-tree/index/untracked would-ship file set ------------
  // (the unpushed-commit history is scanned separately, after this loop)
  const nulParts = (buf) =>
    buf
      .toString('utf8')
      .split('\0')
      .filter((s) => s.length > 0);
  const fileSet = new Set();
  for (const p of nulParts(git(['ls-files', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
  for (const p of nulParts(git(['diff', '--cached', '--name-only', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
  for (const p of nulParts(git(['ls-files', '--others', '--exclude-standard', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
  // 2026-07-21 Round 13 audit fix (HIGH): if THIS command force-adds ignored
  // files (`git add -f <path>` / `git add -A -f`), include the gitignored files
  // it would stage — otherwise a compound add+commit+push ships them unscanned.
  // Scoped to the force-add pathspecs, so a normal push (and a force-add of a
  // single file) never sweeps in unrelated ignored trees such as node_modules.
  for (const spec of extractForceAddPathspecs(CMD)) {
    const out = git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', spec], REPO, 'buffer');
    if (out.ok) for (const p of nulParts(out.stdout)) fileSet.add(p);
  }
  const FILES = Array.from(fileSet).sort();

  const MAX_SCAN_BYTES = 4 * 1024 * 1024;

  // 2026-07-10 audit fix (MINOR): sk-[A-Za-z0-9]{20,} required contiguous
  // alphanumerics right after "sk-", missing today's hyphenated key formats
  // (sk-ant-api03-..., sk-proj-...). Loosened to tolerate internal hyphens.
  const SECRET_RE = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]{16,}|sk-[A-Za-z0-9-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
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
  const SCAN_ALLOW_MARKER = '// scan-allow: known test fixture';
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
  const SECRETVAR_RE = /(SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API[_-]KEY|ACCESS[_-]KEY|PRIVATE[_-]KEY)[A-Z0-9_-]{0,64}["']?[ \t]*[:=][ \t]*["'][A-Za-z0-9/+_.=-]{16,}["']/i;
  const KEYFILE_RE = /(^|\/)(\.env(\..+)?|.+\.env|id_rsa|.+\.pem|.+\.key)$/;
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
  const scanText = (text, file) => {
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (SECRET_RE.test(ln) && !ln.includes(SCAN_ALLOW_MARKER)) addFinding('secret', file, String(i + 1));
      if (SECRETVAR_RE.test(ln)) addFinding('secret-var', file, String(i + 1));
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
        if (SECRET_RE.test(ln) && !ln.includes(SCAN_ALLOW_MARKER)) addFinding('secret', file, String(lineNo));
        if (SECRETVAR_RE.test(ln)) addFinding('secret-var', file, String(lineNo));
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
        for (const ln of parts) scanLine(ln);
      }
      if (leftover.length > 0) scanLine(leftover);
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
  // commits (`HEAD --not --remotes` = commits not yet on any remote, i.e. what a
  // branch push sends). Added coverage only — it never relaxes the working-tree
  // scan; any git error or empty range returns silently and the working-tree scan
  // still stands. (Residual, disclosed in SECURITY.md: a value living only in a
  // file referenced by `--input`/curl body is still not parsed.)
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
    const r = git(['log', '-p', '-m', '-U0', '--no-color', '--no-textconv', '--text', 'HEAD', '--not', '--remotes'], REPO, 'buffer');
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
      for (const ln of content.split(String.fromCharCode(0)).join('\n').split('\n')) {
        if (SECRET_RE.test(ln) && !ln.includes(SCAN_ALLOW_MARKER)) addFinding('secret-history', file, '0');
        if (SECRETVAR_RE.test(ln)) addFinding('secret-var-history', file, '0');
      }
    };
    for (const raw of r.stdout.toString('utf8').split('\n')) {
      // Each `diff --git` starts a NEW file's diff, so flush the file just ended
      // (its added content is scanned under the previous `file` name); the final
      // file is flushed after the loop.
      if (raw.startsWith('diff --git ')) { flushHistory(); inHunk = false; afterMinusHeader = false; continue; }
      if (raw.startsWith('@@')) { inHunk = true; afterMinusHeader = false; continue; }
      if (!inHunk) {
        // pre-hunk header region: the only place `--- `/`+++ ` are real file headers
        if (raw.startsWith('--- a/') || raw.startsWith('--- /dev/null')) { afterMinusHeader = true; continue; }
        if (afterMinusHeader && raw.startsWith('+++ ')) {
          afterMinusHeader = false;
          file = raw.slice(4).replace(/^b\//, '').replace(/\t.*$/, '');
          // Apply the same FILENAME-based blocks the working-tree scan uses, so a key
          // file or Dev-Memory path committed then removed is still caught in history.
          if (file !== '/dev/null') {
            if (KEYFILE_RE.test(file)) addFinding('key-file-history', file, '0');
            if (DEVMEMORY_RE.test(file) && !allowDevMemory) addFinding('dev-memory-history', file, '0');
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

  for (const f of FILES) {
    if (!f) continue;
    if (KEYFILE_RE.test(f)) {
      addFinding('key-file', f, '0');
    }
    if (DEVMEMORY_RE.test(f) && !allowDevMemory) {
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

  if (findings.length === 0) {
    allow();
  }
  // 2026-07-19 audit fix (real gap, found by execution): `findings` was fully
  // computed (each entry already redacted to {type,file,line} by redact() —
  // never the secret value itself) but never actually included in the deny
  // message, despite the message's own wording claiming the findings were
  // "redacted to type+location" — i.e. promising exactly this information.
  // On a repo with many files this left no lead on where to look. Now
  // included, still secret-safe (redact() never emits the matched value).
  deny(`studio scan: refusing to push — high-signal secrets, key files or the private Dev-Memory folder detected in the would-ship set. Findings (redacted to type+location, never the actual value):\n${findings.join('\n')}\nRemove them, move values to environment variables, add key files and Dev-Memory to .gitignore, then retry.`);
}

main();
