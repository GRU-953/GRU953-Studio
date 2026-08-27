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
  classifyStudioRoot,
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
    // 2026-08-25, from the X138-X173 band (re-issued as X318). `Penetration testing` satisfied the
    // TESTS dimension, because that matcher is `/\btest/i` and "testing" begins with "test" — so a
    // Definition of Done could pass with a pentest report and NO unit-test run recorded anywhere.
    // Measured: with an accessibility row present and `Penetration testing` the only test-shaped row,
    // the gate returned clean.
    //
    // Fixed by claiming the phrase for the dimension it belongs to rather than by tightening the
    // tests matcher. X119 made the FIRST keyword by POSITION win, so `penetrat` at index 0 beats
    // `test` at index 12 and the row lands in security — where a pentest report is real evidence.
    // Enumerating the security-testing phrases is narrower than trying to define what "test" may not
    // touch (L15: enumerate, never sweep).
    //
    // Residual, stated: `load testing` or `smoke testing` still satisfy TESTS. That is defensible —
    // both are test runs — and is not the defect this closes.
    match: /secur|secret|licen[cs]e|privac|vuln|penetrat|pentest|threat model/i,
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
  // X144 / P6-L1: blank-Item rows whose other cells record a failure.
  const orphanFailures = [];
  for (const { tableIndex, table, idx } of candidates) {
    for (const r of table.rows) {
      if (r.ragged) {
        // X201: carry WHICH kind of raggedness, so the message below can be true.
        if (r.cells.some((c) => c !== '')) ragged.push({ raw: r.raw.trim(), short: r.short });
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
        // 2026-08-15, P6 round 1 finding L1 — a crash I introduced with X144 hours earlier.
        // This called problems.push() from inside parseRows(), where `problems` does not
        // exist: it is a const declared in main(). Any QUALITY-GATE.md carrying a blank-Item
        // row with a recorded failure crashed the gate with a ReferenceError.
        //
        // Collected alongside `ragged` instead — which this function already returns for
        // exactly this purpose — and reported by main(). Same outcome, correct scope.
        //
        // `npm run lint` catches an undefined variable and would have caught this. It is in
        // the repo's own CI and I did not run it: I ran the twelve documented gates all day
        // and never the static job beside them. That is the lesson, not the typo.
        if (contradiction) orphanFailures.push(r.raw.trim());
        continue;
      }
      rows.push({
        contradiction,
        item,
        status,
        evidence,
        raw: r.raw.trim(),
        tableIndex,
      });
    }
  }
  return { rows, ragged, orphanFailures };
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
  // 2026-08-26, X370. Was `if (!isDirectory(devMemory))` alone, which answered
  // "not a studio project" with exit 0 for a root that does not exist, a root that is a
  // FILE, and a Dev-Memory that is a file — i.e. for every state in which this gate had
  // examined nothing. Reproduced by execution against `/definitely/not/here` and against
  // `./README.md`, while licence-scan.mjs on the same input correctly answered BLOCKED.
  // classifyStudioRoot() separates "readable root, genuinely no Dev-Memory/" (stand aside,
  // exit 0 — load-bearing, this gate runs in ordinary checkouts) from "could not look"
  // (BLOCKED, exit 1). Single-sourced in lib.mjs because five copies is how it drifted.
  const rootKind = classifyStudioRoot(root);
  if (rootKind.kind === 'unreadable') {
    console.log(
      JSON.stringify({
        status: 'BLOCKED',
        problems: [rootKind.why],
        root,
      }),
    );
    process.exit(1);
  }
  if (rootKind.kind === 'not-studio') {
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
  const { rows, ragged, orphanFailures } = parseRows(text);
  const problems = [];
  // D6: which Item row satisfied each required dimension. Reported on a clean verdict so a
  // collision is visible to a reader even though the gate does not judge it.
  const satisfiedBy = {};
  // X144 / P6-L1: a blank-Item row cannot be attributed to a dimension, but a failure it
  // records still counts and is reported on its own terms.
  for (const raw of orphanFailures) {
    problems.push(
      `a row with no Item name records a failure that nothing else in this file accounts for → "${raw}" (finding X144)`,
    );
  }
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
  for (const r of ragged) {
    // X201: two opposite problems had one message, and half the time it was wrong.
    problems.push(
      r.short
        ? `a row has FEWER cells than its header, so a trailing column is absent and this row's status cannot be read -> "${r.raw}" (a short row is legal markdown - add the missing cell, or a trailing "|" for each empty one)`
        : `a row has MORE cells than its header, so its values line up against the wrong columns and its status cannot be verified -> "${r.raw}" (an unescaped "|" inside a cell is the usual cause - write it as \\|)`,
    );
  }
  // ANY row that is not a pass and not a conscious n/a is a failure — whether or not this gate
  // has a required dimension by that name.
  //
  // 2026-08-27 (pass 2). REQUIRED lists seven keywords; dod.mjs writes TWELVE rows. So `Lint`,
  // `Type check`, `Test coverage`, `Dependency audit` and `Performance budget` matched none of
  // them and were never examined at all. Measured: editing the generated table's Lint row to
  // `| Lint | BLOCKED | exit code 1, 42 errors |` left this gate reporting CLEAN. A gate that
  // reads seven of twelve rows and calls the record complete is not reading the record.
  //
  // X143's rule already covers a row that is UNMATCHED-and-blank; this covers a row that is named,
  // unmatched by the required list, and failing.
  for (const r of rows) {
    const item = (r.item || '').trim();
    const status = (r.status || '').trim();
    if (item === '' || status === '') continue;
    if (PASS_RE.test(deEmphasise(status)) || NA_RE.test(deEmphasise(status))) continue;
    problems.push(
      `the row "${item}" records status "${status}", which is neither a pass nor a conscious n/a. Every row in this record must be one or the other — this gate used to examine only the seven rows matching a required dimension, so a failing row for any other dimension was invisible.`,
    );
  }

  for (const dim of REQUIRED) {
    // 2026-08-24, X119's residual — evidence is now TIED to a dimension.
    //
    // A row used to satisfy every dimension whose keyword it contained, so one row and one piece of
    // evidence could vouch for two. Measured: delete the review row, relabel "Accessibility" as
    // "Accessibility review", and the gate returned CLEAN with independent code review signed off by
    // an accessibility row. That is the mechanism behind X276.
    //
    // The 2026-08-15 pass answered this by measurement and correctly REFUSED the tightening it
    // considered — requiring the keyword at the START of the label would have missed "Automated
    // tests", "Independent code review" and "Regression tests", and blocked healthy projects. What it
    // could not see is that it sampled the labels which HAPPEN TO EXIST: of twelve ordinary
    // alternatives, eight collide ("Security review", "Build and test", "Test documentation",
    // "Licence review" among them).
    //
    // The rule that works is neither of those: a row belongs to the dimension whose keyword appears
    // FIRST IN ITS LABEL, and to that one only. Checked against every real label in the project, the
    // golden fixture, the documented template and the test suite — all nine keep the dimension they
    // were plainly written for, including the four that keyword-at-start would have lost. And every
    // colliding label gets one sensible owner: "Accessibility review" is about accessibility,
    // "Security review" about security, "Code review and tests" about review.
    //
    // Every row that matches anything is still primary for exactly one dimension, so no row escapes
    // the pass/fail checks below — narrowing the match cannot let a failing row through unexamined.
    const firstHit = (item) => {
      let best = null;
      for (const d of REQUIRED) {
        const hit = d.match.exec(item);
        if (hit && (best === null || hit.index < best.index))
          best = { key: d.key, index: hit.index };
      }
      return best && best.key;
    };
    const matches = rows.filter((r) => firstHit(r.item) === dim.key);
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

  // ---- PROVENANCE: was this table measured, or written by the work it grades? --------------
  //
  // THE HOLE THIS CLOSES. Everything above verifies the SHAPE of the record — every required
  // dimension present, marked pass or consciously n/a, with evidence text that is not a
  // placeholder. None of it asks where the record came from. So the table copied verbatim out of
  // skills/quality-gate/SKILL.md's own worked example, in a Dev-Memory holding nothing else at
  // all — no dod.json, dod.mjs never run — returned {"status":"clean"} and exit 0. Reproduced
  // 2026-08-27 (contract sweep). Publish's pre-flight ran this gate and cleared the Definition of
  // Done from a table the graded agents had written themselves.
  //
  // That is the whole defect class the v7 rebuild exists to end: the agent does the work, the
  // agent writes its own report card, the gate marks the report card. Interactively a person
  // notices when the app does not work. Unattended, nothing does.
  //
  // dod.mjs already RUNS each dimension and records exit codes, argv and timings into
  // Dev-Memory/evidence/. It was write-only: it was the sole writer and no gate ever read it
  // back, so its measurements changed no verdict anywhere. This arm reads them, which is what
  // makes evidence/ load-bearing rather than decorative.
  //
  // WHAT IS AND IS NOT CLAIMED. This does not defeat a determined forger with write access — a
  // hand-authored evidence/ directory would satisfy it. It closes the DEFAULT path, which is the
  // one that was open: following the documented protocol produced an attested table, and no step
  // anywhere required the measurement. Forgery is separately made awkward by config-protection.mjs
  // refusing writes to evidence/ and dod.json. Depth, not a single wall.
  {
    const evidenceDir = path.join(devMemory, 'evidence');
    let files = null;
    try {
      files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith('.json'));
    } catch {
      files = null;
    }
    if (files === null || files.length === 0) {
      problems.push(
        'this table has no measurements behind it: Dev-Memory/evidence/ is missing or empty. Every row above may be perfectly worded and still record nothing that was run — which is what happened before this check existed. Run `node hooks/dod.mjs .`, which executes each dimension, records its exit code in Dev-Memory/evidence/ and regenerates this table from those results. A Definition of Done written by the work it grades is not a Definition of Done.',
      );
    } else if (!/GENERATED by hooks\/dod\.mjs/.test(text)) {
      problems.push(
        'Dev-Memory/QUALITY-GATE.md was not generated by hooks/dod.mjs — it carries no generated marker, so it is a hand-written table sitting next to a measured evidence/ directory it may agree with or contradict. Re-run `node hooks/dod.mjs .` so the table is rendered from the evidence rather than composed alongside it.',
      );
    } else {
      // Each evidence file names the row it renders as, so the table can be checked against the
      // measurements without this gate keeping a second copy of dod.mjs's vocabulary. Two copies
      // of a vocabulary is how two gates come to disagree about what a row means.
      const measured = new Map();
      let newest = null;
      let undated = 0;
      for (const f of files.sort()) {
        let rec;
        try {
          rec = JSON.parse(fs.readFileSync(path.join(evidenceDir, f), 'utf8'));
        } catch (e) {
          problems.push(
            `Dev-Memory/evidence/${f} is not readable as JSON (${e.message}). Unreadable evidence is not evidence; this gate will not treat it as absent either, because absent and corrupt are different problems with different fixes.`,
          );
          continue;
        }
        if (!rec || typeof rec !== 'object' || typeof rec.verdict !== 'string') {
          problems.push(
            `Dev-Memory/evidence/${f} carries no \`verdict\`, so nothing can be concluded from it.`,
          );
          continue;
        }
        if (typeof rec.row === 'string' && rec.row.trim() !== '') measured.set(rec.row.trim(), rec);
        // A measurement that did not pass, while the table above says every dimension is met.
        // The table is generated, so this should be impossible — which is exactly why it is
        // worth asserting: if it ever happens, the table is stale or was edited after the fact.
        if (rec.verdict !== 'pass' && rec.verdict !== 'n/a') {
          problems.push(
            `Dev-Memory/evidence/${f} records \`${rec.verdict}\`${rec.why ? ` (${String(rec.why).slice(0, 160)})` : ''}, but the table reports this Definition of Done as met. The measurement and the record disagree, and the measurement is the one that ran something.`,
          );
        }
        const t = Date.parse(rec.endedAt || rec.recordedAt || '');
        if (Number.isFinite(t)) {
          if (newest === null || t > newest) newest = t;
        } else {
          undated += 1;
        }
      }

      // The generator's own verdict, if it stated one. dod.mjs writes `Result: BLOCKED` when the
      // run it just performed recorded problems — which used to be invisible here, because the
      // table it wrote alongside that verdict could still be entirely green.
      if (/^Result:\s*BLOCKED/m.test(text)) {
        const line = /^Result:\s*BLOCKED[^\n]*/m.exec(text);
        problems.push(
          `Dev-Memory/QUALITY-GATE.md was generated by a run that REFUSED this project — ${line ? line[0].slice(0, 220) : 'its Result line says BLOCKED'}. The rows below are from that same refused run and must not be read as a pass.`,
        );
      }

      // FRESHNESS. A generated table is only as true as the moment it was generated. Without
      // this, a run could measure a failure into evidence/ and leave yesterday's clean table in
      // place — the record and the measurement drift apart silently, and the gate reads the
      // older one. Both timestamps are written by dod.mjs, which writes evidence before the
      // table, so a correct run always satisfies this.
      const stamp = /^Generated:\s*(\S+)/m.exec(text);
      const generatedAt = stamp ? Date.parse(stamp[1]) : NaN;
      if (!Number.isFinite(generatedAt)) {
        problems.push(
          'Dev-Memory/QUALITY-GATE.md carries the generated marker but no readable `Generated:` timestamp, so this gate cannot tell whether the table is newer than the measurements it claims to render.',
        );
      } else if (undated > 0) {
        // 2026-08-27, found by attacking this arm: `newest` stays null when NO evidence record
        // carries a timestamp, and the freshness comparison below is guarded on `newest !== null`
        // — so a table dated 1970 sitting over undated evidence was clean. The check that exists
        // to catch a stale table failed open on the one input where staleness cannot be ruled
        // out. Every record dod.mjs writes carries endedAt or recordedAt, so undated evidence did
        // not come from dod.mjs.
        problems.push(
          `${undated} file(s) in Dev-Memory/evidence/ carry no \`endedAt\` or \`recordedAt\` timestamp, so this gate cannot tell whether the table renders them or predates them. dod.mjs stamps every record it writes; undated evidence was not produced by it. Re-run \`node hooks/dod.mjs .\`.`,
        );
      } else if (newest !== null && generatedAt < newest - 1000) {
        problems.push(
          `Dev-Memory/QUALITY-GATE.md was generated ${new Date(generatedAt).toISOString()} but Dev-Memory/evidence/ holds a measurement from ${new Date(newest).toISOString()} — the table is STALE and does not render the latest results. Re-run \`node hooks/dod.mjs .\`.`,
        );
      }

      // Every row this gate accepted must have a measurement claiming it. This is the check that
      // makes an added row useless: a hand-inserted "| Accessibility | pass | n/a |" beneath a
      // genuinely generated table has no evidence file naming that row, and is named here.
      for (const r of rows) {
        const item = (r.item || '').trim();
        if (item === '') continue;
        if (!measured.has(item)) {
          problems.push(
            `the row "${item}" has no measurement behind it — no file in Dev-Memory/evidence/ records producing it. Either it was added to the table by hand after generation, or the table is left over from a different configuration. Re-run \`node hooks/dod.mjs .\` so every row comes from something that ran.`,
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
