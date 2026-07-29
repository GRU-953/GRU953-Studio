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
// Exit 0 = not a studio project, OR the matrix is internally consistent.
// Exit 1 = at least one traceability problem (all listed).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  splitPipeCells,
  stripBom,
  CONTRADICTION_RE,
  deEmphasise,
  isDirectory,
  SEPARATOR_ROW_RE,
  PLACEHOLDER_RE,
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
function read(p) {
  try {
    return stripBom(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function idsIn(cell) {
  if (!cell || PLACEHOLDER_RE.test(cell.trim())) return [];
  return (cell.match(TASK_ID_RE) || []).map((s) => s.toUpperCase());
}

// Generic per-table parser: returns { headers, rows } for the FIRST table whose
// header matches `wantHeader`, resetting on any non-`|` line so a stray earlier
// table can't leak its columns. Each row is the array of trimmed cells.
function parseTable(text, wantHeaderRe) {
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let headers = null;
  const rows = [];
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      if (headers) break; // finished the table we wanted
      inTable = false;
      continue;
    }
    const cells = splitPipeCells(line).map((c) => c.trim());
    if (!inTable) {
      inTable = true;
      // 2026-07-26 further-pass audit fix: de-emphasise before testing, the
      // same as verify-progress.mjs already does — otherwise a decorated
      // header ("**ID**", "`Requirement`") makes the whole table
      // unrecognised even though every row is otherwise well-formed.
      if (cells.some((c) => wantHeaderRe.test(deEmphasise(c)))) headers = cells;
      continue;
    }
    if (!headers) {
      inTable = false;
      continue;
    }
    if (SEPARATOR_ROW_RE.test(line)) continue;
    rows.push({ cells, raw: line.trim() });
  }
  return headers ? { headers, rows } : null;
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
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason:
            'Dev-Memory/ exists but has no REQUIREMENTS.md — there is no traceability matrix to prove requirements map to tasks. Create it (see the focus-guard skill) before a checkpoint commit or Publish.',
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
      if (cVerif === -1 || PLACEHOLDER_RE.test(deEmphasise(verif).trim())) {
        problems.push(
          `requirement "${label}" is marked "${status.trim()}" but has no verification evidence — a met requirement needs proof.`,
        );
      } else if (CONTRADICTION_RE.test(raw)) {
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

main();
