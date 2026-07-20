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
import { splitPipeCells } from './lib.mjs';

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
  { key: 'security', match: /secur|secret|licen[cs]e|privac|vuln/i, label: 'security / licence / privacy clean' },
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
// An evidence cell that is really empty / a placeholder — treated as no evidence.
const PLACEHOLDER_RE = /^(|[-—–]+|tbd|todo|none|n\/?a|\.\.\.)$/i;
// A row that narrates it is currently broken/unproven invalidates any otherwise
// passing status on the same row — the same guard verify-progress.mjs uses, so
// "passed on the old build, now fails" can't count as done.
const CONTRADICTION_RE = /\b(exit[ \t]+[1-9]\d*|now[ \t]+fails?|currently[ \t]+(broken|failing)|has(?:n'?t| not)[ \t]+(?:yet[ \t]+)?been[ \t]+(?:re-?)?verified|not[ \t]+(?:yet[ \t]+)?verified|still[ \t]+fail(?:s|ing)?|regress(?:ed|ion))\b/i;
const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
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
function parseRows(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let idx = { item: -1, status: -1, evidence: -1 };
  let found = false;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      if (found) break; // the Definition-of-Done table's rows are done
      inTable = false;
      idx = { item: -1, status: -1, evidence: -1 };
      continue;
    }
    const cells = splitPipeCells(line).map((c) => c.trim());
    if (!inTable) {
      inTable = true;
      const find = (re) => cells.findIndex((c) => re.test(c));
      idx = {
        item: find(/^(item|check|dimension|requirement|criterion|gate)$/i),
        status: find(/^status$/i),
        evidence: find(/^(evidence|proof|notes?|verified|command)$/i),
      };
      if (idx.item !== -1 && idx.status !== -1) found = true;
      continue;
    }
    if (!found) continue; // not the Definition-of-Done table — ignore its rows
    if (SEPARATOR_ROW_RE.test(line)) continue;
    const item = cells[idx.item] || '';
    const status = cells[idx.status] || '';
    const evidence = idx.evidence === -1 ? '' : (cells[idx.evidence] || '');
    if (!item) continue;
    rows.push({ item, status, evidence, raw: line.trim() });
  }
  return rows;
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  // Not a studio project (e.g. the plugin repo itself, or any ordinary dir) →
  // there is nothing to gate. No-op green, exactly like verify-progress.mjs on
  // a tree with no PROGRESS.md.
  if (!fs.existsSync(devMemory) || !fs.statSync(devMemory).isDirectory()) {
    console.log(JSON.stringify({ status: 'not a studio project', reason: 'no Dev-Memory/ directory — nothing to gate', root }));
    process.exit(0);
  }
  const file = path.join(devMemory, 'QUALITY-GATE.md');
  const text = read(file);
  if (text === null) {
    // A real studio project asked to be gated but has no Definition-of-Done
    // record at all. Fail closed — this is precisely the "shipped below the bar
    // with nothing recorded" case the gate exists to stop.
    console.log(JSON.stringify({
      status: 'BLOCKED',
      reason: 'Dev-Memory/ exists but has no QUALITY-GATE.md — the Definition of Done has no record to verify. Create it (see the quality-gate skill) before a checkpoint commit or Publish.',
      file,
    }, null, 2));
    process.exit(1);
  }
  const rows = parseRows(text);
  const problems = [];
  if (rows.length === 0) {
    problems.push('QUALITY-GATE.md contains no Definition-of-Done table (need a table with at least "Item" and "Status" columns).');
  }
  for (const dim of REQUIRED) {
    const matches = rows.filter((r) => dim.match.test(r.item));
    if (matches.length === 0) {
      problems.push(`missing required dimension: ${dim.label} — no row in QUALITY-GATE.md covers it (mark it pass with evidence, or "n/a" with a reason, but it may not be absent).`);
      continue;
    }
    // A dimension is satisfied when at least one matching row is a clean pass
    // (or a reasoned N/A); but ANY row for that dimension that is explicitly
    // failing or self-contradicting still blocks — you cannot pass "tests" by
    // adding a second green row beside a red one. Blocking is driven purely by
    // problems pushed here, so a dimension with one clean pass and no other
    // rows records nothing and does not block.
    for (const r of matches) {
      if (CONTRADICTION_RE.test(r.raw)) {
        problems.push(`${dim.label}: a row is marked passing but its own text says it is currently failing/unverified → "${r.raw}"`);
        break;
      }
      if (PASS_RE.test(r.status)) {
        if (PLACEHOLDER_RE.test(r.evidence.trim())) {
          problems.push(`${dim.label}: marked "${r.status}" but carries no evidence — a pass needs a concrete proof/command/reference.`);
        }
      } else if (NA_RE.test(r.status)) {
        if (PLACEHOLDER_RE.test(r.evidence.trim())) {
          problems.push(`${dim.label}: marked not-applicable but gives no reason — "n/a" needs a stated reason (e.g. "no user interface").`);
        }
      } else {
        problems.push(`${dim.label}: status "${r.status || '(empty)'}" is not a pass — must be pass (with evidence) or n/a (with a reason).`);
      }
    }
  }
  if (problems.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'every required Definition-of-Done dimension passes or is consciously N/A with a reason', dimensions: REQUIRED.map((d) => d.key) }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'BLOCKED', reason: 'Definition of Done not met', problems }, null, 2));
  process.exit(1);
}

main();
