#!/usr/bin/env node
//
// memory-integrity.mjs — keeps a project's recall memory trustworthy: the
// structured INDEX.md must not point at files that no longer exist, and the
// GRAPH.md knowledge graph must have no dangling links. Zero dependencies
// (Node stdlib only).
//
// Added 2026-07-19 (Phase 1 — the indexed knowledge-graph memory, see the
// `memory-graph` skill). The whole point of the graph + index is token-cheap
// recall: a session reads the compact INDEX first and expands only the graph
// nodes it needs. That only works if the index and graph stay honest — a stale
// index row (pointing at a moved/deleted file) or a link to an undefined node
// quietly corrupts recall. This script catches both.
//
// Like verify-progress.mjs / quality-gate.mjs / traceability-check.mjs this is
// a maintainer/CI + pre-checkpoint check, NOT a PreToolUse runtime hook. Unlike
// the publish gates it is a CONSISTENCY check, not a fail-closed authorisation
// gate: it validates whatever of INDEX.md / GRAPH.md exists and no-ops on what
// doesn't (the graph legitimately grows over a project's life and is lightest
// on Tiny Tier), so a brand-new or Tiny project is never falsely blocked — but
// a genuine inconsistency in a file that DOES exist is reported and fails the
// check.
//
// Usage: node memory-integrity.mjs [projectRoot]
// Exit 0 = not a studio project, or every present file is internally
//          consistent. Exit 1 = a stale index path or a dangling graph link.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SEPARATOR_ROW_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const PLACEHOLDER_RE = /^(|[-—–]+|tbd|todo|none|n\/?a|\.\.\.|—)$/i;
// A cell that names a real filesystem path: has a dotted extension or a slash.
// The filename stem uses `[^/\s]` rather than the ASCII-only `\w`, found
// 2026-07-19: a bare non-ASCII/Bangla filename with no slash (e.g. "নথি.md")
// previously failed this heuristic and was silently skipped from the
// stale-file check even when the target genuinely didn't exist.
const LOOKS_LIKE_PATH_RE = /(^|\/)[^/\s]+\.[A-Za-z0-9]+$|\//;
// A markdown-link cell, `[Label](target)` — unwrapped to its target before
// the path/existence test below (found the same day: a cell written this
// way ends in ")", not the file extension, so it also fell through
// LOOKS_LIKE_PATH_RE and was silently skipped).
const MD_LINK_RE = /^\[([^\]]*)\]\(([^)]+)\)$/;

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// --- INDEX.md: every path-shaped "where" cell resolves to a real file --------
function checkIndex(root, devMemory, problems) {
  const file = path.join(devMemory, 'INDEX.md');
  const text = read(file);
  if (text === null) return; // no structured index yet — nothing to validate
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let whereCol = -1;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) { inTable = false; whereCol = -1; continue; }
    const cells = line.split('|').map((c) => c.trim());
    if (!inTable) {
      inTable = true;
      whereCol = cells.findIndex((c) => /^(file|path|where|location)$/i.test(c));
      continue;
    }
    if (SEPARATOR_ROW_RE.test(line)) continue;
    if (whereCol === -1) continue;
    let where = (cells[whereCol] || '').replace(/^`|`$/g, '').trim();
    const mdLink = where.match(MD_LINK_RE);
    if (mdLink) where = mdLink[2].trim();
    if (!where || PLACEHOLDER_RE.test(where) || !LOOKS_LIKE_PATH_RE.test(where)) continue;
    // Resolve relative to the project root; also accept a path already relative
    // to Dev-Memory/ (a bare filename recorded in the index).
    const candidates = [
      path.resolve(root, where),
      path.resolve(devMemory, where),
    ];
    if (!candidates.some((p) => fs.existsSync(p))) {
      problems.push(`INDEX.md points at "${where}", which does not exist — a stale recall entry.`);
    }
  }
}

// --- GRAPH.md: every link references a defined node --------------------------
// Format (see the memory-graph skill):
//   ## Nodes
//   - [T1] task: pause state machine {tags: command-centre}
//   ## Links
//   - T1 implements R1
// Node ids are the [bracketed] tokens on node lines; link lines are
// `<id> <type> <id>` under a Links/Edges heading.
function checkGraph(devMemory, problems) {
  const file = path.join(devMemory, 'GRAPH.md');
  const text = read(file);
  if (text === null) return; // no graph yet — nothing to validate
  const lines = text.split(/\r?\n/);
  const nodes = new Set();
  // First pass: collect every defined node id, anywhere a [id] appears at the
  // start of a list item (node-definition shape).
  // Node/link tokens use `\S+` rather than an ASCII allow-list, found
  // 2026-07-19: a node id containing punctuation (e.g. "T1.a") or
  // non-ASCII/Bangla text was not matched by the old pattern at all, so a
  // link referencing it was silently skipped from validation — a false
  // CLEAN on this script's whole job — even when the reference was
  // genuinely dangling.
  const NODE_DEF_RE = /^\s*[-*]?\s*\[([^\]]+)\]/;
  for (const line of lines) {
    const m = line.match(NODE_DEF_RE);
    if (m) nodes.add(m[1]);
  }
  // Second pass: only inside a Links/Edges section, validate link rows.
  let inLinks = false;
  // 2026-07-21 audit fix: was end-anchored (`...(\S+)\s*$`), so ANY link row with
  // a fourth token — a trailing parenthetical note, a second target id, an extra
  // word — failed to match and was silently skipped, never checking its node
  // references (a false-clean, the worst direction for this gate). Now requires a
  // list-item marker (the documented GRAPH.md link shape) and validates the
  // leading `<src> <type> <dst>` triple regardless of any trailing text.
  const LINK_RE = /^\s*[-*]\s+(\S+)\s+([a-z][a-z-]*)\s+(\S+)/;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { inLinks = /link|edge/i.test(heading[1]); continue; }
    if (!inLinks) continue;
    const m = line.match(LINK_RE);
    if (!m) continue;
    const [, src, type, dst] = m;
    if (!nodes.has(src)) problems.push(`GRAPH.md link "${src} ${type} ${dst}" references undefined node "${src}".`);
    if (!nodes.has(dst)) problems.push(`GRAPH.md link "${src} ${type} ${dst}" references undefined node "${dst}".`);
  }
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  if (!fs.existsSync(devMemory) || !fs.statSync(devMemory).isDirectory()) {
    console.log(JSON.stringify({ status: 'not a studio project', reason: 'no Dev-Memory/ directory — nothing to check', root }));
    process.exit(0);
  }
  const problems = [];
  checkIndex(root, devMemory, problems);
  checkGraph(devMemory, problems);
  if (problems.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'recall index and knowledge graph are internally consistent' }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'BLOCKED', reason: 'recall memory inconsistency', problems }, null, 2));
  process.exit(1);
}

main();
