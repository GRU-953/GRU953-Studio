#!/usr/bin/env node
//
// Reproduction for X41, X42 and X44 — three shipped claims of peer-tool support that the tools
// themselves cannot act on. All three were carried in the register as reasoned findings since
// mid-August. This file MEASURES them, by running the real `initializeUniversalRules()` into a
// throwaway folder and reading what it wrote.
//
// First measured 2026-08-23 on a stranger install: `npm pack` of clients/cli, installed into a
// clean prefix, `gru953-studio init` run in an empty folder. It reported eight files CREATED and
// exited 0 — a completely successful-looking run.
//
//   X41  `.roomodes` is written as MARKDOWN PROSE behind an HTML comment marker. Roo Code reads
//        `.roomodes` as STRUCTURED DATA. Measured: the file begins `<!-- GRU953-STUDIO:BEGIN -->`
//        followed by `# GRU953-Studio Universal Context`, and `JSON.parse` fails on it with
//        "Unexpected token '<'". So the file is inert: the Roo Code support does nothing at all,
//        while `init` prints `[CREATED] .roomodes` and exits 0.
//
//   X42  The AGENTS.md convention reads a **root** `AGENTS.md`. Measured: after init there is NO
//        root `AGENTS.md`; the content is at `.agents/AGENTS.md`, which nothing reads.
//
//   X44  `.clinerules` is written as a 20-line FILE. Cline's current convention is a `.clinerules`
//        DIRECTORY of rule files. `.cursorrules` is also written, and that form is deprecated.
//
// WHY THIS IS THE SHAPE THAT MATTERS: every one of these fails SILENTLY and looks like success.
// `init` prints `[CREATED]` for each, exits 0, and `doctor` reports everything in place. A user
// following the documentation has no way to discover that three of the six tools named in the
// marketplace entry are being handed files they will never read. That is the same class as X86 and
// X182 — a green report over a thing that is not working.
//
//   case                                                    required
//   A  `.roomodes` is readable as structured data            parses as JSON (or YAML)
//   B  a ROOT AGENTS.md exists                               the convention's own location
//   C  `.clinerules` is a directory                          the current convention
//   D  control: every other target is still written          not fixed by deletion
//   E  control: re-running init does not duplicate content   the idempotence X-finding above it
//
// Controls D and E are what stop an over-fix. D requires the other five targets to survive, because
// the finding is that three files are UNREADABLE, not that fewer files should be written. E guards
// the marker-based rewrite this module already does: `universal-init.js` carries its own note that
// running it three times was reproduced as a defect, so any change to how these files are written
// must not reintroduce that.
//
// STATUS: X41, X42 and X44 are OPEN. This reproduction therefore REPRODUCES on a plain run, and is
// deliberately NOT in the harness list in hooks.test.mjs — the same treatment, for the same stated
// reason, as X35-name-collision.mjs. Fixing any of these changes what the installer writes for
// existing users, so it needs the owner's own yes first.
//
// NOTHING IS INSTALLED AND NO TOOL IS RUN. The real init function is called with an explicit
// throwaway projectRoot; no editor, no global state and no real project is touched.
//
// Usage:
//   node X41-X42-X44-peer-tool-targets.mjs                # asserts the FIXED state (currently red)
//   node X41-X42-X44-peer-tool-targets.mjs --expect-bug   # asserts the defects (currently green)

import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', '..', '..', '..', 'clients', 'cli', 'src', 'universal-init.js');

if (!existsSync(CLI)) {
  console.error(`FAIL: cannot find universal-init.js at ${CLI}, so nothing here can be measured`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const { initializeUniversalRules } = require_(CLI);

const problems = [];
const note = (s) => problems.push(s);

// Run the REAL init into a throwaway folder, with its console output swallowed so this file's own
// output stays readable.
const dir = mkdtempSync(join(tmpdir(), 'x41-'));
const originalLog = console.log;
console.log = () => {};
try {
  initializeUniversalRules(dir);
} finally {
  console.log = originalLog;
}

const path_ = (rel) => join(dir, rel);
const read = (rel) => (existsSync(path_(rel)) ? readFileSync(path_(rel), 'utf8') : null);

try {
  // ---- A: .roomodes must be something Roo Code can actually read -------------------
  {
    const raw = read('.roomodes');
    if (raw === null) {
      note('case A: `.roomodes` was not written at all, so Roo Code support is absent rather than broken');
    } else {
      let structured = false;
      try {
        JSON.parse(raw);
        structured = true;
      } catch {
        // A YAML mapping would also be legitimate; accept a plain `key:` at the start of a line
        // with no Markdown heading or HTML comment anywhere, which prose always has here.
        structured = /^[A-Za-z_][A-Za-z0-9_-]*\s*:/m.test(raw) && !/^#|<!--/m.test(raw);
      }
      if (!structured) {
        const first = raw.split('\n')[0].slice(0, 60);
        note(
          `case A: \`.roomodes\` is prose, not structured data — it begins ${JSON.stringify(first)} ` +
            'and JSON.parse rejects it. Roo Code reads this file as structured data, so the file is ' +
            'inert and the Roo Code support does nothing, while `init` prints [CREATED] and exits 0',
        );
      } else {
        console.log('  A  .roomodes ................................. structured, readable');
      }
    }
  }

  // ---- B: the AGENTS.md convention reads a ROOT file ------------------------------
  {
    if (!existsSync(path_('AGENTS.md'))) {
      const nested = existsSync(path_(join('.agents', 'AGENTS.md')));
      note(
        'case B: there is no root `AGENTS.md`' +
          (nested ? ', only `.agents/AGENTS.md`' : ' and none anywhere') +
          '. The AGENTS.md convention reads a root file, so nothing consumes what was written',
      );
    } else {
      console.log('  B  root AGENTS.md ............................ present');
    }
  }

  // ---- C: .clinerules should be a directory --------------------------------------
  {
    const p = path_('.clinerules');
    if (!existsSync(p)) {
      note('case C: `.clinerules` was not written at all');
    } else if (!statSync(p).isDirectory()) {
      const n = readFileSync(p, 'utf8').split('\n').length;
      note(
        `case C: \`.clinerules\` is a ${n}-line FILE. Cline's current convention is a \`.clinerules\` ` +
          'DIRECTORY holding rule files',
      );
    } else {
      console.log('  C  .clinerules ............................... a directory');
    }
  }

  // ---- D: control — the other targets must survive any fix ----------------------
  {
    const expected = [
      '.cursorrules',
      '.windsurfrules',
      '.aider.conf.yml',
      join('.github', 'copilot-instructions.md'),
      join('.agents', 'OPERATING-CHARTER.md'),
    ];
    const missing = expected.filter((f) => !existsSync(path_(f)));
    if (missing.length) {
      note(
        `control D: ${missing.join(', ')} no longer written. The finding is that three files are ` +
          'UNREADABLE by the tools they target, not that fewer files should be written — dropping ' +
          'targets would satisfy A to C while removing support that does work',
      );
    } else {
      console.log('  D  control: the other five targets ........... all still written');
    }
  }

  // ---- E: control — re-running must not duplicate -----------------------------
  {
    const before = read('.cursorrules') || '';
    console.log = () => {};
    try {
      initializeUniversalRules(dir);
      initializeUniversalRules(dir);
    } finally {
      console.log = originalLog;
    }
    const after = read('.cursorrules') || '';
    const count = (s) => (s.match(/GRU953-STUDIO:BEGIN/g) || []).length;
    if (after.length !== before.length || count(after) > 1) {
      note(
        `control E: running init three times changed \`.cursorrules\` (${before.length} -> ` +
          `${after.length} bytes, ${count(after)} begin-markers). universal-init.js carries its own ` +
          'note that this exact duplication was reproduced as a defect; it must not come back',
      );
    } else {
      console.log('  E  control: init is still idempotent ......... unchanged after 3 runs');
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nPASS: every peer-tool file init writes is in a form the tool it targets can read.');
