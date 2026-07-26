// status.js — a REAL status report for a GRU953-Studio project, read directly
// from its Dev-Memory files. Zero dependencies, matching the rest of this
// project. Self-contained on purpose: this package ships separately from the
// Claude Code plugin's own hooks/, so it cannot import that plugin's shared
// helpers — this is a small, independent copy of the same markdown-table
// parsing idea (not a reference to it).
//
// 2026-07-26 audit finding 17. This command used to print "Checking
// status..." and nothing else — a stub that never actually looked at
// anything. Nothing that ships here lies: this reads the project's real
// Dev-Memory files and reports what is actually there.

const fs = require('fs');
const path = require('path');

function isDirectory(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function readFile(p) {
    try {
        return fs.readFileSync(p, 'utf8');
    } catch {
        return null;
    }
}

// A small, self-contained pipe-table cell splitter (mirrors the Claude Code
// plugin's own hooks/lib.mjs splitPipeCells, kept separate on purpose — see
// the file header).
function splitPipeCells(line) {
    return line.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|'));
}

function cells(line) {
    const c = splitPipeCells(line).map((x) => x.trim());
    if (c.length && c[0] === '') c.shift();
    if (c.length && c[c.length - 1] === '') c.pop();
    return c;
}

const SEPARATOR_ROW_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function countTasksByStatus(progressText) {
    const lines = progressText.split(/\r?\n/);
    let inTable = false;
    let statusIdx = -1;
    const counts = {};
    let total = 0;
    for (const line of lines) {
        if (!/^\s*\|/.test(line)) {
            if (statusIdx !== -1) break; // the task table is over
            inTable = false;
            continue;
        }
        const c = cells(line);
        if (!inTable) {
            inTable = true;
            statusIdx = c.findIndex((h) => /^status$/i.test(h));
            continue;
        }
        if (SEPARATOR_ROW_RE.test(line)) continue;
        if (statusIdx === -1) continue;
        const status = (c[statusIdx] || '(none)').toLowerCase().trim() || '(none)';
        counts[status] = (counts[status] || 0) + 1;
        total += 1;
    }
    return { counts, total, hasStatusColumn: statusIdx !== -1 };
}

function printStatus(projectRoot = process.cwd()) {
    const devMemory = path.join(projectRoot, 'Dev-Memory');
    if (!isDirectory(devMemory)) {
        console.log('No GRU953-Studio project found here — no Dev-Memory/ folder in this directory.');
        return;
    }

    const files = ['OBJECTIVE.md', 'ARCHITECTURE.md', 'PLAN.md', 'PROGRESS.md', 'REQUIREMENTS.md', 'CONTENT.md'];
    const present = files.filter((f) => fs.existsSync(path.join(devMemory, f)));
    console.log(`GRU953-Studio project found (${present.length ? present.join(', ') : 'Dev-Memory/ is empty so far'}).`);

    const progressPath = path.join(devMemory, 'PROGRESS.md');
    if (!fs.existsSync(progressPath)) {
        console.log('No Dev-Memory/PROGRESS.md yet — no tasks recorded.');
        return;
    }
    const progressText = readFile(progressPath);
    if (progressText === null) {
        console.log('Dev-Memory/PROGRESS.md exists but could not be read.');
        return;
    }
    const { counts, total, hasStatusColumn } = countTasksByStatus(progressText);
    if (!hasStatusColumn || total === 0) {
        console.log('Dev-Memory/PROGRESS.md exists but no task table with a Status column was found.');
        return;
    }
    console.log(`Tasks: ${total} total`);
    for (const [status, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${status}: ${n}`);
    }
}

module.exports = { printStatus, countTasksByStatus, isDirectory };
