#!/usr/bin/env node
//
// Reproduction for X291 — INV20 refuses a raw control byte in "source", and its idea of source omitted
// the files where the harm it describes is worst.
//
// THE HARM, in INV20's own words: a raw control byte makes `file(1)` report binary data and a default
// `grep` return nothing at all, so the file becomes invisible to every text tool and to anyone
// auditing it. Its allow-list was `/\.(mjs|js|md|json|ya?ml|txt)$/i`. Not on it:
//
//   tools/installers/install.sh    X243's subject, and the first thing a new user pipes into a shell
//   tools/installers/install.ps1   the Windows installer
//   seven .html doc pages          including the download page
//   .ts, .rb, .roomodes, .windsurfrules   the peer-tool targets
//
// A NUL in the install script makes it unauditable by grep, which is precisely the file where that
// matters most, and INV20 did not read `.sh` at all.
//
// HOW IT WAS FOUND. X222's reproduction is careful along three axes: it varies the byte VALUE (NUL in
// case A, BEL in case D), it pins the ESCAPE form as legal (a NUL separator is a deliberate design
// choice in this codebase), and it pins tab and CRLF for the Windows CI leg. The axis it held still
// was the EXTENSION — case A plants its byte in a `.mjs` and case D in a `.md`, both already on the
// allow-list, so no case could ever reach the list's boundary.
//
// THE REPAIR IS THE INVERSION, not a longer list. An allow-list of extensions is a list someone has to
// remember to extend, and this finding is what forgetting looks like. Every tracked file is now scanned
// EXCEPT a small, closed set of obviously binary formats — so a new text format added to this
// repository is covered on the day it arrives rather than on the day someone notices it was not.
//
//   case                                                    required
//   A  a NUL in install.sh                                   caught
//   B  a control byte in .ps1, .html, .ts, .rb                caught
//   C  control: the real repository                           clean
//   D  control: binary formats are still skipped              a .png with control bytes is fine
//   E  control: OS metadata is skipped                        .DS_Store does not fail the gate
//   F  control: the ESCAPE form stays legal                   `\0` written as two characters is fine
//   G  control: tab and CRLF stay legal                       the Windows CI leg depends on it
//
// CONTROLS D TO G ARE THE WHOLE ARGUMENT FOR THE INVERSION BEING SAFE. Scanning everything by default
// only works if what is excluded is genuinely never read as text, and if the two deliberate uses of
// control characters in this codebase — an escaped NUL separator, and CRLF line endings — keep working.
// Control E exists because inverting the rule surfaced two `.DS_Store` files immediately: gitignored
// and untracked, but INV20 walks the FILESYSTEM rather than git.
//
// 2026-08-26, finding X362 (Windows-only). This file was written on a machine where `path.sep` is '/'
// and it assumed that
// everywhere: every case identifies its fixture by looking for the fixture's own '/'-spelled relative
// path inside the gate's problem text, and INV20 names files with `path.relative()`, which emits '\'
// on win32. So the two positive cases reported the installers as unscanned when they had in fact been
// scanned and flagged, and — worse — the four negative controls went on printing a success word while
// asserting nothing at all, because a needle that can never match satisfies "no problem names this
// file" for free. Both halves came from ONE separator-sensitive comparison; both are fixed in one
// place, above `judge`, where the mechanism and the evidence are set out in full.
//
// A CONTROL'S SUCCESS NOW PRINTS "not flagged", NEVER "skipped". The old word was this file's way of
// saying "INV20 declined to flag it, as required", and in a CI log it is indistinguishable from "this
// control did not run" — which is exactly how the Windows failure read, and exactly what was in fact
// happening underneath. A control that cannot fail is not a control, so a negative verdict is now
// accepted only after a positive case in the same run has proved the matcher can match at all.
//
// NOTHING IS EXECUTED. Every fixture is a file written into a temporary copy of the tree, read as
// bytes by the gate, and deleted. The `install.sh` fixture is never run.
//
// Usage:
//   node X291-inv20-file-types.mjs                # asserts the fixed state
//   node X291-inv20-file-types.mjs --expect-bug   # asserts the gap

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO = join(HOOKS, '..', '..', '..');
const RI = join(HOOKS, 'repo-integrity.mjs');

const problems = [];
const note = (s) => problems.push(s);

const NUL = Buffer.from([0x00]);
const BEL = Buffer.from([0x07]);

function treeWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'x291-'));
  cpSync(join(REPO, 'plugins'), join(dir, 'plugins'), { recursive: true });
  if (existsSync(join(REPO, '.claude-plugin'))) {
    cpSync(join(REPO, '.claude-plugin'), join(dir, '.claude-plugin'), { recursive: true });
  }
  for (const [rel, body] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return dir;
}

// Only INV20's problems, so INV18's packaged-copy check cannot be mistaken for either answer.
function inv20Over(dir) {
  const r = spawnSync(
    process.execPath,
    [join(dir, 'plugins', 'gru953-studio', 'hooks', 'repo-integrity.mjs'), dir],
    {
      encoding: 'utf8',
    },
  );
  try {
    return (JSON.parse(r.stdout).problems || []).filter((p) => p.includes('INV20'));
  } catch {
    return null;
  }
}

// 2026-08-26, X362, found by CI on `hooks (windows-latest, node 22)` — the one leg the development machine
// cannot run. Every case here asks "did INV20 name THIS FILE?" and asked it by looking for the
// fixture's relative path inside the problem text. Those paths are written with '/' throughout this
// file; INV20 names the file with `path.relative(repoRoot, f)` (repo-integrity.mjs:1362), which emits
// `path.sep` — '\' on win32. The gate said `tools\installers\install.sh`, the needle said
// `tools/installers/install.sh`, and a plain `includes` cannot bridge that.
//
// SEPARATOR-SENSITIVE STRING COMPARISON, the same class as the case-sensitivity defect fixed in
// scan.mjs on 13 August: the assertion was about WHICH FILE and it was written as an assertion about
// HOW THE PATH IS SPELLED. The gate was right on Windows and the reproduction was wrong about it.
//
// That this and nothing else was wrong is settled by the Windows log itself. Case B plants five
// fixtures and exactly four were reported missed; the fifth — `.roomodes`, the only one with no
// directory component and so the only one spelled identically on both platforms — was caught. Byte
// value cannot explain that (the caught one carries a NUL, as three of the missed four do) and nor can
// extension. Path depth is the only axis that separates them. Confirmed here by re-emitting INV20's
// path with '\' on this Mac: the run then produced the Windows text exactly, both cases and all four
// counts.
//
// Normalised for the COMPARISON ONLY, never for what is printed, so a real failure still reports the
// path in the shape the platform produced. Case is deliberately NOT folded: these fixtures are
// created by this file in a known case and INV20 derives its path from a walk of that same tree, so
// nothing here can arrive re-cased — unlike scan.mjs, which compares a path it was handed against one
// it built itself, and needs the win32 case fold for that reason.
const mentions = (problem, rel) => problem.replace(/\\/g, '/').includes(rel);

// A NEGATIVE control asserts "no problem names this file", and a needle that can never match anything
// satisfies that for free. On the Windows leg D, F and G passed for precisely that reason while A
// and B were failing on the same broken comparison: they printed a success word without testing
// anything, which is the worst state a control can be in — it is switched off and still reporting.
//
// Demonstrated on this Mac rather than assumed. With INV20's separator made win32-shaped AND
// `png|woff2?` deleted from its binary exclusion — so a .png carrying control bytes really is flagged
// — control D still reported success. With POSIX separators the identical break was caught as
// "case D: 2 of 3 control: genuinely binary formats were WRONGLY caught: docs/logo.png,
// docs/font.woff2".
//
// So a negative verdict is accepted only once a POSITIVE case in the same run has shown that a path of
// the same SHAPE can be matched at all. Nested and root-level are tracked apart because only a nested
// match proves the separator is handled, and case E's `.DS_Store` has no separator to get wrong. A and
// B run before any control and supply both kinds.
let matchedNested = false;
let matchedFlat = false;

const judge = (id, label, files, wantCaught) => {
  const missed = [];
  for (const [rel, body] of files) {
    const dir = treeWith([[rel, body]]);
    const got = inv20Over(dir);
    rmSync(dir, { recursive: true, force: true });
    if (got === null) {
      missed.push(`${rel} (no readable JSON)`);
      continue;
    }
    const named = got.some((p) => mentions(p, rel));
    if (named !== wantCaught) missed.push(rel);
    else if (named) {
      if (rel.includes('/')) matchedNested = true;
      else matchedFlat = true;
    }
  }
  if (missed.length) {
    note(
      `case ${id}: ${missed.length} of ${files.length} ${label} were ${wantCaught ? 'NOT caught' : 'WRONGLY caught'}: ${missed.join(', ')}`,
    );
    return;
  }
  if (!wantCaught) {
    const nested = files.some(([rel]) => rel.includes('/'));
    if (nested ? !matchedNested : !matchedFlat) {
      note(
        `case ${id}: ${label} is VACUOUS, not passed — nothing in this run has matched a ` +
          `${nested ? 'nested' : 'root-level'} path, so "no problem names this file" may hold ` +
          'because the comparison can never match rather than because the gate declined. It ' +
          'certifies nothing until a positive case passes',
      );
      return;
    }
  }
  console.log(`  ${id}  ${label.padEnd(46, '.')} ${wantCaught ? 'caught' : 'not flagged'}`);
};

judge(
  'A',
  'a NUL in the shell installer',
  [
    [
      'tools/installers/install.sh',
      Buffer.concat([Buffer.from('echo hello'), NUL, Buffer.from('world\n')]),
    ],
  ],
  true,
);

judge(
  'B',
  'a control byte in ps1, html, ts and rb',
  [
    [
      'tools/installers/install.ps1',
      Buffer.concat([Buffer.from('Write-Host "hi"'), BEL, Buffer.from('\n')]),
    ],
    ['docs/download.html', Buffer.concat([Buffer.from('<p>hi'), NUL, Buffer.from('</p>\n')])],
    ['src/mod.ts', Buffer.concat([Buffer.from('const a = 1;'), NUL, Buffer.from('\n')])],
    ['lib/thing.rb', Buffer.concat([Buffer.from('puts 1'), NUL, Buffer.from('\n')])],
    ['.roomodes', Buffer.concat([Buffer.from('mode'), NUL, Buffer.from('\n')])],
  ],
  true,
);

// ---- C: control — the real repository ------------------------------------------
{
  const r = spawnSync(process.execPath, [RI, REPO], { encoding: 'utf8' });
  let got = null;
  try {
    got = (JSON.parse(r.stdout).problems || []).filter((p) => p.includes('INV20'));
  } catch {
    note('control C: repo-integrity produced no readable JSON against the real repository');
  }
  if (got && got.length) {
    note(
      `control C: the real repository now FAILS INV20 (${got.length}): ${got[0].slice(0, 150)}. ` +
        'Scanning everything by default is only safe if what is excluded really is never read as text',
    );
  } else if (got) {
    console.log('  C  control: the real repository .............. clean');
  }
}

judge(
  'D',
  'control: genuinely binary formats',
  [
    ['docs/logo.png', Buffer.concat([Buffer.from('\x89PNG\r\n'), NUL, BEL, NUL])],
    ['docs/font.woff2', Buffer.concat([Buffer.from('wOF2'), NUL, NUL])],
    ['dist/bundle.zip', Buffer.concat([Buffer.from('PK'), NUL, BEL])],
  ],
  false,
);

judge(
  'E',
  'control: OS metadata',
  [['.DS_Store', Buffer.concat([NUL, Buffer.from('Bud1'), NUL, NUL])]],
  false,
);

judge(
  'F',
  'control: the ESCAPE form stays legal',
  [
    // Two characters, backslash and zero — the deliberate NUL-separator design in this codebase.
    ['tools/installers/install.sh', Buffer.from('printf "a\\0b"\n')],
    ['src/sep.ts', Buffer.from("const SEP = '\\0';\n")],
  ],
  false,
);

judge(
  'G',
  'control: tab and CRLF stay legal',
  [
    ['tools/installers/install.sh', Buffer.from('if true; then\r\n\techo hi\r\nfi\r\n')],
    ['docs/page.html', Buffer.from('<p>\r\n\thi\r\n</p>\r\n')],
  ],
  false,
);

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
console.log(
  '\nPASS: a raw control byte is caught in every text file including the installers, binary formats ' +
    'and OS metadata are skipped, and the escaped form, tabs and CRLF all stay legal.',
);
