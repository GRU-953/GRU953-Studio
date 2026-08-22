#!/usr/bin/env node
//
// Reproduction for X243 - five defects in `tools/installers/install.sh`, the macOS and Linux
// one-line installer documented at README.md:151 and shipped verbatim in every release. It is the
// first thing a new user runs, and four of the five made it say something untrue.
//
// The script itself is clean as shell: `sh -n` and `shellcheck --severity=style` both pass, it
// writes no temp file, runs no curl, and argues against sudo. Every defect here is about what it
// CLAIMS and what `set -eu` does to it.
//
//   A  Its header promised "asking before it changes anything" about a step that asks nothing.
//      `gru953-studio install` contains no readline, no stdin read, no prompt of any kind - checked
//      across clients/cli/src/. A confirmation step that has never existed was the product's stated
//      behaviour, in the file a cautious user reads before piping it into a shell.
//
//   B  `gru953-studio install` returning non-zero aborted the script at that line, because of
//      `set -e` on line 26. The closing instructions - the only place the user is told what to type
//      next - were never printed, so a partial setup ended in silence.
//
//   C  `NPM_BIN="$(npm bin -g ... || npm prefix -g ...)/bin"` is an assignment whose status is the
//      substitution's, so if BOTH npm calls failed the script aborted before reaching the carefully
//      written "installed but cannot be found afterwards" message a few lines below. Verified in
//      /bin/sh and in dash: both abort. Found by the completeness critic, not by the adjudicator,
//      which reported the same class at a different line and stopped there - so this file also
//      checks that the pattern is gone, not just that one instance is.
//
//   D  That same expression was one branch pretending to be two. `npm bin -g` was removed in npm 9;
//      on npm 11.19.0 it prints `Unknown command: "bin"` to STDOUT while exiting non-zero, so
//      `2>/dev/null` did not suppress it, the `||` ran the second command, and the substitution
//      captured BOTH outputs. `NPM_BIN` became a four-line string ending `/opt/homebrew/bin`, so
//      `[ -x "$NPM_BIN/gru953-studio" ]` could never be true.
//
//   E  Its last line told a brand-new user to type `/studio` - renamed to `/studio-start` on
//      2026-08-17, five days earlier. The user's very first instruction was a command that no longer
//      exists. `install.ps1` said the same thing, and fixing one twin while leaving the other is
//      what this project calls L14, so both are asserted here.
//
// Nothing in this file executes either installer or runs npm. B and C are asserted by exercising the
// SHELL CONSTRUCT in /bin/sh, which is where the behaviour lives, and by reading the script.
//
// Usage:
//   node X243-installer-truthfulness.mjs                # asserts the fixed state
//   node X243-installer-truthfulness.mjs --expect-bug   # asserts the defects

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', '..', '..');
const SH = join(ROOT, 'tools', 'installers', 'install.sh');
const PS = join(ROOT, 'tools', 'installers', 'install.ps1');
const CLI = join(ROOT, 'clients', 'cli', 'src');

const problems = [];
const note = (s) => problems.push(s);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

// TWO HELPERS, and both were added after this file first ran and got two answers wrong. They are
// the same two mistakes the findings below are about, which is worth saying rather than tidying away.
//
// `prose` strips the leading `#` from comment lines and collapses whitespace, because the claim in
// case A wraps ACROSS two comment lines - "…asking before it changes\n#      anything." - so a flat
// string search for the sentence found nothing and reported the defect GONE while it was still
// there. A check that cannot see the thing it looks for always says clean: L12.
//
// `code` removes comment lines entirely, because case D searched for `npm bin -g` and matched the
// comment that EXPLAINS why the call was removed. A fix that documents itself would have kept its
// own reproduction red for ever.
const prose = (t) =>
  t
    .split('\n')
    .map((l) => l.replace(/^\s*#\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
const code = (t) =>
  t
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const sh = read(SH);
const ps = read(PS);
if (sh === null) {
  console.error(`FAIL: ${SH} does not exist`);
  process.exit(1);
}

// ---- A: no promise of a confirmation the product does not make ---------------------
{
  // Establish the ground truth first rather than trusting the claim either way: does anything in
  // the CLI actually ask? If one day it does, this case must stop firing.
  const cliSrc = ['index.js', 'install-targets.js', 'detect.js', 'path-setup.js']
    .map((f) => read(join(CLI, f)) || '')
    .join('\n');
  const asks = /readline|createInterface|process\.stdin|prompts?\(|inquirer/.test(cliSrc);
  if (asks) {
    console.log('  A  the CLI now asks something ................. claim would be fair, skipped');
  } else if (/asking before it changes anything/.test(prose(sh))) {
    note(
      'case A: install.sh promises "asking before it changes anything" while nothing in ' +
        'clients/cli/src/ reads stdin or prompts at all - a confirmation step that does not exist',
    );
  } else {
    console.log('  A  false confirmation promise ................. gone');
  }
}

// ---- B: a failing setup step must not swallow the closing instructions ------------
{
  const hasGuard = /INSTALL_STATUS/.test(sh);
  const bare = /^\s*gru953-studio install\s*$/m.test(code(sh));
  if (!hasGuard && bare) {
    note(
      'case B: `gru953-studio install` runs unguarded under `set -e`, so a non-zero exit aborts ' +
        'the script before the closing instructions are printed',
    );
  } else {
    console.log('  B  failing setup step ......................... no longer aborts silently');
  }
  // The behaviour itself, in the shell that actually runs it - so this does not rest on reading.
  const r = spawnSync('/bin/sh', ['-c', 'set -eu; false; echo REACHED'], { encoding: 'utf8' });
  if (/REACHED/.test(r.stdout || '')) {
    note(
      'case B: the premise no longer holds - `set -e` in /bin/sh did NOT abort after a failing ' +
        'command, so this reproduction is testing something that is not true of this shell',
    );
  } else {
    console.log('  B· premise: set -e does abort in /bin/sh ...... confirmed');
  }
}

// ---- C: no assignment whose failing substitution can abort the script -------------
{
  // The construct, exercised rather than reasoned about.
  const r = spawnSync('/bin/sh', ['-c', 'set -eu; X="$(false || false)/bin"; echo REACHED'], {
    encoding: 'utf8',
  });
  const aborts = !/REACHED/.test(r.stdout || '');
  if (!aborts) {
    console.log(
      '  C· premise: the assignment does not abort ..... construct is safe here, skipped',
    );
  } else if (/^\s*NPM_BIN="\$\(npm [^"]*\|\|[^"]*\)/m.test(code(sh))) {
    note(
      'case C: install.sh assigns from a substitution that can fail on both sides, and `set -e` ' +
        'aborts on exactly that in /bin/sh - so the "cannot be found afterwards" message below it ' +
        'is unreachable in the one case it exists for',
    );
  } else {
    console.log('  C  abort-before-the-error-message ............. gone');
  }
}

// ---- D: the dead npm bin -g branch --------------------------------------------------
{
  if (/npm bin -g/.test(code(sh))) {
    note(
      'case D: install.sh still calls `npm bin -g`, removed in npm 9. On npm 11 it prints its ' +
        'error to STDOUT while exiting non-zero, so the substitution captures that text and the ' +
        'branch guarded by it can never be taken',
    );
  } else {
    console.log('  D  dead `npm bin -g` branch ................... removed');
  }
}

// ---- E: the command name, in BOTH installers ---------------------------------------
{
  const stale = [];
  if (/type \/studio to begin/.test(code(sh))) stale.push('install.sh');
  if (ps !== null && /type \/studio to begin/.test(code(ps).replace(/^\s*#.*$/gm, ''))) {
    stale.push('install.ps1');
  }
  if (stale.length) {
    note(
      `case E: ${stale.join(' and ')} tell a brand-new user to type /studio, renamed to ` +
        '/studio-start on 2026-08-17',
    );
  } else {
    console.log('  E  stale /studio in the installers ............ gone from both');
  }
  // Control: the correct name must actually be there. Deleting the sentence would also pass the
  // check above, and would leave a new user with no first instruction at all.
  const missing = [];
  if (!/\/studio-start/.test(sh)) missing.push('install.sh');
  if (ps !== null && !/\/studio-start/.test(ps)) missing.push('install.ps1');
  if (missing.length) {
    note(
      `control E: ${missing.join(' and ')} no longer name /studio-start either, so the first ` +
        'instruction a new user gets has been removed rather than corrected',
    );
  } else {
    console.log('  E· control: /studio-start is named ............ in both');
  }
}

// ---- control: the script must still parse -----------------------------------------
{
  const r = spawnSync('/bin/sh', ['-n', SH], { encoding: 'utf8' });
  if (r.status !== 0) {
    note(`control: install.sh no longer parses as POSIX sh: ${(r.stderr || '').trim()}`);
  } else {
    console.log('  ·  control: install.sh parses as POSIX sh ..... yes');
  }
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
console.log(
  '\nPASS: the installer claims only what the product does, a failing setup step still leaves the ' +
    'user with instructions, and both installers name the command that exists.',
);
