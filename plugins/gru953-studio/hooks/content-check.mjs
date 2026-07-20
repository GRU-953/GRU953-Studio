#!/usr/bin/env node
//
// content-check.mjs — proves the app's generated content is fit to ship: every
// asset recorded in Dev-Memory/CONTENT.md carries a recorded approval, its
// provenance (which model/prompt made it, or that a human supplied it), a plain
// rights/licence note, and — for media — alt-text or a caption. Zero
// dependencies (Node stdlib only).
//
// Added 2026-07-19 (Content Creation, see the `content-creation` and
// `gemini-integration` skills). AI-generated media that ships without recorded
// approval, provenance and rights is a real gold-standard and legal risk; this
// makes the manifest mechanical, like quality-gate.mjs does for the Definition
// of Done.
//
// Like verify-progress.mjs / quality-gate.mjs / traceability-check.mjs this is a
// maintainer/CI + pre-Publish check, NOT a PreToolUse runtime hook. It fails
// CLOSED on any recorded-but-incomplete asset. A project with no CONTENT.md has
// declared no content, so there is nothing to verify — clean no-op (content is
// optional; not every app has generated media).
//
// Usage: node content-check.mjs [projectRoot]
// Exit 0 = not a studio project / no content declared / every asset complete.
// Exit 1 = a recorded asset is missing approval, provenance, rights or alt-text.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const PLACEHOLDER_RE = /^(|[-—–]+|tbd|todo|none|n\/?a|\.\.\.|pending|placeholder)$/i;
const APPROVED_RE = /^\s*(approved|yes|pass(ed)?|ok|done|signed[ -]?off|human|final)\b/i;
// Found 2026-07-19: matching FOR media by English keyword silently skipped
// the alt-text/caption requirement for any non-English Medium value (e.g.
// Bangla "ছবি" for "image") — a real accessibility gap given this project's
// Bangla+English content. Inverted to fail closed: a row needs alt-text
// unless its Medium is explicitly, recognisably TEXT (in English or
// Bangla) — ambiguous or foreign-language values default to requiring it,
// never to silently skipping it.
const TEXT_ONLY_RE = /^(text\b|copy\b|microcopy\b|string\b|label\b|wording\b|ui[- ]?text\b|in-app[- ]?text\b|টেক্সট|লেখা|কপি)/i;

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function cells(line) {
  const c = line.split('|');
  if (c.length && c[0].trim() === '') c.shift();
  if (c.length && c[c.length - 1].trim() === '') c.pop();
  return c.map((x) => x.trim());
}
function ph(s) { return PLACEHOLDER_RE.test(String(s || '').trim()); }

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  if (!fs.existsSync(devMemory) || !fs.statSync(devMemory).isDirectory()) {
    console.log(JSON.stringify({ status: 'not a studio project', reason: 'no Dev-Memory/ directory — nothing to check', root }));
    process.exit(0);
  }
  const text = read(path.join(devMemory, 'CONTENT.md'));
  if (text === null) {
    // No content declared — a project may legitimately have none.
    console.log(JSON.stringify({ status: 'clean', reason: 'no CONTENT.md — no generated content declared for this project' }));
    process.exit(0);
  }

  // Parse the content table; locate its columns by header. `idx` is captured
  // once, for the content table (the one with an asset/medium column). After that
  // table ends, every later table is ignored (see the break below), so a second,
  // unrelated table's rows are never validated against the content table's columns.
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let idx = null;
  let contentTableCaptured = false;
  const rows = [];
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      // 2026-07-21 audit fix: once the content table has ended, ignore every LATER
      // table. Previously `idx` persisted and a subsequent unrelated table's rows
      // were validated against the content table's column map — a spurious BLOCK
      // (and, with two content-shaped tables, a possible mis-aligned false-clean).
      // Mirrors quality-gate.mjs's "stop after the first matching table" fix.
      if (contentTableCaptured) break;
      inTable = false;
      continue;
    }
    const c = cells(line);
    if (!inTable) {
      inTable = true;
      const find = (re) => c.findIndex((h) => re.test(h));
      const found = {
        asset: find(/^(asset|name|file|item)$/i),
        medium: find(/^(medium|type|kind)$/i),
        source: find(/^(source|provenance|model|origin|by)$/i),
        approved: find(/^(approved|approval|status|sign[- ]?off)$/i),
        rights: find(/^(rights|licen[cs]e|usage)$/i),
        alt: find(/^(alt|alt[- ]?text|caption|transcript|accessibility|a11y)$/i),
      };
      if (found.asset !== -1 || found.medium !== -1) { idx = found; contentTableCaptured = true; } // the content table's columns
      continue;
    }
    if (SEPARATOR_ROW_RE.test(line)) continue;
    if (!idx) continue; // no content table seen yet
    rows.push(c);
  }
  if (!idx) idx = { asset: -1, medium: -1, source: -1, approved: -1, rights: -1, alt: -1 };

  const problems = [];
  if (rows.length === 0) {
    // CONTENT.md exists but has no readable asset table — treat as incomplete.
    problems.push('CONTENT.md has no recognisable content table (need columns for asset, medium, source/provenance, approved, rights).');
  }
  for (const r of rows) {
    const name = (idx.asset !== -1 && r[idx.asset]) || (idx.medium !== -1 && r[idx.medium]) || 'asset';
    const medium = idx.medium !== -1 ? (r[idx.medium] || '') : '';
    const approved = idx.approved !== -1 ? (r[idx.approved] || '') : '';
    const source = idx.source !== -1 ? (r[idx.source] || '') : '';
    const rights = idx.rights !== -1 ? (r[idx.rights] || '') : '';
    const alt = idx.alt !== -1 ? (r[idx.alt] || '') : '';

    if (idx.approved === -1 || !APPROVED_RE.test(approved)) problems.push(`content "${name}": not approved (status "${approved || '(none)'}") — every shipped asset needs a recorded approval.`);
    if (idx.source === -1 || ph(source)) problems.push(`content "${name}": no provenance recorded — which model/prompt made it, or that a human supplied it.`);
    if (idx.rights === -1 || ph(rights)) problems.push(`content "${name}": no rights/licence note — AI-generated or sourced media needs a plain rights note.`);
    const isTextOnly = idx.medium !== -1 && TEXT_ONLY_RE.test(medium.trim());
    if (!isTextOnly && (idx.alt === -1 || ph(alt))) problems.push(`content "${name}": media asset has no alt-text/caption/transcript — required for accessibility.`);
  }

  if (problems.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'every recorded content asset has approval, provenance, rights and (for media) alt-text', assets: rows.length }, null, 2));
    process.exit(0);
  }
  console.log(JSON.stringify({ status: 'BLOCKED', reason: 'content manifest incomplete', problems }, null, 2));
  process.exit(1);
}

main();
