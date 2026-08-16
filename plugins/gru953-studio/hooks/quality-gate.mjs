#!/usr/bin/env node
//
// quality-gate.mjs — the gold-standard Definition-of-Done check that must pass
// before a phase is checkpoint-committed and before Publish. Zero dependencies
// (Node stdlib only).
//
// Added 2026-07-19 (Phase 0 guardrail spine). verify-progress.mjs already
// proves every task marked "done" carries a `verified:` cell — but a project
// can have every task verified and still ship below a professional bar: no
// independent review recorded, no security/licence pass, no accessibility
// consideration on a UI, stale docs. This script is the mechanical half of the
// `quality-gate` skill's Definition of Done: it verifies that a project's
// `Dev-Memory/QUALITY-GATE.md` records EVERY required quality dimension as
// passed (with evidence) or consciously marked not-applicable (with a reason)
// — so a dimension can never be quietly SKIPPED by simply leaving its row out.
//
// Like licence-scan.mjs / verify-progress.mjs / repo-integrity.mjs this is a
// maintainer/CI + pre-checkpoint/pre-Publish check, NOT a PreToolUse runtime
// hook — "is this project's Definition of Done met" cannot be judged from a
// single Bash call the way a push can. The quality-gate skill and the
// checkpoint-commit / publish-github flows document it as a required manual
// step; hooks.test.mjs exercises its logic; `node --check` covers its syntax.
//
// Design stance (matches this repo's anti-false-clean obsession): a false
// CLEAN here is far worse than a false BLOCK — nobody re-checks a green
// result before shipping. So every ambiguous state fails CLOSED (BLOCKED),
// and a required dimension that is simply absent from the file is a BLOCK,
// not a pass by omission.
//
// Usage: node quality-gate.mjs [projectRoot]
// Exit 0 = not a studio project, OR every required dimension passes/N-A with
//          evidence. Exit 1 = at least one dimension is unmet, missing, or
//          contradicted (all listed).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  stripBom,
  CONTRADICTION_RE,
  deEmphasise,
  isDirectory,
  PLACEHOLDER_RE,
  // X143: evidence is judged by this, which also catches a placeholder with an excuse
  // appended ("tbd - will attach after the demo"), while leaving real sentences alone.
  isPlaceholderEvidence,
  parseTables,
} from './lib.mjs';

// The required Definition-of-Done dimensions. Each must appear as at least one
// row in QUALITY-GATE.md whose Item cell contains the keyword, marked pass (with
// evidence) or N/A (with a reason). Keeping this list HERE — not in the file
// under test — is what stops a project hiding a skipped dimension by omission:
// the row can be marked "n/a — no user interface", but it cannot be missing.
//
// Deliberately English-only keywords: QUALITY-GATE.md is an internal
// maintainer/CI record (like PROGRESS.md and REQUIREMENTS.md), and the
// quality-gate skill's own template uses English column headers and item
// labels — Bangla is the project's user-FACING language (in-app text,
// content), not this internal bookkeeping convention. Noted 2026-07-19 (an
// audit pass flagged this as worth stating explicitly rather than leaving
// implicit): an Item label written in Bangla fails safe — the dimension is
// reported MISSING, never a false pass — but locking this down here so a
// future change is a deliberate choice, not an accident.
const REQUIRED = [
  { key: 'acceptance', match: /accept/i, label: 'acceptance criteria proven' },
  { key: 'tests', match: /\btest/i, label: 'tests pass (with evidence)' },
  { key: 'review', match: /review/i, label: 'independent code review' },
  {
    key: 'security',
    match: /secur|secret|licen[cs]e|privac|vuln/i,
    label: 'security / licence / privacy clean',
  },
  { key: 'accessibility', match: /access/i, label: 'accessibility (or N/A with a reason)' },
  { key: 'docs', match: /\bdoc/i, label: 'documentation updated' },
  { key: 'build', match: /reproduc|\bbuild/i, label: 'reproducible build' },
];

// A status cell that counts as a genuine pass. Deliberately narrow — an empty
// cell, "todo", "pending", "in progress", "fail", "blocked", "no" are NOT here
// and therefore fail closed.
// 2026-07-19 audit fix (real bug, found by execution): a single trailing `\b`
// after the whole alternation applied to the ✅/✓ symbol alternatives too, but
// `\b` requires a `\w` character on one side — neither the symbol nor whatever
// follows it (whitespace, end-of-string, a table-cell pipe) is a word
// character, so `\b` can never match there. This made "✅"/"✓" dead
// alternatives: a cell that is exactly "✅" (or "✅" followed by a space) was
// never recognised as a pass, even though the regex explicitly lists it as
// one — confirmed live: `/…✅|✓)\b/i.test("✅")` returns false. Fixed by
// scoping `\b` to only the word-based alternatives, which genuinely need it
// (so "passing" doesn't loosely match "pass"), while the symbol alternatives
// match on their own with no boundary requirement.
const PASS_RE = /^\s*(pass(ed)?\b|ok\b|green\b|done\b|met\b|yes\b|✅|✓)/i;
// A status cell that counts as a conscious not-applicable. Requires a reason in
// the evidence cell (checked below) so "n/a" alone can't wave a dimension past.
const NA_RE = /^\s*(n\/?a|not[ \t]+applicable|skip(ped)?)\b/i;
// An evidence cell that is really empty / a placeholder — treated as no
// evidence. 2026-07-29 maintenance fix (audit finding 4): this used to be its
// own local copy, identical to memory-integrity.mjs's and
// traceability-check.mjs's — now imported from lib.mjs (see its own comment)
// so the three cannot drift apart again.
// A row that narrates it is currently broken/unproven invalidates any otherwise
// passing status on the same row — the same guard verify-progress.mjs uses, so
// "passed on the old build, now fails" can't count as done.
//
// 2026-07-26, found during a further pass after fixing the same bug class in
// verify-progress.mjs (audit finding 1). This pattern only matched the literal
// word "exit" immediately followed by whitespace and a digit — so the far more
// natural phrasing "exit code 1" or "exited with code 1" never matched at all.
// Reproduced: a Definition-of-Done row reading "Ran npm test - exit code 1,
// 3 failing" with an otherwise-Pass status returned {"status":"clean"}. Added
// an alternative that also recognises "exit[ed] [with] code N".
//
// 2026-07-26 further-pass audit fix: moved to lib.mjs as CONTRADICTION_RE —
// this file's own copy (the most complete of the three, including the
// `regress(?:ed|ion)` alternative) had already diverged from
// verify-progress.mjs's and traceability-check.mjs's own copies, which is
// exactly how findings 1/35 above escaped this file's two siblings for as
// long as they did. One shared pattern now, not three that can drift.
//
// SEPARATOR_ROW_RE (the `| :-- | :-- |` divider row) is imported from
// lib.mjs for the same reason, as of the 2026-07-29 maintenance fix (audit
// finding 4) — see lib.mjs's own comment.

// 2026-07-26, audit finding 26. Strips a leading UTF-8 byte-order mark before
// parsing. Checked precisely rather than assumed: this file's own table-row
// test (`/^\s*\|/`) turns out to ALREADY tolerate a BOM, because JavaScript's
// `\s` character class matches U+FEFF — verified by execution, both with and
// without this stripBom() call, on the exact same BOM-prefixed fixture. So
// this is deliberate hardening, not a demonstrated-bug fix: it stops the
// file's correctness depending on that accidental regex quirk, which a future
// tightening of the row-detection pattern (a very plausible refactor) could
// silently break. (Two OTHER files DID have a real, reproduced BOM bug —
// memory-integrity.mjs and dashboard.mjs both use a STRICT `^#` heading
// regex with no `\s*` prefix, which a BOM genuinely defeats.)
function read(p) {
  try {
    return stripBom(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Parse the FIRST markdown table in the file whose header has both an
// Item-like and a Status column, into rows of {item, status, evidence, raw}.
// Stops at that table's end (a non-`|` line) rather than resetting and
// continuing to scan later tables — mirrors traceability-check.mjs's
// parseTable() single-table-selection discipline. Found 2026-07-19 (real
// bug): the previous version reset and kept scanning every subsequent
// table, so ANY other Item+Status-shaped table later in the same file (e.g.
// an unrelated backlog list) had its rows swept into the required-dimension
// matching below — a row like "Improve test coverage tooling | todo" could
// spuriously satisfy/contradict the "tests" dimension and wrongly BLOCK (or,
// worse, wrongly pass) a checkpoint that the real Definition-of-Done table
// already cleared.
// 2026-08-13, finding X2 (CRITICAL, reproduced by execution — see
// test/repro/phase1-gate-honesty.mjs case P1). The version above read only the
// FIRST Item+Status table and stopped. So a project that appended its CURRENT
// phase's Definition of Done below the finished one — which `dev-memory`'s own
// append-never-rewrite discipline actively encourages — got `{"status":"clean"}`
// from this gate while its live table read
// `| Automated tests | fail | npm test -> exit 1, 3 failing |`. This is the gate
// that authorises checkpoint commits and Publish, and its own header promises
// "every ambiguous state fails CLOSED".
//
// Now EVERY table whose header carries an Item-like and a Status column
// contributes its rows, and main() already requires every matching row to be a
// clean pass, so a failure anywhere blocks.
//
// The 2026-07-19 fix that introduced first-table-only was guarding against a real
// case: an unrelated Item+Status table later in the file (a backlog list with a
// row like "Improve test coverage tooling | todo") injecting a spurious row into
// the "tests" dimension and wrongly blocking a complete DoD table.
//
// 2026-08-13, independent-review finding F1 (CRITICAL, reproduced). My first
// attempt at reconciling those two risks used a coverage heuristic: a table
// counted only if its rows covered at least three distinct required dimensions.
// That reintroduced X2 for any NARROW table — and a narrow table is the most
// likely real-world shape, because a phase in progress appends only the
// dimensions still outstanding. Reproduced: a complete passing table followed by
// a single row `| Automated tests | fail | npm test -> exit code 1, 3 failing |`
// returned `{"status":"clean"}`. The heuristic discarded precisely the tables most
// likely to record a live failure. Being clever was worse than being blunt.
//
// So: EVERY Item+Status table counts, with no heuristic. The unrelated-table case
// is still expressible, but it must now be DECLARED rather than guessed at — an
// explicit `<!-- not-a-definition-of-done -->` marker in the few lines above a
// table excludes it. A silent exclusion is what caused this defect twice; an
// explicit one is auditable, and anyone reading the file can see it.
//
// Also new: a RAGGED row — one whose column count disagrees with its header — is
// no longer silently skipped. That was finding P11: a raw `|` inside an Evidence
// cell shifted every later column, so `| Automated tests | pass | npm test |
// tail -5 -> exit code 1, 3 failing right now |` parsed as a different shape and
// the recorded failure became invisible. Such a row cannot be read positionally,
// so it is reported as unverifiable and blocks — the same discipline
// verify-progress.mjs already applies.
// A table preceded by this marker is deliberately not part of the Definition of
// Done. Kept explicit on purpose (finding F1): the only safe way to exclude a
// table is for a human to say so in the file, where a reader can see it.
const NOT_A_DOD_RE = /<!--\s*not-a-definition-of-done\s*-->/i;
const OPT_OUT_LOOKBACK = 3;
function parseRows(text) {
  const lines = String(text).split(/\r?\n/);
  const optedOut = (headerLine) => {
    for (let k = Math.max(0, headerLine - OPT_OUT_LOOKBACK); k < headerLine; k++) {
      if (NOT_A_DOD_RE.test(lines[k])) return true;
    }
    return false;
  };
  const candidates = [];
  for (const [tableIndex, table] of parseTables(text).entries()) {
    if (optedOut(table.headerLine)) continue; // explicitly declared not a DoD table
    // 2026-07-26 further-pass audit fix, preserved: deEmphasise() so a decorated
    // header like "**Status**" or "`Status`" is recognised the same as "Status".
    const find = (re) => table.headerCells.findIndex((c) => re.test(deEmphasise(c)));
    const idx = {
      item: find(/^(item|check|dimension|requirement|criterion|gate)$/i),
      // 2026-08-15, finding X143 / quality-gate D1 (High, reproduced). This was
      // `find(/^status$/i)` and nothing else, so a second Definition-of-Done table headed
      // `| Item | Result | Evidence |` — recording a re-run that FAILED — had no column this
      // gate calls Status, was skipped entirely, and the gate reported clean. The first
      // table's presence suppressed the "no Definition-of-Done table" failure, so nothing was
      // said at all.
      //
      // That is the X122 shape one gate along: a register nobody can read, sitting beside one
      // that can. And the answer is the same one X122 arrived at the hard way — RECOGNISE the
      // ordinary word rather than add a heuristic about what a table looks like. A synonym
      // list cannot raise a false alarm: a table with none of these columns is still not a
      // Definition-of-Done table and is still left alone.
      status: find(/^(status|result|outcome|verdict|state)$/i),
      evidence: find(/^(evidence|proof|notes?|verified|command)$/i),
    };
    if (idx.item === -1 || idx.status === -1) continue; // not a Definition-of-Done shape
    candidates.push({ tableIndex, table, idx });
  }

  // Every candidate counts. No heuristic, no position rule — see finding F1 above.
  const rows = [];
  const ragged = [];
  for (const { tableIndex, table, idx } of candidates) {
    for (const r of table.rows) {
      if (r.ragged) {
        if (r.cells.some((c) => c !== '')) ragged.push(r.raw.trim());
        continue;
      }
      const item = r.cells[idx.item] || '';
      const status = r.cells[idx.status] || '';
      const evidence = idx.evidence === -1 ? '' : r.cells[idx.evidence] || '';
      // 2026-08-15, finding X144 / quality-gate D3 and D4. The contradiction check read the
      // EVIDENCE cell alone, so two claims of failure were invisible: one written in the
      // STATUS cell ("pass, but 3 still failing" — PASS_RE is prefix-anchored and matches
      // "pass"), and one written in a FOURTH column, because idx.evidence takes the first
      // matching header and a later Notes column is never read.
      //
      // Scanning the whole row would undo a deliberate fix of 2026-08-05: CONTRADICTION_RE
      // used to run against the raw row, and the word "Regression" in an item's NAME wrongly
      // blocked a green row. So the rule is every cell EXCEPT the item name — the name is a
      // label, every other cell is a claim. Control E of the reproduction holds that exact
      // regression row so this cannot be undone by accident.
      const claimCells = r.cells.filter((_, i) => i !== idx.item);
      const contradiction = claimCells.find((c) => CONTRADICTION_RE.test(c));
      // D2: a row with a blank Item cell used to be dropped here, before anything was read —
      // so a continuation row recording a real failure vanished. It is no longer attributable
      // to a dimension, but a failure it records still counts.
      if (!item) {
        if (contradiction) {
          problems.push(
            `a row with no Item name records a failure that nothing else in this file accounts for → "${r.raw.trim()}" (finding X144)`,
          );
        }
        continue;
      }
      rows.push({
        contradiction, item, status, evidence, raw: r.raw.trim(), tableIndex });
    }
  }
  return { rows, ragged };
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  // Not a studio project (e.g. the plugin repo itself, or any ordinary dir) →
  // there is nothing to gate. No-op green, exactly like verify-progress.mjs on
  // a tree with no PROGRESS.md.
  //
  // 2026-07-26 Stage 3 fix (audit finding 22): was two separate, unguarded
  // calls racing against each other — see lib.mjs's isDirectory() for the
  // full reproduction (a crash instead of a plain message if Dev-Memory
  // disappears between the two calls).
  if (!isDirectory(devMemory)) {
    console.log(
      JSON.stringify({
        status: 'not a studio project',
        reason: 'no Dev-Memory/ directory — nothing to gate',
        root,
      }),
    );
    process.exit(0);
  }
  const file = path.join(devMemory, 'QUALITY-GATE.md');
  const text = read(file);
  if (text === null) {
    // A real studio project asked to be gated but has no Definition-of-Done
    // record at all. Fail closed — this is precisely the "shipped below the bar
    // with nothing recorded" case the gate exists to stop.
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason:
            'Dev-Memory/ exists but has no QUALITY-GATE.md — the Definition of Done has no record to verify. Create it (see the quality-gate skill) before a checkpoint commit or Publish.',
          file,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const { rows, ragged } = parseRows(text);
  const problems = [];
  // D6: which Item row satisfied each required dimension. Reported on a clean verdict so a
  // collision is visible to a reader even though the gate does not judge it.
  const satisfiedBy = {};
  if (rows.length === 0) {
    problems.push(
      'QUALITY-GATE.md contains no Definition-of-Done table (need a table with at least "Item" and "Status" columns).',
    );
  }
  // A row whose columns do not line up with its header cannot be read
  // positionally, so its status and evidence cannot be trusted. Fail closed
  // rather than skip it — an unescaped `|` inside an Evidence cell is the
  // common cause, and it hid a recorded test failure (finding P11). Escape it
  // as `\|`, per GitHub-flavoured markdown, and this clears.
  for (const raw of ragged) {
    problems.push(
      `a row's columns do not line up with its header, so its status cannot be verified → "${raw}" (an unescaped "|" inside a cell is the usual cause — write it as \\|)`,
    );
  }
  for (const dim of REQUIRED) {
    const matches = rows.filter((r) => dim.match.test(r.item));
    // 2026-08-15, finding D6 of the silent-skip sweep — answered by MEASUREMENT rather than by
    // tightening. D6 says a dimension can be satisfied by an unrelated row, because the Item
    // cell only has to CONTAIN the keyword.
    //
    // Measured across 24 distinct Item labels from six sources — this project's live table,
    // the golden fixture, two sibling checkouts, the documented template and the test suite:
    //
    //     labels matching MORE than one dimension : 0
    //     keyword at the START of the label       : 6 of 10 real labels
    //     keyword LATER in the label              : 4 of 10
    //       ("Automated tests", "Independent code review", "Regression tests",
    //        "Improve test coverage tooling integration")
    //
    // So no collision occurs in any real data, and the obvious tightening — requiring the
    // keyword at the start — would MISS 4 of 10 real labels and block healthy projects with
    // "missing required dimension". That is the failure mode that gets a gate switched off,
    // and it would be a worse defect than the one being fixed.
    //
    // The evidence therefore says: do not tighten. What it does support is making the match
    // VISIBLE, so a human reading a clean verdict can see which row vouched for each
    // dimension and spot a wrong one themselves. This changes nothing about what passes, so
    // it carries no false-alarm risk at all. D6 stays open as a disclosed residual with the
    // measurement attached.
    satisfiedBy[dim.key] = matches.map((r) => r.item);
    if (matches.length === 0) {
      problems.push(
        `missing required dimension: ${dim.label} — no row in QUALITY-GATE.md covers it (mark it pass with evidence, or "n/a" with a reason, but it may not be absent).`,
      );
      continue;
    }
    // A dimension is satisfied only when EVERY matching row is a clean pass
    // (with evidence) or a reasoned N/A — a single row that is unevidenced,
    // self-contradicting, or has any other non-pass status still blocks. You
    // cannot pass "tests" by adding a second green row beside a red one.
    // Blocking is driven purely by problems pushed here, so a dimension whose
    // matching rows are all clean records nothing and does not block.
    for (const r of matches) {
      // 2026-08-05 further-pass audit fix (found by execution): CONTRADICTION_RE
      // used to run against the WHOLE raw row, so the word "Regression" in an
      // item/label cell ("| Regression tests | pass | `npm test` -> exit 0 |")
      // tripped the `regress(?:ed|ion)` alternative and wrongly BLOCKED a
      // legitimately green row. A contradiction claim lives in the EVIDENCE
      // cell, never in the item's name — scope the check to that cell, the
      // same cell the placeholder/evidence checks below already read.
      // X144: `contradiction` is the first claim cell that says this row is failing —
      // every cell except the item's name. Previously this tested r.evidence alone.
      if (r.contradiction) {
        problems.push(
          `${dim.label}: a row is marked passing but its own text says it is currently failing/unverified → "${r.raw}"`,
        );
        break;
      }
      // 2026-07-29 maintenance fix (audit finding 3): the header-matching
      // deEmphasise() fix elsewhere in this file only reached header cells —
      // a decorated status VALUE like "**pass**" or "**n/a**" still failed
      // PASS_RE/NA_RE as-is and was wrongly BLOCKED. Same fix, one layer
      // deeper (verify-progress.mjs already de-emphasises its status VALUE
      // the same way).
      //
      // 2026-07-29 maintenance fix (round 3, F1): that same value-cell fix
      // never reached the EVIDENCE cell next to it — a placeholder disguised
      // in bold, e.g. "**tbd**", still failed PLACEHOLDER_RE as-is and was
      // wrongly accepted as real evidence.
      if (PASS_RE.test(deEmphasise(r.status))) {
        if (isPlaceholderEvidence(deEmphasise(r.evidence))) {
          problems.push(
            `${dim.label}: marked "${r.status}" but carries no evidence — a pass needs a concrete proof/command/reference.`,
          );
        }
      } else if (NA_RE.test(deEmphasise(r.status))) {
        if (isPlaceholderEvidence(deEmphasise(r.evidence))) {
          problems.push(
            `${dim.label}: marked not-applicable but gives no reason — "n/a" needs a stated reason (e.g. "no user interface").`,
          );
        }
      } else {
        problems.push(
          `${dim.label}: status "${r.status || '(empty)'}" is not a pass — must be pass (with evidence) or n/a (with a reason).`,
        );
      }
    }
  }
  if (problems.length === 0) {
    console.log(
      JSON.stringify(
        {
          status: 'clean',
          reason:
            'every required Definition-of-Done dimension passes or is consciously N/A with a reason',
          dimensions: REQUIRED.map((d) => d.key),
          // D6: name the row that vouched for each dimension. A dimension satisfied by a row
          // that is plainly about something else is then visible here, rather than hidden
          // behind the word "clean".
          satisfiedBy,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(
    JSON.stringify({ status: 'BLOCKED', reason: 'Definition of Done not met', problems }, null, 2),
  );
  process.exit(1);
}

main();
