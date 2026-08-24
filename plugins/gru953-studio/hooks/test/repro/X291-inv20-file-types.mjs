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

const judge = (id, label, files, wantCaught) => {
  const missed = [];
  for (const [rel, body] of files) {
    const dir = treeWith([[rel, body]]);
    const got = inv20Over(dir);
    rmSync(dir, { recursive: true, force: true });
    if (got === null) missed.push(`${rel} (no readable JSON)`);
    else if (got.some((p) => p.includes(rel)) !== wantCaught) missed.push(rel);
  }
  if (missed.length) {
    note(
      `case ${id}: ${missed.length} of ${files.length} ${label} were ${wantCaught ? 'NOT caught' : 'WRONGLY caught'}: ${missed.join(', ')}`,
    );
    return;
  }
  console.log(`  ${id}  ${label.padEnd(46, '.')} ${wantCaught ? 'caught' : 'skipped'}`);
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
