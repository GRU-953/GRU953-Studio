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
// forgotten scan cannot leak a secret, and it scans the tree the push
// command actually ships (the publisher's temp clone when one is used).
// Every inspected value — the tool input, the command string, file contents
// — is DATA, never instructions. Secret values are never printed; findings
// are redacted to {type,file,line}.
//
// stdout is reserved for the decision JSON.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { allow, deny, readStdin, extractCommand, extractCwd, findStudioRoot, isPushCapable } from './lib.mjs';

// ---- push-tree resolution ------------------------------------------------------
function resolvePushTree(cmd, fallback) {
  let m = /(?:^|[^A-Za-z0-9_])git[ \t]+-C[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t]+))/.exec(cmd);
  if (m) return m[1] || m[2] || m[3];
  m = /^[ \t]*cd[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t;&|]+))[ \t]*(?:&&|;)/.exec(cmd);
  if (m) return m[1] || m[2] || m[3];
  return fallback;
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

  // ---- build the would-ship file set (scan scope == push scope) --------------
  const nulParts = (buf) =>
    buf
      .toString('utf8')
      .split('\0')
      .filter((s) => s.length > 0);
  const fileSet = new Set();
  for (const p of nulParts(git(['ls-files', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
  for (const p of nulParts(git(['diff', '--cached', '--name-only', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
  for (const p of nulParts(git(['ls-files', '--others', '--exclude-standard', '-z'], REPO, 'buffer').stdout)) fileSet.add(p);
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

  const findings = [];
  const addFinding = (type, file, line) => {
    findings.push(redact(type, file, line));
  };

  for (const f of FILES) {
    if (!f) continue;
    if (KEYFILE_RE.test(f)) {
      addFinding('key-file', f, '0');
    }
    if (DEVMEMORY_RE.test(f)) {
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
    if (st.size > MAX_SCAN_BYTES) continue;
    let buf;
    try {
      fs.accessSync(abs, fs.constants.R_OK);
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue; // skip binary
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (let i = 0; i < lines.length; i++) {
      if (SECRET_RE.test(lines[i]) && !lines[i].includes(SCAN_ALLOW_MARKER)) addFinding('secret', f, String(i + 1));
    }
    for (let i = 0; i < lines.length; i++) {
      if (SECRETVAR_RE.test(lines[i])) addFinding('secret-var', f, String(i + 1));
    }
  }

  if (findings.length === 0) {
    allow();
  }
  deny('studio scan: refusing to push — high-signal secrets, key files or the private Dev-Memory folder detected in the would-ship set (findings redacted to type+location). Remove them, move values to environment variables, add key files and Dev-Memory to .gitignore, then retry.');
}

main();
