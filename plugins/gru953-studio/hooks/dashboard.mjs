#!/usr/bin/env node
//
// dashboard.mjs — renders a self-contained HTML command-centre dashboard from a
// project's Dev-Memory/PROGRESS.md. Zero dependencies (Node stdlib only).
//
// Added 2026-07-19 (Phase 1 — the command centre, see the `command-centre`
// skill). The dashboard is a read-only view of the same source of truth
// (`PROGRESS.md`); generating it changes no project state. A deterministic
// generator (rather than free-hand HTML each time) is what guarantees the two
// hard requirements: the output is fully SELF-CONTAINED (all CSS inline, no
// network calls, no fonts/scripts fetched — it renders offline and cannot leak
// a request anywhere) and every cell is HTML-escaped so task text can never
// break the markup or inject script. The core view is a plain table that works
// with no JavaScript at all.
//
// Output goes under Dev-Memory/ (private, .gitignore'd, never shipped — the
// same protection as the rest of Dev-Memory).
//
// Usage: node dashboard.mjs [projectRoot] [outFile]
//   projectRoot defaults to cwd; outFile defaults to
//   <projectRoot>/Dev-Memory/dashboard.html
// Exit 0 = written (or no-op on a tree with no Dev-Memory). Exit 1 = a real
//   studio project whose PROGRESS.md could not be read.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SEPARATOR_ROW_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

// Status groups in the order a person cares about them, each with a stable CSS
// class. Anything not recognised falls into "other" so it is shown, never
// silently dropped.
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

// Parse the first markdown table found in the text into {headers, rows}.
function parseFirstTable(text) {
  const lines = text.split(/\r?\n/);
  let headers = null;
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) { if (headers) break; inTable = false; continue; }
    const cells = line.split('|').map((c) => c.trim()).filter((_, i, arr) => !(i === 0 && arr[0] === '') && !(i === arr.length - 1 && arr[arr.length - 1] === ''));
    if (!inTable) { inTable = true; headers = cells; continue; }
    if (SEPARATOR_ROW_RE.test(line)) continue;
    rows.push(cells);
  }
  return headers ? { headers, rows } : { headers: [], rows: [] };
}

function render(projectName, table, boardText) {
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
  :root{--bg:#f7f8fa;--card:#fff;--ink:#1b1f24;--muted:#5a6472;--line:#e3e7ec;
    --doing:#2f6fed;--blocked:#d84a4a;--scheduled:#8a5cf6;--paused:#c98a00;
    --todo:#5a6472;--skipped:#8a94a6;--done:#1e9e6a;--other:#5a6472;}
  @media (prefers-color-scheme:dark){:root{--bg:#12151a;--card:#1b1f26;--ink:#e8ecf1;--muted:#9aa4b2;--line:#2a303a;}}
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
  section.board{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 24px}
  section.board h2{margin:0 0 8px;font-size:1rem}
  section.board pre{margin:0;white-space:pre-wrap;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  caption{text-align:left;color:var(--muted);padding:12px 12px 0;font-size:.9rem}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:.8rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
  tr:last-child td{border-bottom:0}
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
  <p class="sub">GRU953-Studio command centre — a read-only view of your task board.</p>
  <ul class="summary">${summary || '<li class="pill">No tasks yet</li>'}</ul>
  ${board}
  ${tableSection}
  <footer>Generated from <code>Dev-Memory/PROGRESS.md</code>. This page is self-contained and private; it makes no network requests and changes nothing.</footer>
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
  // Project name: first level-1 heading of OBJECTIVE.md, else a default.
  const objective = read(path.join(devMemory, 'OBJECTIVE.md')) || '';
  const nameMatch = objective.match(/^#\s+(.+)$/m);
  const projectName = (nameMatch ? nameMatch[1] : 'Your project').trim();
  const board = read(path.join(devMemory, 'STATUS-BOARD.md'));
  const table = parseFirstTable(progText);
  const html = render(projectName, table, board);
  const outFile = process.argv[3] || path.join(devMemory, 'dashboard.html');
  fs.writeFileSync(outFile, html);
  console.log(JSON.stringify({ status: 'written', file: outFile, tasks: table.rows.length }, null, 2));
  process.exit(0);
}

main();
