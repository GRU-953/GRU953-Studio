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
import {
  splitPipeCells,
  isDirectory,
  // 2026-08-15: checkIndex reads through the shared reader now, not its own line walk.
  parseTables,
  deEmphasise,
  SEPARATOR_ROW_RE,
  PLACEHOLDER_RE,
  readOrBlock,
  MISSING,
} from './lib.mjs';

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

// 2026-07-29 maintenance fix (audit finding 4): SEPARATOR_ROW_RE and
// PLACEHOLDER_RE used to be this file's own local copies (one of three
// identical PLACEHOLDER_RE copies, alongside quality-gate.mjs and
// traceability-check.mjs) — now imported from lib.mjs so all six/three
// respectively cannot drift apart again (see lib.mjs's own comment on both).
//
// A cell that names a real filesystem path: has a dotted extension or a slash.
// The filename stem uses `[^/\s]` rather than the ASCII-only `\w`, found
// 2026-07-19: a bare non-ASCII/Bangla filename with no slash (e.g. "নথি.md")
// previously failed this heuristic and was silently skipped from the
// stale-file check even when the target genuinely didn't exist.
// 2026-08-15, finding X147 / memory-integrity D10 (reproduced). The stem was `[^/\s]+` — no
// whitespace — so an index entry reading `Project Plan.md` was not recognised as a path and
// its existence was never checked. Filenames with spaces are entirely ordinary, especially in
// a memory folder a person writes by hand.
//
// The obvious widening is dangerous: simply allowing spaces makes ordinary prose look like a
// filename. `in section 4.2`, `version 1.2`, `about 3.5 hours` and `it costs 4.99` all become
// "paths", and every one would then be reported as a file that does not exist — a false alarm
// on a healthy index, which is worse than the gap being fixed.
//
// The discriminator, measured across twelve realistic cells BEFORE this was written: a file
// extension begins with a LETTER. `.md`, `.json`, `.txt` do; `.2`, `.5`, `.99` do not. That
// one constraint separated every case correctly. The prose cells are held as controls in
// hooks/test/repro/X147-path-with-space.mjs, so a future widening cannot quietly reintroduce
// them, and so is the non-ASCII case the 2026-07-19 fix added.
const LOOKS_LIKE_PATH_RE = /(^|\/)[^/]+\.[A-Za-z][A-Za-z0-9]{0,5}$|\//;
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
// 2026-08-13, finding X12 (reproduced by execution — see
// test/repro/phase1-gate-honesty.mjs cases P6 and P7). This returned null for
// BOTH "the file isn't there" and "the file is there but I couldn't read it",
// and all three callers treat null as "nothing to validate yet" and return
// silently. So an INDEX.md that was unreadable (chmod 000) or replaced by a
// DIRECTORY produced `{"status":"clean","reason":"recall index and knowledge
// graph are internally consistent"}` — an affirmative claim about a file this
// gate had not read a single byte of.
//
// content-check.mjs found and fixed this exact defect class in July and stated
// the principle: "A gate that cannot read its input must never claim its input
// is fine." The fix was never propagated here. It now uses the shared
// readOrBlock() from lib.mjs, so ENOENT (genuinely absent) still stands down and
// every other error throws — caught at the entry point below and reported as a
// block, never as a pass.
function read(p) {
  const t = readOrBlock(p);
  return t === MISSING ? null : t;
}

// --- INDEX.md: every path-shaped "where" cell resolves to a real file --------
function checkIndex(root, devMemory, problems) {
  const file = path.join(devMemory, 'INDEX.md');
  const text = read(file);
  if (text === null) return; // no structured index yet — nothing to validate
  // 2026-08-15, finding X141 / memory-integrity D9 (High, reproduced). This function used to
  // walk lines itself and enter table mode only on a line beginning with a pipe:
  //
  //     if (!/^\s*\|/.test(line)) { inTable = false; whereCol = -1; continue; }
  //
  // Outer pipes are OPTIONAL in GitHub-flavoured markdown — `What | Where` renders exactly
  // as `| What | Where |` does — so an ordinary index written the second way was recognised
  // in no respect at all, every row skipped, and the gate reported the index "internally
  // consistent" while its entries pointed at files that do not exist. That is this gate's
  // entire job.
  //
  // This was the THIRD private table parser found in one sweep, and the third with a fault
  // the shared reader does not have. So the fix is a deletion: lib.mjs's parseTables() has
  // recognised pipe-less tables since it was written, it is fence-aware as of today, and
  // traceability-check was moved onto it this morning for the same reason.
  //
  // The per-table "no recognisable Where column" report is preserved exactly — a 2026-07-29
  // fix made that a problem rather than a silent skip, and control E of the reproduction
  // exists so this move cannot quietly undo it.
  //
  // Reproduction: hooks/test/repro/X141-index-pipeless-table.mjs.
  for (const table of parseTables(text)) {
    const whereCol = table.headerCells.findIndex((c) =>
      /^(file|path|where|location)$/i.test(deEmphasise(c)),
    );
    if (whereCol === -1) {
      // 2026-07-29 maintenance fix: this used to `continue` silently, so a
      // table whose header wasn't recognised (e.g. a genuine file/path/
      // where/location column under a synonym or a typo) was treated as
      // clean — the whole point of this check is to catch a stale INDEX.md
      // reference, and an unrecognised header is exactly the case where that
      // can't be verified at all. Recorded as a problem instead, matching
      // this file's own pattern of pushing to `problems` rather than
      // silently passing.
      //
      // 2026-07-29 maintenance fix (audit finding 2): that push used to run
      // once per DATA ROW in the table (this branch is inside the per-row
      // loop), so an unrecognised header emitted one identical sentence per
      // row instead of once per table. `unrecognisedHeaderReported` reports
      // it only the first time for this table.
      // The 2026-07-29 de-duplication flag is gone with the private walk: this branch now
      // runs once per TABLE by construction, which is what that flag was emulating.
      problems.push(
        'INDEX.md has a table with no recognisable file/path/where/location header column — its rows cannot be checked for stale references.',
      );
      continue;
    }
    // 2026-07-29 maintenance fix (round 3, F1): the backtick strip alone
    // leaves surrounding emphasis in place — a bolded existing path like
    // "**src/real.js**" still had the leading "**" glued to the filename
    // stem, so it was wrongly reported as dangling, and a bolded path with
    // no closing "**" right after the extension (e.g. "**readme.md**")
    // failed LOOKS_LIKE_PATH_RE outright (needs the extension to end the
    // string) and silently skipped the check entirely. deEmphasise() strips
    // the emphasis the same way this file's own header-cell fix already does.
    for (const row of table.rows) {
      let where = deEmphasise((row.cells[whereCol] || '').replace(/^`|`$/g, '')).trim();
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
  // 2026-08-15, finding X140 / memory-integrity D2 (High, reproduced). Both passes over this
  // file scoped themselves with a LEVEL-AGNOSTIC match that reassigned the flag on every
  // heading:
  //
  //     if (heading) { inNodes = /node/i.test(heading[1]); continue; }
  //
  // So a `### Phase 2` sub-heading INSIDE a correct `## Nodes` or `## Links` section switched
  // checking off for the rest of the file — after the gate had already parsed and resolved
  // real entries in that very section, so it demonstrably believed it had read the file.
  // Nothing about the input looks wrong: the documented parent heading is present, and
  // grouping a growing list by phase is ordinary maintenance on a file this plugin tells
  // projects to keep growing.
  //
  // sectionScope() applies markdown's own nesting rule instead: a section ends at the next
  // heading of the SAME or SHALLOWER level, and a deeper heading is a sub-heading that
  // belongs to the section it sits inside. Reproduction:
  // hooks/test/repro/X140-section-scope.mjs, whose control E proves a SIBLING heading still
  // ends the section — otherwise this would trade a silent skip for a false alarm, with
  // prose under a later heading parsed as data.
  const sectionScope = (opensRe) => {
    let open = false;
    let level = 0;
    return (line) => {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (!heading) return { isHeading: false, open };
      const depth = heading[1].length;
      if (opensRe.test(heading[2])) {
        open = true;
        level = depth;
      } else if (open && depth <= level) {
        open = false; // a sibling or shallower heading genuinely ends the section
      }
      return { isHeading: true, open };
    };
  };

  const nodeTypeVocabulary = loadNodeTypeVocabulary();
  const nodeScope = sectionScope(/node/i);
  let inNodes = false;
  for (const line of lines) {
    const s = nodeScope(line);
    inNodes = s.open;
    if (s.isHeading) continue;
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
  // 2026-08-15, finding X145 / memory-integrity D3 (reproduced). This required a BULLET
  // marker, so a link written as an ordinary numbered list item — `1. T1 depends-on R99` — or
  // as a table row — `| T1 | depends-on | R99 |` — matched nothing, was never validated, and a
  // reference to a node that does not exist passed as "internally consistent". Both render
  // identically to a reader; neither is exotic.
  //
  // Widening the marker is safe ONLY because of the 2026-07-21 fix directly above: the type
  // token is constrained to the documented vocabulary. Before that, this pattern accepted any
  // lowercase word and a prose bullet ("All links use verbs like implements and blocks") was
  // parsed as a link with its words reported as undefined nodes. Prose does not carry a
  // vocabulary word in exactly the second position, which is what keeps it out — control D of
  // the reproduction holds that same sentence, numbered, so the protection is proven rather
  // than assumed.
  //
  // The three accepted forms are: a bullet (`-` or `*`), a numbered item (`1.` or `1)`), and a
  // table row, whose leading pipe and cell separators are treated as the marker and the gaps.
  const linkVocabulary = loadLinkVocabulary().join('|');
  const LINK_RE = new RegExp(
    `^\\s*(?:[-*]|\\d+[.)])\\s+(\\S+)\\s+(${linkVocabulary})\\s+(\\S+)`,
    'i',
  );
  // A table row states the same triple with pipes instead of spaces.
  const LINK_TABLE_RE = new RegExp(
    `^\\s*\\|\\s*([^|]+?)\\s*\\|\\s*(${linkVocabulary})\\s*\\|\\s*([^|]+?)\\s*\\|`,
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
  // 2026-08-15, finding X140 / memory-integrity D1 (Medium, reproduced). The links section
  // was recognised only by the words "link" or "edge", so a list under `## Relationships` —
  // the word the design's own prose uses, "their relationships as typed links" — was never
  // checked at all, and a dangling reference beneath it passed as clean.
  //
  // The widening is ADDITIVE ONLY. No heading recognised today stops being recognised,
  // because a narrowing change would turn files that ARE checked into files that are not —
  // the very defect being fixed. In particular the existing quirk that "Knowledge" contains
  // "edge", so `## Knowledge graph` enables link parsing, is deliberately left alone:
  // tightening it with word boundaries would be a regression in the direction that matters.
  const linkScope = sectionScope(/link|edge|relationship|relation|connection/i);
  for (const line of lines) {
    const s = linkScope(line);
    inLinks = s.open;
    if (s.isHeading) continue;
    if (!inLinks) continue;
    const m = line.match(LINK_RE) || line.match(LINK_TABLE_RE);
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
        reason: 'a memory file exists but could not be read, so it cannot be verified',
        detail: e && e.message ? e.message : String(e),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
