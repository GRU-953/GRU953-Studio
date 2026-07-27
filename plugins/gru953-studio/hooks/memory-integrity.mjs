#!/usr/bin/env node
//
// memory-integrity.mjs — keeps a project's recall memory trustworthy: the
// structured INDEX.md must not point at files that no longer exist, the
// GRAPH.md knowledge graph must have no dangling links, and FOCUS.md (when
// present) conforms to FOCUS.schema.json. Zero dependencies (Node stdlib
// only).
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
//          consistent. Exit 1 = a stale index path, a dangling graph link,
//          an invalid GRAPH.md node type, or a FOCUS.md that does not
//          conform to FOCUS.schema.json.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { splitPipeCells, stripBom, isDirectory } from './lib.mjs';

// 2026-07-26 audit finding 7. GRAPH.schema.json and this file's own link
// vocabulary used to be two hand-maintained copies of the same list, and had
// already drifted: the schema declared traces-to/tests/decided-in/lesson-from
// while every documented example (skills/memory-graph/SKILL.md) and this
// file's own LINK_RE used implements/depends-on/relates-to/supersedes/
// caused-by/blocks. The decision recorded in AUDIT-2026-07.md §6: the
// documentation wins, because that is what every existing project was told
// to follow — so the schema is corrected to match it, and this file now
// reads the vocabulary from the schema at run time instead of hard-coding a
// second copy, so the two structurally cannot drift apart again. If the
// schema is ever unreadable, this falls back to the documented vocabulary
// rather than silently accepting every word (a missing schema must never
// widen what counts as a valid link).
const GRAPH_SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'dev-memory',
  'schemas',
  'GRAPH.schema.json',
);
const DOCUMENTED_LINK_VOCABULARY = [
  'implements',
  'depends-on',
  'relates-to',
  'supersedes',
  'caused-by',
  'blocks',
];
function loadLinkVocabulary() {
  try {
    const schema = JSON.parse(fs.readFileSync(GRAPH_SCHEMA_PATH, 'utf8'));
    const relationEnum = schema.items.properties.links.items.properties.relation.enum;
    if (Array.isArray(relationEnum) && relationEnum.length > 0) return relationEnum;
  } catch {
    /* fall through to the documented vocabulary below */
  }
  return DOCUMENTED_LINK_VOCABULARY;
}

// 2026-07-27 R1 Phase 1.3 (audit: the schema's `relation` enum was already
// validated at run time, but its sibling `type` enum — the node KIND
// (requirement/task/decision/file/lesson/entity) — was read by nothing at
// all. A node line declaring an unrecognised kind, e.g. "- [T1] tsak: ..."
// (a typo) or "- [T1] milestone: ..." (a kind memory-graph/SKILL.md never
// documented), was silently accepted: the id was registered and any link
// referencing it resolved cleanly, with no signal anywhere that the KIND
// itself was wrong. Mirrors loadLinkVocabulary()'s exact pattern — read the
// schema at run time, fall back to the documented vocabulary if the schema
// is unreadable, so a missing schema can never silently widen what counts as
// a valid node type.
const DOCUMENTED_NODE_TYPE_VOCABULARY = [
  'requirement',
  'task',
  'decision',
  'file',
  'lesson',
  'entity',
];
function loadNodeTypeVocabulary() {
  try {
    const schema = JSON.parse(fs.readFileSync(GRAPH_SCHEMA_PATH, 'utf8'));
    const typeEnum = schema.items.properties.type.enum;
    if (Array.isArray(typeEnum) && typeEnum.length > 0) return typeEnum;
  } catch {
    /* fall through to the documented vocabulary below */
  }
  return DOCUMENTED_NODE_TYPE_VOCABULARY;
}

// 2026-07-27 R1 Phase 1.3 (audit finding: FOCUS.schema.json existed with no
// format documented anywhere for a real FOCUS.md to follow, and no check
// anywhere read it — 0 test references despite owning a committed schema).
// focus-guard/SKILL.md now documents the literal on-disk shape (four
// bold-labelled lines); this reads the same schema at run time for the
// activePhase enum, mirroring loadLinkVocabulary()/loadNodeTypeVocabulary()
// exactly, so all three controlled vocabularies in this file share one
// pattern and cannot drift from their schema independently of each other.
const FOCUS_SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'dev-memory',
  'schemas',
  'FOCUS.schema.json',
);
const DOCUMENTED_PHASE_VOCABULARY = [
  'Brainstorm',
  'Ideate',
  'Design',
  'Prototype',
  'Content',
  'Plan',
  'Build',
  'Test',
  'Fix',
  'Review',
  'Publish',
  'Maintain',
];
function loadPhaseVocabulary() {
  try {
    const schema = JSON.parse(fs.readFileSync(FOCUS_SCHEMA_PATH, 'utf8'));
    const phaseEnum = schema.properties.activePhase.enum;
    if (Array.isArray(phaseEnum) && phaseEnum.length > 0) return phaseEnum;
  } catch {
    /* fall through to the documented vocabulary below */
  }
  return DOCUMENTED_PHASE_VOCABULARY;
}

// --- FOCUS.md: the four required fields are present and activePhase is valid --
// Format (see focus-guard/SKILL.md): four bold-labelled lines, e.g.
//   **Objective:** Ship a working MVP that lets users book a table online.
//   **Active phase:** Build
//   **Active task:** T4 — wire the booking form to the availability API
//   **Top constraints:** Tier: Standard; no new dependency without approval
// A tiny anchor file with no format checker at all is worse than one with a
// lenient one: a typo'd phase name or a silently-dropped field would never
// be noticed until a human happened to read the file directly.
const FOCUS_FIELD_RE =
  /^\s*\*\*(Objective|Active phase|Active task|Top constraints)\s*:\*\*\s*(.*)$/gim;
function checkFocus(devMemory, problems) {
  const file = path.join(devMemory, 'FOCUS.md');
  const text = read(file);
  if (text === null) return; // no FOCUS.md yet — nothing to validate
  const fields = {};
  let m;
  FOCUS_FIELD_RE.lastIndex = 0;
  while ((m = FOCUS_FIELD_RE.exec(text))) {
    fields[m[1].toLowerCase().replace(/\s+/g, '')] = m[2].trim();
  }
  if (!fields.objective) {
    problems.push('FOCUS.md is missing its "**Objective:**" line, or it is empty.');
  }
  if (!fields.activetask) {
    problems.push('FOCUS.md is missing its "**Active task:**" line, or it is empty.');
  }
  if (!fields.topconstraints) {
    problems.push('FOCUS.md is missing its "**Top constraints:**" line, or it is empty.');
  }
  if (!fields.activephase) {
    problems.push('FOCUS.md is missing its "**Active phase:**" line, or it is empty.');
  } else {
    const vocabulary = loadPhaseVocabulary();
    if (!vocabulary.includes(fields.activephase)) {
      problems.push(
        `FOCUS.md's Active phase "${fields.activephase}" is not one of the documented lifecycle phases (${vocabulary.join('/')}).`,
      );
    }
  }
}

const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
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

// 2026-07-26 audit finding 26. A leading UTF-8 byte-order mark (three
// invisible bytes some Windows editors write at the start of a file) breaks
// every `^`-anchored match against the very first line — here, that's the
// heading detector this file uses to scope node definitions to `## Nodes`
// (see the 2026-07-26 node-scoping fix above). Reproduced: a GRAPH.md whose
// FIRST line is a BOM immediately followed by `## Nodes` failed to recognise
// that heading at all, so a node genuinely defined there was reported as
// undefined — a false BLOCK on legitimate data, caused by this file's own
// fix above interacting badly with an unstripped BOM.
function read(p) {
  try {
    return stripBom(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
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
    if (!/^\s*\|/.test(line)) {
      inTable = false;
      whereCol = -1;
      continue;
    }
    const cells = splitPipeCells(line).map((c) => c.trim());
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
    const candidates = [path.resolve(root, where), path.resolve(devMemory, where)];
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
  // Captures the id in group 1 as before, plus — when the node line follows
  // the documented "- [id] type: label" shape — the type word in group 2, so
  // it can be checked against the schema's enum below. A node line with no
  // recognisable "type:" segment (an id-only bracket, or a malformed line)
  // leaves group 2 undefined and is left exactly as tolerant as before —
  // this fix only judges a type word that IS present, never invents one.
  const NODE_DEF_RE = /^\s*[-*]?\s*\[([^\]]+)\]\s*(?:([A-Za-z][A-Za-z-]*)\s*:)?/;
  // 2026-07-26, found during a further pass over the hooks not touched by the
  // first audit. This loop used to scan EVERY line in the file with no heading
  // scoping — unlike the link-validation pass below, which correctly restricts
  // itself to a Links/Edges section. So an ordinary prose bullet anywhere else
  // in the file shaped like a node reference (e.g. a Notes section mentioning
  // "- [T1] was covered in an earlier session") silently registered T1 as a
  // DEFINED node, masking a genuinely dangling link to a T1 that was never
  // actually declared under ## Nodes. Reproduced: adding exactly that kind of
  // bullet under an unrelated heading turned a correctly-BLOCKED dangling-link
  // case into a false "clean". Scoped to a Nodes/Graph section the same way the
  // link pass is scoped, below.
  const nodeTypeVocabulary = loadNodeTypeVocabulary();
  let inNodes = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inNodes = /node/i.test(heading[1]);
      continue;
    }
    if (!inNodes) continue;
    const m = line.match(NODE_DEF_RE);
    if (m) {
      nodes.add(m[1]);
      if (m[2] && !nodeTypeVocabulary.includes(m[2].toLowerCase())) {
        problems.push(
          `GRAPH.md node "[${m[1]}]" declares type "${m[2]}", which is not one of the documented node kinds (${nodeTypeVocabulary.join('/')}).`,
        );
      }
    }
  }
  // Second pass: only inside a Links/Edges section, validate link rows.
  let inLinks = false;
  // 2026-07-21 audit fix: was end-anchored (`...(\S+)\s*$`), so ANY link row with
  // a fourth token — a trailing parenthetical note, a second target id, an extra
  // word — failed to match and was silently skipped, never checking its node
  // references (a false-clean, the worst direction for this gate). Now requires a
  // list-item marker (the documented GRAPH.md link shape) and validates the
  // leading `<src> <type> <dst>` triple regardless of any trailing text.
  // 2026-07-21 Round 2 fix: the type token is constrained to the exact documented
  // link vocabulary (memory-graph/SKILL.md), not "any lowercase word" — otherwise
  // a plain prose bullet under a ## Links heading whose second word is lowercase
  // ("- All links use verbs like implements and blocks") was parsed as a link and
  // its words flagged as undefined nodes (a spurious BLOCK the un-anchored form
  // introduced).
  const LINK_RE = new RegExp(
    `^\\s*[-*]\\s+(\\S+)\\s+(${loadLinkVocabulary().join('|')})\\s+(\\S+)`,
    'i',
  );
  // 2026-07-26 further-pass audit fix (false-block, confirmed by execution).
  // The id groups are `\S+` with no boundary after them, so a link line
  // written as an ordinary sentence — "- T1 implements R1." — captured the
  // destination as "R1." (trailing full stop included), which then never
  // matched a genuinely-defined "R1" node. Reproduced: a minimal, otherwise-
  // valid GRAPH.md with both T1 and R1 defined under `## Nodes` was reported
  // BLOCKED for referencing an "undefined" node "R1.". Node ids never
  // legitimately end in sentence punctuation, so trailing punctuation is
  // stripped from each captured id before checking it against `nodes`.
  const stripTrailingPunctuation = (s) => s.replace(/[.,;:!?)\]]+$/, '');
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inLinks = /link|edge/i.test(heading[1]);
      continue;
    }
    if (!inLinks) continue;
    const m = line.match(LINK_RE);
    if (!m) continue;
    const [, rawSrc, type, rawDst] = m;
    const src = stripTrailingPunctuation(rawSrc);
    const dst = stripTrailingPunctuation(rawDst);
    if (!nodes.has(src))
      problems.push(`GRAPH.md link "${src} ${type} ${dst}" references undefined node "${src}".`);
    if (!nodes.has(dst))
      problems.push(`GRAPH.md link "${src} ${type} ${dst}" references undefined node "${dst}".`);
  }
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  // 2026-07-26 Stage 3 fix (audit finding 22): was two separate, unguarded
  // calls racing against each other — see lib.mjs's isDirectory() for the
  // full reproduction (a crash instead of a plain message if Dev-Memory
  // disappears between the two calls).
  if (!isDirectory(devMemory)) {
    console.log(
      JSON.stringify({
        status: 'not a studio project',
        reason: 'no Dev-Memory/ directory — nothing to check',
        root,
      }),
    );
    process.exit(0);
  }
  const problems = [];
  checkIndex(root, devMemory, problems);
  checkGraph(devMemory, problems);
  checkFocus(devMemory, problems);
  if (problems.length === 0) {
    console.log(
      JSON.stringify(
        { status: 'clean', reason: 'recall index and knowledge graph are internally consistent' },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(
    JSON.stringify({ status: 'BLOCKED', reason: 'recall memory inconsistency', problems }, null, 2),
  );
  process.exit(1);
}

main();
