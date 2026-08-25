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
// SHELL CONSTRUCT in a POSIX sh, which is where the behaviour lives, and by reading the script.
//
// 2026-08-26, X357: "in /bin/sh" used to be written into this file as a literal path, and on the
// windows-latest CI leg there is no such path. The three sites that spawned it, and what each did
// with a spawn that never happened, are set out at `POSIX_SH_CANDIDATES` below. Two of them had been
// reporting confirmations for every Windows run since this file was written; the third finally went
// red, with nothing after its colon. All three now resolve a shell first and disclose it when there
// is none.
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

// A CHECK THAT COULD NOT RUN IS NOT A VERDICT - IN EITHER DIRECTION.
//
// 2026-08-26, X357, found by CI on `hooks (windows-latest, node 22)`, test 467 - the one leg the
// development machine (a Mac) cannot run. Three sites below spawned the literal path `/bin/sh`. On
// Windows that is not a path to anything: it resolves against the current drive root, so `C:\bin\sh`,
// which is absent, and spawnSync returns `{ status: null, signal: null, stdout: undefined,
// stderr: undefined, error: ENOENT }`. Demonstrated on this Mac by spawning any absent path - the
// result shape is identical, which is why this is evidence rather than a guess about Windows.
//
// What each site then did with that, all three wrong the same way:
//   * the parse control read `r.status !== 0` - and `null !== 0` - so it reported install.sh AS
//     FAILING TO PARSE, giving `(r.stderr || '').trim()` as the reason: the empty string. The CI log
//     reads `- control: install.sh no longer parses as POSIX sh: ` and then stops. A verdict with no
//     evidence attached, from a check that never ran. X188's class exactly.
//   * case B's premise read `/REACHED/.test(r.stdout || '')`, false against `undefined`, and printed
//     `premise: set -e does abort in /bin/sh ...... confirmed`. It confirmed, on every Windows run
//     since this file was written, a fact it had not tested. L12: a check that cannot see the thing
//     it looks for always says clean.
//   * case C's premise did the same and silently assumed the construct aborts.
// Repairing only the one that went red would have left the other two lying - the fix-one-twin shape
// this file's own case E exists to catch.
//
// AND NOT THE OTHER CANDIDATE, which had to be ruled out rather than argued away. `sh -n` really
// does reject a CRLF script - proven here: /bin/sh, dash and bash all exit 2 on a CRLF copy of
// install.sh, with ``syntax error near unexpected token `{\r'``. But it fails LOUDLY, and the
// Windows stderr was empty; and `.gitattributes` pins `*.sh text eol=lf`
// (`git check-attr eol -- tools/installers/install.sh` answers `eol: lf`), so a Windows checkout
// cannot materialise this file as CRLF to begin with. Both halves rule CRLF out.
//
// So: find a real POSIX shell, and where there is none, say so instead of inventing a verdict.
// Probed by RUNNING each candidate, not by testing `process.platform`, because the question is "is
// there a usable POSIX sh on this host" - which is also the right question on a Linux image built
// without /bin/sh. A candidate counts only if it spawns AND exits 0: present-but-unusable is absent.
const POSIX_SH_CANDIDATES = [
  '/bin/sh',
  // PATH lookup. On windows-latest this is Git for Windows' own `sh.exe`; Node's spawn does the
  // PATH/PATHEXT search itself, so no `.exe` suffix is written here.
  'sh',
  // ...and its two installed layouts, for a Windows host whose PATH does not carry them. HYPOTHESIS,
  // labelled as one: these paths cannot be verified from this Mac. Nothing rests on them - if no
  // candidate answers, the shell-dependent checks are declared unrun, which is the whole point.
  'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
  'C:\\Program Files\\Git\\bin\\sh.exe',
];
const POSIX_SH = (() => {
  for (const cand of POSIX_SH_CANDIDATES) {
    const probe = spawnSync(cand, ['-c', 'exit 0'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return cand;
  }
  return null;
})();

// Everything a spawn can say about why it did not succeed, and NEVER the empty string. The old
// control printed `(r.stderr || '').trim()` on its own, which for a spawn that never happened is
// `undefined` -> `''`: the message that reached CI with nothing after its colon.
const describeSpawn = (r) => {
  const bits = [];
  if (r.error) bits.push(`spawn failed (${r.error.code || 'no code'}): ${r.error.message}`);
  if (typeof r.status === 'number' && r.status !== 0) bits.push(`exit status ${r.status}`);
  if (r.status === null && !r.error) bits.push('no exit status');
  if (r.signal) bits.push(`killed by ${r.signal}`);
  const err = (r.stderr || '').trim();
  const out = (r.stdout || '').trim();
  if (err) bits.push(`stderr: ${err}`);
  if (out) bits.push(`stdout: ${out}`);
  return bits.length
    ? bits.join('; ')
    : 'the spawn reported no status, no signal, no error and no output';
};

// A spawn that never ran, as distinct from one that ran and returned non-zero. `set -e` aborting is
// itself a non-zero exit, so status alone cannot be the test at two of the three sites below; only
// an `error`, or a null status, means the shell did not execute anything at all.
const didNotRun = (r) => Boolean(r.error) || typeof r.status !== 'number';

// Checks this host could not run. Reported loudly, and deliberately NOT pushed into `problems`:
// `--expect-bug` asserts the DEFECTIVE state and keys on `problems.length`, so a "could not check"
// counted as a defect would make the defective-state run PASS against a correctly fixed tree. Not
// hypothetical - it is the other half of what the phantom control did on Windows, breaking both
// directions of the two-direction contract in hooks.test.mjs at once.
const unchecked = [];
const cannotCheck = (s) => unchecked.push(s);

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

// 2026-08-25: every installer, not just the one the fix went into. The Windows twin carried the same
// false promise for three days AFTER install.sh was corrected, and this case reported "gone"
// throughout — `ps` was already read for case E and was never checked for the defect this file
// exists to catch. One list, both files, so a fix to one cannot leave the other reporting clean.
const INSTALLERS = [
  ['install.sh', sh || ''],
  ['install.ps1', ps || ''],
].filter(([, t]) => t.length > 0);
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
  } else {
    const promised = INSTALLERS.filter(([, text]) =>
      /asking before it changes anything/.test(prose(text)),
    ).map(([name]) => name);
    if (promised.length) {
      note(
        `case A: ${promised.join(' and ')} promise "asking before it changes anything" while nothing ` +
          'in clients/cli/src/ reads stdin or prompts at all - a confirmation step that does not exist',
      );
    } else {
      console.log(
        `  A  false confirmation promise ................. gone from all ${INSTALLERS.length} installers`,
      );
    }
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
  // X357: this is the site that printed `confirmed` on every Windows run without ever executing a
  // shell. B's own assertion above is a read of install.sh and is unaffected either way.
  if (POSIX_SH === null) {
    cannotCheck(
      'case B premise: no POSIX sh on this host, so `set -e` aborting after a failing command was ' +
        "never exercised. B's own assertion - the INSTALL_STATUS guard in install.sh - did run.",
    );
    console.log('  B· premise: set -e aborts in sh ............... NOT CHECKED: no POSIX sh here');
  } else {
    const r = spawnSync(POSIX_SH, ['-c', 'set -eu; false; echo REACHED'], { encoding: 'utf8' });
    if (didNotRun(r)) {
      cannotCheck(
        `case B premise: ${POSIX_SH} answered the probe but then failed - ${describeSpawn(r)}`,
      );
      console.log('  B· premise: set -e aborts in sh ............... NOT CHECKED: shell failed');
    } else if (/REACHED/.test(r.stdout || '')) {
      note(
        `case B: the premise no longer holds - \`set -e\` in ${POSIX_SH} did NOT abort after a ` +
          'failing command, so this reproduction is testing something that is not true of this shell',
      );
    } else {
      console.log('  B· premise: set -e aborts in sh ............... confirmed');
    }
  }
}

// ---- C: no assignment whose failing substitution can abort the script -------------
{
  // The construct, exercised rather than reasoned about - where there is a shell to exercise it in.
  //
  // X357: with no shell the premise cannot be established, and the two ways of proceeding are NOT
  // symmetric. Assuming it DOES abort keeps the source assertion below running - install.sh must
  // still not contain the pattern - which can only ever demand more. Assuming it does NOT would skip
  // case C outright and leave this file with one fewer case that varies under --expect-bug on that
  // host. So the premise is taken from the record in this file's own header (verified in /bin/sh and
  // in dash when the finding was raised) and disclosed as unexercised - never printed as confirmed.
  let aborts;
  if (POSIX_SH === null) {
    aborts = true;
    cannotCheck(
      'case C premise: no POSIX sh on this host, so `set -e` aborting on a failing assignment was ' +
        "never exercised; taken from the header record, and C's source check ran on that basis.",
    );
    console.log('  C· premise: the assignment aborts ............. NOT CHECKED: no POSIX sh here');
  } else {
    const r = spawnSync(POSIX_SH, ['-c', 'set -eu; X="$(false || false)/bin"; echo REACHED'], {
      encoding: 'utf8',
    });
    if (didNotRun(r)) {
      aborts = true;
      cannotCheck(
        `case C premise: ${POSIX_SH} answered the probe but then failed - ${describeSpawn(r)}`,
      );
      console.log('  C· premise: the assignment aborts ............. NOT CHECKED: shell failed');
    } else {
      aborts = !/REACHED/.test(r.stdout || '');
    }
  }
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
  if (POSIX_SH === null) {
    // X357, the line that went red. An absent interpreter is now "could not check" - never "parses
    // fine", and never "does not parse", which is what `r.status !== 0` used to make of it.
    cannotCheck(
      'control: install.sh was NOT parse-checked - there is no POSIX sh on this host. Nothing here ' +
        'claims the script parses; the other cases read it as text and are unaffected.',
    );
    console.log('  ·  control: install.sh parse-checked .......... NOT CHECKED: no POSIX sh here');
  } else {
    // The bytes go in on STDIN; the path no longer goes in as an argument. `sh -n` with no operand
    // parses standard input, which drops the last platform variable here: a Windows/MSYS `sh.exe`
    // handed `D:\a\...\install.sh` may not open that path at all, and the old code would have
    // called "cannot open the file" a PARSE FAILURE - the same defect one level further down. It
    // also means this control judges exactly the bytes every case above read. Verified on this Mac:
    // the real source gives status 0 and empty stderr; append `if true; then` and it gives status 2
    // with `syntax error: unexpected end of file`. A genuine parse failure is still caught.
    const r = spawnSync(POSIX_SH, ['-n'], { input: sh, encoding: 'utf8' });
    if (didNotRun(r)) {
      cannotCheck(`control: the parse check could not be run - ${describeSpawn(r)}`);
      console.log('  ·  control: install.sh parse-checked .......... NOT CHECKED: shell failed');
    } else if (r.status !== 0) {
      note(`control: install.sh no longer parses as POSIX sh (${POSIX_SH}): ${describeSpawn(r)}`);
    } else {
      console.log('  ·  control: install.sh parses as POSIX sh ..... yes');
    }
  }
}

// Printed in BOTH directions and ahead of any verdict, so a run that could not check something says
// so whether it went on to pass or to fail. `unchecked` is not a defect count - see its declaration.
if (unchecked.length) {
  console.log(`\nNOT CHECKED HERE (${unchecked.length}):`);
  for (const u of unchecked) console.log(`  ! ${u}`);
  // And the two-direction contract must still mean something on such a host. It does: A, C, D and E
  // are reads of the installers' own text and fire on any platform, so `--expect-bug` still reports
  // the defect against the parent commit and still finds nothing against this one.
  console.log('  ! cases A, C, D and E read the installers as text and still bind on this host.');
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
