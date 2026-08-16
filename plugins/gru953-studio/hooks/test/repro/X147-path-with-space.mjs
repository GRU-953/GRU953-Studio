#!/usr/bin/env node
//
// Reproduction for memory-integrity D10 (adjudicated 2026-08-15) — an index entry whose file
// name contains a space is never checked for staleness.
//
// THE DEFECT. LOOKS_LIKE_PATH_RE decides whether a Where cell is worth resolving:
//
//     /(^|\/)[^/\s]+\.[A-Za-z0-9]+$|\//
//
// The stem is `[^/\s]+` — no whitespace — so `Project Plan.md` is not recognised as a path,
// and the existence check is skipped in silence. Filenames with spaces are entirely ordinary,
// especially in a memory folder written by a person.
//
// WHY THE OBVIOUS WIDENING IS DANGEROUS, AND WHAT WAS MEASURED INSTEAD.
// Simply allowing spaces in the stem makes ordinary prose look like a filename: `in section
// 4.2`, `version 1.2`, `about 3.5 hours`, `it costs 4.99` all become "paths", and every one
// would then be reported as a file that does not exist — a false alarm on a healthy index.
//
// The discriminator, measured across twelve realistic cells before the fix was written: a file
// EXTENSION begins with a letter. `.md`, `.json`, `.txt` do; `.2`, `.99`, `.5` do not. That
// one constraint separates every case correctly, and the prose cases below are held as
// controls so a future widening cannot quietly reintroduce them.
//
//   case                                                  required
//   A  a plain filename that is missing                    BLOCKED (control: it works)
//   B  a plain filename that exists                        clean   (control)
//   C  "Project Plan.md", missing                          BLOCKED <- D10
//   D  "Project Plan.md", present                          clean   (control: no false alarm)
//   E  prose: "in section 4.2", "version 1.2",
//      "about 3.5 hours", "it costs 4.99"                   clean   (control: prose is not a path)
//   F  a non-ASCII filename that is missing                 BLOCKED (control: the 2026-07-19 fix)
//
// Usage:
//   node X147-path-with-space.mjs                # asserts the FIXED state
//   node X147-path-with-space.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** An INDEX.md pointing at `where`; optionally create that file first. */
function verdict(where, createFile) {
  const dir = mkdtempSync(join(tmpdir(), 'x147-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    writeFileSync(
      join(dir, 'Dev-Memory', 'INDEX.md'),
      `# Index\n\n| What | Where |\n| :-- | :-- |\n| the thing | ${where} |\n`,
    );
    if (createFile) writeFileSync(join(dir, 'Dev-Memory', createFile), '# real\n');
    const r = spawnSync(process.execPath, [join(HOOKS, 'memory-integrity.mjs'), dir], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    try {
      const j = JSON.parse(out);
      return { status: j.status, problems: j.problems || [] };
    } catch {
      return { status: 'unparsed', problems: [], raw: out.slice(0, 200) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = verdict('GONE.md');
if (A.status === 'clean') die('control A failed: a missing plain filename must be caught — the gate is not working at all.');
console.log('  A  "GONE.md", missing .......................... BLOCKED (control)');

const B = verdict('REAL.md', 'REAL.md');
if (B.status !== 'clean') die(`control B failed: a filename that exists must pass, got ${B.status}: ${B.problems[0] || ''}`);
console.log('  B  "REAL.md", present .......................... clean   (control)');

const C = verdict('Project Plan.md');
const caught = C.status !== 'clean';
console.log(`  C  "Project Plan.md", missing .................. ${caught ? 'BLOCKED' : 'clean  '}${caught ? '' : '  <- D10'}`);

const D = verdict('Project Plan.md', 'Project Plan.md');
if (D.status !== 'clean') {
  die(`control D failed: "Project Plan.md" EXISTS and must pass — recognising it must not mean flagging it: ${D.problems[0] || ''}`);
}
console.log('  D  "Project Plan.md", present .................. clean   (control)');

// ---- E: prose must never be mistaken for a filename --------------------------
const PROSE = ['in section 4.2', 'version 1.2', 'about 3.5 hours', 'it costs 4.99', 'see the notes below'];
for (const p of PROSE) {
  const v = verdict(p);
  if (v.status !== 'clean') {
    die(
      `control E failed: the prose cell "${p}" was treated as a path and reported missing. Widening ` +
        'the stem to allow spaces does exactly this unless the extension is required to begin with ' +
        `a letter: ${v.problems[0] || ''}`,
    );
  }
}
console.log(`  E  ${PROSE.length} prose cells ............................. clean   (control)`);

// ---- F: the 2026-07-19 non-ASCII fix must survive ----------------------------
const F = verdict('নথি.md');
if (F.status === 'clean') {
  die('control F failed: a missing non-ASCII filename must still be caught — a 2026-07-19 fix added that deliberately.');
}
console.log('  F  a missing non-ASCII filename ................ BLOCKED (control)');

if (expectBug) {
  if (caught) die('expected the D10 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.');
  console.log('\nD10 REPRODUCED: an index entry whose filename contains a space is never checked.');
  process.exit(0);
}

if (caught) {
  console.log('\nPASS: a filename with a space is checked, and prose is still not mistaken for one.');
  process.exit(0);
}

die(
  'D10 is OPEN: the filename stem excludes whitespace, so "Project Plan.md" is not recognised as ' +
    'a path and its existence is never checked. Fix: allow spaces in the stem, but require the ' +
    'extension to begin with a LETTER — that is what keeps "in section 4.2" and "it costs 4.99" ' +
    'from becoming filenames.',
);
