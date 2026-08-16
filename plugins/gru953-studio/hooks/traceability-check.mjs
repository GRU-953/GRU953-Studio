#!/usr/bin/env node
//
// traceability-check.mjs — proves the project's requirements and its task list
// stay in sync, so nothing agreed is quietly dropped and nothing unagreed is
// quietly built. Zero dependencies (Node stdlib only).
//
// Added 2026-07-19 (Phase 0 guardrail spine). On a long, multi-session build
// the two ways a project silently derails are (1) a confirmed requirement that
// never becomes a task and is forgotten, and (2) a task that traces back to no
// requirement — scope creep. This script audits `Dev-Memory/REQUIREMENTS.md`
// (the traceability matrix defined by the focus-guard skill) for both.
//
// Checks:
//   FORWARD  — every requirement references at least one task (unless it is
//              consciously marked deferred/future/backlog). A live requirement
//              with no task is a dropped requirement → BLOCKED.
//   STATUS   — a requirement marked met/done must carry a non-placeholder
//              Verification cell and must not contradict itself → else BLOCKED.
//   DANGLING — every task id a requirement references actually exists in
//              PROGRESS.md (when PROGRESS.md carries an id column) → else BLOCKED.
//   REVERSE  — every task id in PROGRESS.md is referenced by some requirement
//              (scope-creep guard), unless the task row is explicitly exempted
//              (a `[chore]`/`[infra]`/`no-req` marker). Only runs when
//              PROGRESS.md has an id column; otherwise reported "not checked"
//              rather than a false pass — the same honesty licence-scan.mjs
//              uses for an ecosystem it cannot inspect.
//
// Like verify-progress.mjs / quality-gate.mjs this is a maintainer/CI +
// pre-checkpoint/pre-Publish check, NOT a PreToolUse runtime hook. Fails
// CLOSED on every ambiguous state — a false clean here means a requirement
// ships unbuilt or scope creep ships unnoticed.
//
// Usage: node traceability-check.mjs [projectRoot]
// Exit 0 = not a studio project, OR the matrix is internally consistent, OR
//          (2026-07-31) Tiny Tier with no REQUIREMENTS.md file, per the
//          focus-guard skill's Tier-scaling section — read from an
//          unambiguous `**Tier:** Tiny` line in Dev-Memory/OBJECTIVE.md.
// Exit 1 = at least one traceability problem (all listed), including a
//          missing REQUIREMENTS.md on Standard/Complex Tier, or any Tier
//          that could not be read unambiguously as Tiny (fails closed).

// 2026-08-13: `fs` is no longer imported here. All file reading now goes through
// lib.mjs's shared readOrBlock(), which is the point of finding X12's fix — one
// place decides what "cannot read this" means, so no gate can quietly decide it
// differently again.
import path from 'node:path';
import process from 'node:process';
import {
  splitPipeCells,
  CONTRADICTION_RE,
  deEmphasise,
  isDirectory,
  SEPARATOR_ROW_RE,
  PLACEHOLDER_RE,
  readOrBlock,
  MISSING,
  // 2026-08-15: this gate now reads tables through the shared reader rather than its own
  // private parser. See parseTable() below for the five defects that closed.
  parseTables,
} from './lib.mjs';

// A task id token: 1-4 letters, an optional dash, then digits (T1, R2, P1-T3,
// B12). Narrow enough not to swallow ordinary prose words, wide enough for the
// conventions the focus-guard skill's template uses. The trailing optional
// group keeps a composite id like "P1-T3" ONE token — without it the plain
// form below matched "P1" and "T3" as two separate ids, so an unrelated
// bare "T3" elsewhere could collide with and silently overwrite the
// composite's Map entry, hiding real scope creep (found 2026-07-19).
const TASK_ID_RE = /\b[A-Za-z]{1,4}-?\d+(?:-[A-Za-z]{1,4}-?\d+)?\b/g;
const DEFERRED_RE = /^\s*(deferred|future|backlog|later|parked|out[ \t]*of[ \t]*scope)\b/i;
const MET_RE = /^\s*(met|done|complete[d]?|verified|pass(ed)?|shipped)\b/i;
const EXEMPT_RE = /\[(chore|infra|infrastructure|no-?req)\]|\bno-?req\b/i;
// 2026-07-26, found during a further pass after fixing the same bug class in
// verify-progress.mjs (audit finding 1). This pattern only matched the literal
// word "exit" immediately followed by whitespace and a digit — so "exit code 1"
// or "exited with code 1" never matched. Reproduced: a requirement's Verification
// cell reading "Ran npm test - exit code 1, 3 failing", with Status "Met",
// returned {"status":"clean"}. Added an alternative for "exit[ed] [with] code N".
//
// 2026-07-26 further-pass audit fix: this file's own local copy had also
// fallen behind quality-gate.mjs's — missing quality-gate.mjs's
// `regress(?:ed|ion)` alternative. Reproduced: a requirement whose
// Verification cell read "npm test green, but a regression was spotted in
// nightly build", Status "Met", returned clean here.
//
// 2026-07-29 maintenance fix (audit finding 4): the comment above already
// claimed this "now imports the one shared pattern from lib.mjs instead of a
// local copy," but the code below was still its own local const — the import
// never actually landed. SEPARATOR_ROW_RE and PLACEHOLDER_RE are now genuinely
// imported (see the import list above), making that claim true and closing
// the exact six-file drift finding 4 of the 2026-07-29 maintenance review
// found (this file's PLACEHOLDER_RE copy was one of the three identical
// copies moved to lib.mjs, alongside quality-gate.mjs/memory-integrity.mjs).
// 2026-07-21 Round 15 audit fix: de-emphasise a Status VALUE before matching, the
// same way verify-progress.mjs (Round 12) does for its "done" values. Without it a
// decorated status — "✅ met", `met` (code span), **met** (bold) — failed MET_RE, so
// the mandatory verification-evidence check was skipped (a false-clean in the sole
// enforcer of "a met requirement carries verification evidence"); a decorated
// **deferred** likewise failed DEFERRED_RE, wrongly reporting a deferred row as a
// dropped requirement. Strip surrounding emphasis, then a leading run of non-
// alphanumeric decoration, so the anchored REs see the bare status word.
const deEmphStatus = (s) =>
  String(s == null ? '' : s)
    .replace(/^[\s*_`]+/, '')
    .replace(/[\s*_`]+$/, '')
    .replace(/^[^A-Za-z0-9]+/, '');

// 2026-07-26, audit finding 26. Deliberate hardening, not a demonstrated-bug
// fix — checked by execution rather than assumed: this file's table-row test
// (`/^\s*\|/`) already tolerates a leading BOM by accident, because
// JavaScript's `\s` class matches U+FEFF. stripBom() stops that correctness
// depending on the accident, so a future tightening of the row pattern can't
// silently reintroduce it. (memory-integrity.mjs and dashboard.mjs DID have a
// real, reproduced BOM bug: both use a strict `^#` heading regex with no
// `\s*` prefix, which a BOM genuinely defeats.)
// 2026-08-13, finding X12 (reproduced by execution — see
// test/repro/phase1-gate-honesty.mjs case P8). This returned null for BOTH "the
// file isn't there" and "the file is there but I couldn't read it". An
// UNREADABLE REQUIREMENTS.md therefore took the same path as an absent one, and
// on a Tiny-Tier project that path is the lenient one — the gate reported
// `{"status":"clean","reason":"Tiny Tier … no REQUIREMENTS.md file is required
// … Nothing to trace."}` about a file that exists and that it could not read.
//
// This file's own Tier-reading code already refuses to make exactly that
// mistake, in words: "Silently defaulting an unreadable Tier to the MORE LENIENT
// Tiny would be a new fail-open bug." The same reasoning applies to the
// requirements matrix itself, and now does. ENOENT still stands down; every
// other error throws and is reported as a block at the entry point below.
function read(p) {
  const t = readOrBlock(p);
  return t === MISSING ? null : t;
}
// 2026-07-31 maintenance fix (consistency tidy, not a demonstrated live bug):
// every other PLACEHOLDER_RE/decoration call site in this file (deEmphStatus
// above, the header-cell col()/parseTable() checks, and the verification-cell
// check further down) already runs deEmphasise() first; this was the one
// remaining call site testing the raw, undecorated cell. A decorated task-id
// cell (e.g. "**T1**") happened to reach the same "no valid task ID" outcome
// either way today, because it fails TASK_ID_RE too — so this closes the gap
// for consistency and to stop that outcome being an accident of two unrelated
// regexes rather than a deliberate, uniform decoration-stripping rule.
function idsIn(cell) {
  const value = deEmphasise(cell || '').trim();
  if (!value || PLACEHOLDER_RE.test(value)) return [];
  return (value.match(TASK_ID_RE) || []).map((s) => s.toUpperCase());
}

// 2026-07-31 maintenance fix — reproduced live: a genuine Tiny-Tier project
// (no `REQUIREMENTS.md`, exactly as the focus-guard skill's Tier-scaling
// section says is correct — "On Tiny Tier the matrix may be a short inline
// list rather than a full REQUIREMENTS.md table") was BLOCKED here anyway,
// because the missing-file branch below used to block unconditionally with
// no Tier awareness at all. There was no documented, machine-parseable place
// to read the Tier from — `studio/SKILL.md` only said "Record ... the
// resulting Tier in OBJECTIVE.md," no exact line. The fix has two halves:
// `studio/SKILL.md` now mandates one exact line, `**Tier:** Tiny` /
// `**Tier:** Standard` / `**Tier:** Complex`, the same bold-label convention
// `focus-guard/SKILL.md` already documents and `memory-integrity.mjs`
// already machine-checks for FOCUS.md's four fields — and this function
// reads it.
//
// Fails CLOSED on anything that isn't an unambiguous, single "Tiny": no
// OBJECTIVE.md, no Tier line, more than one (conflicting) Tier line, or a
// value that isn't one of the three documented Tiers all return null, which
// the caller treats exactly like Standard/Complex (BLOCKED if
// REQUIREMENTS.md is missing). Silently defaulting an unreadable Tier to the
// MORE LENIENT Tiny would be a new fail-open bug, not a fix — only a genuine,
// unambiguous "Tiny" record ever relaxes the check.
//
// 2026-07-31 maintenance fix (F2/F3, independent reviewer finding, both
// real): the value captured after `**Tier:**` used to be run through
// deEmphasise() then split on whitespace and only the FIRST word kept.
// deEmphasise() strips markdown decoration (`~~strikethrough~~` included) —
// authorised elsewhere in this file specifically to TIGHTEN placeholder
// detection (a decorated "tbd" is still a placeholder), never to loosen a
// Tier read. Reproduced: `**Tier:** ~~Tiny~~` (a human striking through a
// stale value — the natural way to mark "ignore this") read as a clean
// `Tiny`, silently relaxing the REQUIREMENTS.md-required gate. The
// first-word split had its own separate problem: `**Tier:** Tiny or
// Standard, still deciding` (genuinely ambiguous prose) and `**Tier:** Tiny /
// Standard / Complex` (an unfilled template) both read as a confident
// `Tiny`, again wrongly relaxing the gate.
//
// Fixed by requiring an EXACT, whole-value match: after trimming only
// surrounding whitespace (no decoration-stripping, no word-splitting), the
// captured text must equal exactly one of the literal strings "Tiny",
// "Standard" or "Complex" — nothing before or after it on that line.
// Anything else (decorated, multi-word, trailing prose, wrong case) is
// `__malformed__`, which the caller below still treats as unreadable ->
// fails closed, never a lenient default.
//
// 2026-07-31 maintenance fix (F4): a `**Tier:** Tiny` line that appears only
// inside a fenced code block (a documentation example of the required line
// format) or an indented example (4+ leading spaces/a tab — the CommonMark
// indented-code-block convention) is not the project's real recorded value
// and must not count. No fenced/indented-code tokeniser already exists
// anywhere in this file or lib.mjs to reuse (checked: repo-integrity.mjs
// explicitly documents this exact gap as a disclosed, unfixed limitation of
// its own, unrelated skill-reference check) — but the SAME anchoring
// discipline this file's other context-sensitive checks already use for a
// comparable problem (anchor the match so it only fires on the value's own
// line, e.g. deEmphasise()'s "only strip when the decoration wraps the WHOLE
// string" rule) is reused here in the same spirit: a per-LINE state machine,
// scoped to only the two concrete cases named above, not a general markdown
// parser.
const TIER_LABEL_RE = /^\s*\*\*Tier\s*:\*\*\s*(.*)$/i;
const KNOWN_TIERS = ['Tiny', 'Standard', 'Complex'];
// 2026-07-31 second further-pass fix (R4, independent reviewer finding):
// returns { tier, sawTierLine } rather than just a bare Tier-or-null, so the
// caller can tell "no **Tier:** line at all" apart from "found one, but it
// didn't parse unambiguously" — the two cases need a different BLOCKED
// message (the second one names the actual problem instead of only pointing
// at REQUIREMENTS.md, which isn't what's actually wrong for a genuinely
// Tiny-Tier owner whose Tier line just didn't parse).
function readTier(devMemory) {
  const text = read(path.join(devMemory, 'OBJECTIVE.md'));
  if (text === null) return { tier: null, sawTierLine: false };
  const found = new Set();
  let sawTierLine = false;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence; // toggle; the fence line itself is never a value line
      continue;
    }
    if (inFence) continue;
    if (/^(?: {4,}|\t)/.test(line)) continue; // indented example, not the real value
    const m = TIER_LABEL_RE.exec(line);
    if (!m) continue;
    sawTierLine = true;
    const value = m[1].trim();
    found.add(KNOWN_TIERS.includes(value) ? value : '__malformed__');
  }
  if (found.size !== 1) return { tier: null, sawTierLine }; // no line, or conflicting lines -> ambiguous
  const [only] = found;
  return { tier: only === '__malformed__' ? null : only, sawTierLine };
}

// Generic per-table parser: returns { headers, rows } for the FIRST table whose
// header matches `wantHeader`, resetting on any non-`|` line so a stray earlier
// table can't leak its columns. Each row is the array of trimmed cells.
// 2026-08-15, the shared-table-reader build. This gate carried its own table parser, and it
// stopped early in five separate ways — every one of them dropping input that held a real
// defect while the gate reported clean:
//
//   D1  only the FIRST matching table was read, so a matrix split by phase lost everything
//       after the first heading
//   D5  the same, applied to PROGRESS.md — so the reverse check, the scope-creep guard that
//       is the whole reason two-way traceability exists, ran against only the first section
//   D6  one stray blank line truncated the matrix and every row below it was discarded
//   D3  a ```markdown EXAMPLE table was taken as the live matrix, hiding the real one below
//   D9  no ragged-row detection at all, so one unescaped pipe shifted every later cell and
//       the row was read into the WRONG columns rather than reported
//
// These are not five defects. They are one: a private parser, invented here, that nothing
// else exercises. `lib.mjs`'s shared `parseTables()` — already used by content-check and
// quality-gate — has none of these faults, and it is now fence-aware, which closes D3 for
// every caller at once rather than only for this one.
//
// So this function keeps its name and its contract and becomes a thin adapter over the
// shared reader. Notably it MERGES every table whose header matches: a matrix split across
// phases is one matrix, and treating it as several was the cause of D1, D5 and D6.
//
// Reproduction: hooks/test/repro/X138-shared-table-reader.mjs.
function parseTable(text, wantHeaderRe) {
  const all = parseTables(text);
  const matching = all.filter((t) => t.headerCells.some((c) => wantHeaderRe.test(deEmphasise(c))));
  if (matching.length === 0) return null;

  // D6: a stray blank line inside a matrix ends the table, and the pipe-led line beneath it
  // becomes the HEADER of a new one — whose cells are data, so it matches nothing and was
  // dropped in silence along with every row below it.
  //
  // Reading it as a continuation would mean GUESSING that a pipe-led line is data rather
  // than a heading, and guessing is what caused a false-alarm regression in this codebase
  // earlier today. So it is REPORTED instead, on a signal with a real basis: a stray
  // fragment carrying exactly as many columns as the real matrix is a torn matrix, whereas
  // a legend or an aside carries a different number. That distinction is measured, not
  // assumed — and reporting cannot block a healthy file the way mis-reading it could.
  const width = matching[0].headerCells.length;
  const orphaned = all
    .filter((t) => !matching.includes(t) && t.headerCells.length === width)
    .map((t) => t.headerCells.join(' | '));
  const rows = [];
  for (const t of matching) {
    for (const r of t.rows) {
      rows.push({ cells: r.cells, raw: String(r.raw).trim(), ragged: r.ragged });
    }
  }
  // The first matching table names the columns. A later fragment with different columns
  // would be read positionally against these, so it is reported rather than trusted.
  const headers = matching[0].headerCells;
  const mismatched = matching
    .slice(1)
    .filter((t) => t.headerCells.join(' ') !== headers.join(' '))
    .map((t) => t.headerCells.join(' | '));
  return { headers, rows, mismatchedFragments: mismatched, orphanedFragments: orphaned };
}
function col(headers, re) {
  return headers.findIndex((c) => re.test(deEmphasise(c)));
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  // 2026-07-26 Stage 3 fix (audit finding 22, not originally named for this
  // file — found while fixing the same pattern in its four siblings). Was
  // two separate, unguarded calls racing against each other — see
  // lib.mjs's isDirectory() for the full reproduction (a crash instead of a
  // plain message if Dev-Memory disappears between the two calls).
  if (!isDirectory(devMemory)) {
    console.log(
      JSON.stringify({
        status: 'not a studio project',
        reason: 'no Dev-Memory/ directory — nothing to trace',
        root,
      }),
    );
    process.exit(0);
  }
  const reqFile = path.join(devMemory, 'REQUIREMENTS.md');
  const reqText = read(reqFile);
  if (reqText === null) {
    // Tiny Tier is documented (focus-guard/SKILL.md, Tier-scaling) as never
    // needing a REQUIREMENTS.md FILE — a short inline list is enough on that
    // Tier. Only an unambiguous "Tiny" read from OBJECTIVE.md's mandated
    // `**Tier:** ...` line relaxes this; anything else (Standard, Complex,
    // or an unreadable/ambiguous Tier) keeps today's BLOCKED behaviour
    // exactly, unchanged.
    const { tier, sawTierLine } = readTier(devMemory);
    if (tier === 'Tiny') {
      console.log(
        JSON.stringify(
          {
            status: 'clean',
            reason:
              'Tiny Tier (Dev-Memory/OBJECTIVE.md records "**Tier:** Tiny") — no REQUIREMENTS.md file is required on this Tier; the focus-guard skill allows a short inline list instead. Nothing to trace.',
            root,
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
    // 2026-07-31 second further-pass fix (R4): a project that wrote a
    // **Tier:** line that just didn't parse (decorated, ambiguous, wrong
    // case, two conflicting lines...) is told THAT, and given the three
    // exact accepted values — not just pointed at REQUIREMENTS.md, which
    // isn't their actual problem if they're genuinely Tiny Tier.
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: sawTierLine
            ? 'Dev-Memory/OBJECTIVE.md has a "**Tier:**" line but it could not be read as exactly one of Tiny, Standard, or Complex — check for decoration, extra wording, or more than one conflicting line. Until it reads as an unambiguous "**Tier:** Tiny", "**Tier:** Standard", or "**Tier:** Complex", this project is treated as Standard/Complex, which needs Dev-Memory/REQUIREMENTS.md — there is no traceability matrix to prove requirements map to tasks. Fix the Tier line, or create REQUIREMENTS.md (see the focus-guard skill), before a checkpoint commit or Publish.'
            : 'Dev-Memory/ exists but has no REQUIREMENTS.md — there is no traceability matrix to prove requirements map to tasks. Create it (see the focus-guard skill) before a checkpoint commit or Publish.',
          file: reqFile,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const problems = [];
  const notes = [];

  const reqTable = parseTable(reqText, /^(requirement|req|id)$/i);
  if (!reqTable) {
    problems.push(
      'REQUIREMENTS.md has no recognisable requirements table (need columns including a Requirement/ID, a Tasks, a Status, and a Verification column).',
    );
    console.log(
      JSON.stringify(
        { status: 'BLOCKED', reason: 'traceability matrix unreadable', problems },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  // 2026-08-15, the shared-table-reader build. Two things that used to be dropped in
  // silence are now said out loud. Neither guesses at the content: they report that
  // something in the file could not be read, which is the capability every one of these
  // gates was missing.
  for (const frag of reqTable.orphanedFragments || []) {
    problems.push(
      `REQUIREMENTS.md has a pipe table starting "${frag}" with the same number of columns as the matrix but no recognisable header — most often a matrix torn in two by a stray blank line, in which case every row below that line is going unchecked (finding X138 / D6).`,
    );
  }
  for (const r of reqTable.rows) {
    if (r.ragged)
      problems.push(
        `REQUIREMENTS.md row "${r.raw}" has a different number of cells than the header, so its values line up against the WRONG columns. Escape any literal pipe as \\| (finding X138 / D9).`,
      );
  }

  const H = reqTable.headers;
  const cId = col(H, /^(id|ref)$/i);
  const cReq = col(H, /^(requirement|req|need|criterion)$/i);
  const cTasks = col(H, /^(tasks?|task ?ids?|task ?refs?)$/i);
  const cStatus = col(H, /^status$/i);
  const cVerif = col(H, /^(verification|verify|evidence|proof)$/i);
  if (cTasks === -1)
    problems.push(
      'REQUIREMENTS.md has no "Tasks" column — cannot check that requirements map to tasks.',
    );
  if (cStatus === -1) problems.push('REQUIREMENTS.md has no "Status" column.');

  // Collect the task ids REQUIREMENTS.md references, and run FORWARD + STATUS.
  const referencedTaskIds = new Set();
  for (const { cells, raw } of reqTable.rows) {
    const label =
      cId !== -1 && cells[cId] ? cells[cId] : (cReq !== -1 ? cells[cReq] : raw).slice(0, 60);
    const status = cStatus !== -1 ? cells[cStatus] || '' : '';
    const statusForMatch = deEmphStatus(status); // decoration-stripped, for MET_RE/DEFERRED_RE
    const taskCell = cTasks !== -1 ? cells[cTasks] || '' : '';
    const ids = idsIn(taskCell);
    ids.forEach((id) => referencedTaskIds.add(id));

    if (cTasks !== -1 && ids.length === 0 && !DEFERRED_RE.test(statusForMatch)) {
      problems.push(
        `requirement "${label}" maps to no task and is not marked deferred/future — a dropped or unplanned requirement.`,
      );
    }
    if (cStatus !== -1 && MET_RE.test(statusForMatch)) {
      const verif = cVerif !== -1 ? cells[cVerif] || '' : '';
      // 2026-07-29 maintenance fix (round 3, F1): the status cell next to
      // this was already de-emphasised (deEmphStatus, above) — the
      // verification cell was not, so a placeholder disguised in bold, e.g.
      // "**tbd**", still failed PLACEHOLDER_RE as-is and was wrongly
      // accepted as real verification evidence.
      //
      // 2026-08-05 further-pass audit fix: CONTRADICTION_RE used to run
      // against the WHOLE raw row, so a requirement whose NAME contains a
      // contradiction word ("Fix regression in billing") wrongly BLOCKED a
      // genuinely met requirement. A contradiction claim lives in the
      // verification cell, never in the requirement's name — scope the check
      // to that cell (same class as the quality-gate.mjs evidence-cell fix).
      if (cVerif === -1 || PLACEHOLDER_RE.test(deEmphasise(verif).trim())) {
        problems.push(
          `requirement "${label}" is marked "${status.trim()}" but has no verification evidence — a met requirement needs proof.`,
        );
      } else if (CONTRADICTION_RE.test(verif)) {
        problems.push(
          `requirement "${label}" is marked met but its own row says it is currently failing/unverified → "${raw}"`,
        );
      }
    }
  }

  // DANGLING + REVERSE need PROGRESS.md's task ids.
  const progText = read(path.join(devMemory, 'PROGRESS.md'));
  if (progText === null) {
    notes.push(
      'PROGRESS.md not found — dangling-reference and scope-creep (reverse) checks not run.',
    );
  } else {
    const progTable = parseTable(progText, /^(id|task ?id|#|task)$/i);
    let idCol = -1;
    let progIds = null;
    if (progTable) {
      idCol = col(progTable.headers, /^(id|task ?id)$/i);
      if (idCol !== -1) {
        progIds = new Map(); // id -> row raw (for the exemption marker check)
        for (const { cells, raw } of progTable.rows) {
          for (const id of idsIn(cells[idCol] || '')) progIds.set(id, raw);
        }
      }
    }
    if (progIds === null) {
      notes.push(
        'reverse (scope-creep) and dangling checks not run — PROGRESS.md has no dedicated "ID"/"Task ID" column to match against. Add one to enable full two-way traceability.',
      );
    } else {
      // DANGLING: a requirement points at a task id that PROGRESS.md doesn't have.
      for (const id of referencedTaskIds) {
        if (!progIds.has(id))
          problems.push(
            `requirement references task "${id}" which does not exist in PROGRESS.md — a dangling reference.`,
          );
      }
      // REVERSE: a PROGRESS task traces back to no requirement (scope creep),
      // unless the row is explicitly exempted as chore/infra.
      for (const [id, raw] of progIds) {
        if (!referencedTaskIds.has(id) && !EXEMPT_RE.test(raw)) {
          problems.push(
            `task "${id}" in PROGRESS.md traces back to no requirement — possible scope creep. Link it to a requirement, or mark the row [chore]/[infra] if it is deliberately requirement-free.`,
          );
        }
      }
    }
  }

  if (problems.length === 0) {
    console.log(
      JSON.stringify(
        {
          status: 'clean',
          reason: 'requirements and tasks are in sync',
          requirements: reqTable.rows.length,
          notes,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(
    JSON.stringify({ status: 'BLOCKED', reason: 'traceability broken', problems, notes }, null, 2),
  );
  process.exit(1);
}

// 2026-08-13, finding X12: an input this gate cannot READ must never be reported
// as an input this gate is happy with. read() now throws on any error other than
// "genuinely absent", and that throw lands here, as a block with the real cause
// named — not as a silent pass.
try {
  main();
} catch (e) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        reason:
          'a requirements or progress file exists but could not be read, so traceability cannot be verified',
        detail: e && e.message ? e.message : String(e),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
