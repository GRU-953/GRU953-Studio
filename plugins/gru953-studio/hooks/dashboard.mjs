#!/usr/bin/env node
//
// dashboard.mjs — renders a self-contained HTML command-centre dashboard for a
// project from its Dev-Memory. Zero dependencies (Node stdlib only).
//
// Added 2026-07-19 (Phase 1 — the command centre, see the `command-centre`
// skill). 2026-07-19 enhancement: the dashboard is not just a task board — it
// is the organised command centre, surfacing the software's CONCEPT
// (OBJECTIVE.md), its ARCHITECTURE & specifications (ARCHITECTURE.md) and its
// complete BUILD PLAN (PLAN.md, phases and all), alongside the live task board.
//
// It is a read-only view of the same source of truth; generating it changes no
// project state. A deterministic generator (rather than free-hand HTML each
// time) guarantees the two hard requirements: the output is fully
// SELF-CONTAINED (all CSS inline, no network calls, no fonts/scripts fetched —
// it renders offline and cannot leak a request anywhere) and every piece of
// project text is HTML-escaped so it can never break the markup or inject
// script. The core view works with no JavaScript at all.
//
// Output goes under Dev-Memory/ (private, .gitignore'd, never shipped).
//
// Usage: node dashboard.mjs [projectRoot] [outFile]
//   projectRoot defaults to cwd; outFile defaults to
//   <projectRoot>/Dev-Memory/dashboard.html
// Exit 0 = written (or no-op on a tree with no Dev-Memory). Exit 1 = a real
//   studio project whose PROGRESS.md could not be read.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { splitPipeCells } from './lib.mjs';

const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Status groups in the order a person cares about them, each with a stable CSS
// class. Anything not recognised falls into "other" so it is shown, never
// silently dropped. Includes the command-centre control states.
const GROUPS = [
  { key: 'doing', label: 'Doing now', match: /^doing\b/i },
  { key: 'blocked', label: 'Blocked', match: /^blocked\b/i },
  { key: 'scheduled', label: 'Scheduled', match: /^scheduled\b/i },
  { key: 'paused', label: 'Paused', match: /^paused\b/i },
  { key: 'todo', label: 'To do', match: /^todo\b/i },
  { key: 'skipped', label: 'Skipped', match: /^skipped\b/i },
  { key: 'done', label: 'Done', match: /^done\b/i },
];

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function groupOf(status) {
  const g = GROUPS.find((x) => x.match.test(status || ''));
  return g ? g.key : 'other';
}

// --- a small, SAFE markdown renderer for the Concept/Architecture/Plan docs ---
// Handles the block shapes these Dev-Memory files actually use — headings,
// tables, bullet/numbered lists, paragraphs, and inline `code`. EVERYTHING is
// HTML-escaped; a code span never emits raw markup. Not a general markdown
// engine (YAGNI) — just enough to render the studio's own structured files in
// an organised, readable way without ever trusting their text as HTML.
function inlineMd(s) {
  return String(s).split(/(`[^`]+`)/g).map((p) => {
    if (p.length >= 2 && p.startsWith('`') && p.endsWith('`')) return `<code>${esc(p.slice(1, -1))}</code>`;
    return esc(p);
  }).join('');
}
function tableCells(row) {
  const cells = splitPipeCells(row);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}
function mdToHtml(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let listType = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#{1,6}\s+/.test(line)) {
      closeList();
      const level = line.match(/^\s*(#{1,6})/)[1].length;
      const tag = level <= 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      out.push(`<${tag}>${inlineMd(line.replace(/^\s*#{1,6}\s+/, ''))}</${tag}>`);
    } else if (/^\s*\|/.test(line)) {
      closeList();
      const block = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { block.push(lines[i]); i++; }
      i--;
      const rows = block.filter((r) => !SEPARATOR_ROW_RE.test(r));
      if (rows.length) {
        out.push('<table><thead><tr>' + tableCells(rows[0]).map((h) => `<th scope="col">${inlineMd(h)}</th>`).join('') + '</tr></thead><tbody>');
        for (const r of rows.slice(1)) out.push('<tr>' + tableCells(r).map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
        out.push('</tbody></table>');
      }
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inlineMd(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
    } else if (/^\s*$/.test(line)) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

// A collapsible document section (works with no JavaScript via <details>).
function docSection(title, text, open) {
  if (text === null) return '';
  return `<details class="doc"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="doc-body">${mdToHtml(text)}</div></details>`;
}

// Parse the first markdown table found in the text into {headers, rows}.
function parseFirstTable(text) {
  const lines = text.split(/\r?\n/);
  let headers = null;
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) { if (headers) break; inTable = false; continue; }
    const cells = tableCells(line);
    if (!inTable) { inTable = true; headers = cells; continue; }
    if (SEPARATOR_ROW_RE.test(line)) continue;
    rows.push(cells);
  }
  return headers ? { headers, rows } : { headers: [], rows: [] };
}

function renderBoard(projectName, docs, table, boardText) {
  const statusIdx = table.headers.findIndex((h) => /^status$/i.test(h));
  const counts = {};
  for (const g of GROUPS) counts[g.key] = 0;
  counts.other = 0;
  for (const r of table.rows) counts[groupOf(statusIdx === -1 ? '' : r[statusIdx])]++;
  const total = table.rows.length;

  const summary = GROUPS.filter((g) => counts[g.key] > 0)
    .map((g) => `<li class="pill ${g.key}"><span class="n">${counts[g.key]}</span> ${esc(g.label)}</li>`)
    .join('');

  const headCells = table.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
  const bodyRows = table.rows.map((r) => {
    const cls = groupOf(statusIdx === -1 ? '' : r[statusIdx]);
    const cells = table.headers.map((_, i) => `<td>${esc(r[i] || '')}</td>`).join('');
    return `<tr class="row-${cls}">${cells}</tr>`;
  }).join('\n');

  const board = boardText ? `<section class="board"><h2>Status board</h2><pre>${esc(boardText)}</pre></section>` : '';
  const tableSection = total
    ? `<table><caption>All tasks (${total})</caption><thead><tr>${headCells}</tr></thead><tbody>\n${bodyRows}\n</tbody></table>`
    : `<p class="empty">No tasks are recorded yet.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(projectName)} — GRU953-Studio command centre</title>
<style>
  :root{--bg:#f7f8fa;--card:#fff;--ink:#1b1f24;--muted:#5a6472;--line:#e3e7ec;--accent:#2f6fed;
    /* 2026-07-21 audit fix: status colours darkened so the bold .pill .n numbers
       (14.4px) clear WCAG 2.2 AA (>=4.5:1) as text on the white card. */
    --doing:#2f6fed;--blocked:#c0392b;--scheduled:#6f42c1;--paused:#8a6100;
    --todo:#5a6472;--skipped:#8a94a6;--done:#147a51;--other:#5a6472;}
  @media (prefers-color-scheme:dark){:root{--bg:#12151a;--card:#1b1f26;--ink:#e8ecf1;--muted:#9aa4b2;--line:#2a303a;
    /* 2026-07-21 audit fix: the dark block previously did NOT override the status
       colours, so the light values failed AA on the dark card. Lightened here. */
    --doing:#8ab4ff;--blocked:#f28b82;--scheduled:#c4a6ff;--paused:#f3bd5c;--done:#79d68f;}}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  main{max-width:960px;margin:0 auto;padding:24px}
  h1{font-size:1.4rem;margin:0 0 4px}
  .sub{color:var(--muted);margin:0 0 20px}
  ul.summary{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0 0 24px}
  .pill{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:.9rem;color:var(--muted)}
  .pill .n{font-weight:700;color:var(--ink)}
  .pill.doing .n{color:var(--doing)}.pill.blocked .n{color:var(--blocked)}
  .pill.scheduled .n{color:var(--scheduled)}.pill.paused .n{color:var(--paused)}
  .pill.done .n{color:var(--done)}
  details.doc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 16px;margin:0 0 16px}
  details.doc>summary{cursor:pointer;font-weight:600;padding:8px 0;font-size:1.05rem}
  .doc-body{padding:4px 0 8px}
  .doc-body h3{font-size:1.05rem;margin:16px 0 6px}
  .doc-body h4{font-size:.95rem;margin:14px 0 6px;color:var(--muted)}
  .doc-body h5{font-size:.9rem;margin:12px 0 4px;color:var(--muted)}
  .doc-body code{background:rgba(127,127,127,.15);padding:1px 5px;border-radius:5px;font-size:.9em}
  .doc-body table{width:100%;border-collapse:collapse;margin:8px 0;font-size:.92rem}
  .doc-body th,.doc-body td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
  .doc-body th{color:var(--muted);font-weight:600}
  section.board{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 24px}
  section.board h2,h2.tasks{margin:0 0 8px;font-size:1rem}
  section.board pre{margin:0;white-space:pre-wrap;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  caption{text-align:left;color:var(--muted);padding:12px 12px 0;font-size:.9rem}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
  tbody tr{border-left:4px solid var(--other)}
  .row-doing{border-left-color:var(--doing)}.row-blocked{border-left-color:var(--blocked)}
  .row-scheduled{border-left-color:var(--scheduled)}.row-paused{border-left-color:var(--paused)}
  .row-todo{border-left-color:var(--todo)}.row-skipped{border-left-color:var(--skipped)}
  .row-done{border-left-color:var(--done)}
  .empty{color:var(--muted)}
  footer{color:var(--muted);font-size:.85rem;margin-top:24px}
</style>
</head>
<body>
<main>
  <h1>${esc(projectName)}</h1>
  <p class="sub">GRU953-Studio command centre — concept, architecture, build plan and live task board, in one place. Read-only; changes nothing.</p>
  ${docSection('Concept', docs.objective, true)}
  ${docSection('Architecture & specifications', docs.architecture, false)}
  ${docSection('Build plan', docs.plan, true)}
  ${docSection('Content', docs.content, false)}
  <h2 class="tasks">Task board</h2>
  <ul class="summary">${summary || '<li class="pill">No tasks yet</li>'}</ul>
  ${board}
  ${tableSection}
  <footer>Generated from <code>Dev-Memory/</code>. Self-contained and private; it makes no network requests and changes nothing.</footer>
</main>
</body>
</html>
`;
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  if (!fs.existsSync(devMemory) || !fs.statSync(devMemory).isDirectory()) {
    console.log(JSON.stringify({ status: 'not a studio project', reason: 'no Dev-Memory/ directory — nothing to render', root }));
    process.exit(0);
  }
  const progText = read(path.join(devMemory, 'PROGRESS.md'));
  if (progText === null) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'Dev-Memory/ exists but PROGRESS.md is unreadable — nothing to render', root }, null, 2));
    process.exit(1);
  }
  const docs = {
    objective: read(path.join(devMemory, 'OBJECTIVE.md')),
    architecture: read(path.join(devMemory, 'ARCHITECTURE.md')),
    plan: read(path.join(devMemory, 'PLAN.md')),
    content: read(path.join(devMemory, 'CONTENT.md')),
  };
  const nameMatch = (docs.objective || '').match(/^#\s+(.+)$/m);
  const projectName = (nameMatch ? nameMatch[1] : 'Your project').trim();
  const board = read(path.join(devMemory, 'STATUS-BOARD.md'));
  const table = parseFirstTable(progText);
  const html = renderBoard(projectName, docs, table, board);
  const outFile = process.argv[3] || path.join(devMemory, 'dashboard.html');
  fs.writeFileSync(outFile, html);
  console.log(JSON.stringify({ status: 'written', file: outFile, tasks: table.rows.length, sections: Object.keys(docs).filter((k) => docs[k] !== null) }, null, 2));
  process.exit(0);
}

main();
