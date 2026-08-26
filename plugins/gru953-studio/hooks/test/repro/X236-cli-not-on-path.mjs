#!/usr/bin/env node
//
// Reproduction for X236 — shipped prose instructs `builder` to run `claude plugin ...` shell
// commands, and on this host that command does not exist.
//
// FOUND BY ACCIDENT, which is worth recording. On 2026-08-22 the owner tried to start a probe
// session with `claude --plugin-dir ...` in Terminal and got `zsh: command not found: claude`. The
// binary lives inside the desktop application bundle, not on PATH. Checking whether the product
// made the same assumption turned up four instruction sites that do — and the check that found
// them also found the same assumption inside this programme's own verification runner (X235).
//
// WHAT IS AND IS NOT BROKEN, stated precisely, because the defect is conditional:
//   * Installed via `npm i -g`, `claude` IS on PATH and every one of these instructions works.
//   * Installed as the desktop application — which is how the owner runs it — `claude` is NOT on
//     PATH, in Terminal OR inside a Claude Code Bash session. Verified on this host: bare `claude`
//     resolves in none of the directories on PATH.
// So the defect is not "the command is wrong". It is that **four instruction sites assume one
// install method and offer no alternative for the other**, in a skill whose entire Method step 1
// depends on the call succeeding.
//
// SEVERITY: Medium, and bounded deliberately. It defeats no safety guarantee, and it fails LOUDLY
// rather than silently — both files already carry "report exactly what ran and its result / never
// claim success without having run it", so a `command not found` surfaces instead of being narrated
// as done. What breaks is capability, not honesty: on a desktop-app host `ecosystem-finder` cannot
// perform its own first step, and `builder` cannot perform the install it is told to perform.
//
// The fix is small because the document already contains its own answer: step 2 of the same Method
// names `/plugin > Discover`, the in-session route that needs no shell at all. The repair is to
// make that the stated fallback rather than a coincidence.
//
//   case                                                      required
//   A  builder.md's list/marketplace instruction                names a fallback for an absent CLI
//   B  ecosystem-finder Method step 1                           names a fallback for an absent CLI
//   C  both files' install blocks                               name the in-session route
//   D  control: a file with no CLI instruction                  is NOT flagged
//   E  control: a hedged passage                                is NOT flagged
//
// Cases D and E bound the check in both directions. D stops it flagging every file it reads; E
// stops it being vacuous — a detector that no text can satisfy would "pass" only by never firing,
// which is L12 wearing a different hat.
//
// Usage:
//   node X236-cli-not-on-path.mjs                # asserts the fixed state
//   node X236-cli-not-on-path.mjs --expect-bug   # asserts the defect, for the parent commit

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, '..', '..', '..');

const BUILDER = join(PLUGIN, 'agents', 'builder.md');
const FINDER = join(PLUGIN, 'skills', 'ecosystem-finder', 'SKILL.md');

// A passage handles an absent CLI only if it addresses the command NOT EXISTING. Matched on meaning
// words rather than one exact sentence, so a reworded fix still counts.
//
// TIGHTENED DURING AUTHORING, and the first version is worth keeping on the record because it
// false-passed. It also accepted the mere presence of `/plugin > Discover` nearby — and
// ecosystem-finder's Method step 2 already names that route, for an unrelated reason, twelve lines
// from the instruction in step 1. So case B reported "names a fallback" about a passage that says
// nothing whatever about the command being absent. Naming an alternative somewhere close by is not
// the same as telling the reader when to reach for it; a detector that conflates the two grades
// coincidence as compliance.
const ABSENCE =
  /not on PATH|not be on PATH|(command )?not found|isn't available|is not available|if that command|if the command|no `?claude`? command|desktop app/i;
// Naming the shell-free route is a separate, additional requirement, checked only where an install
// is instructed.
const FALLBACK = /\/plugin ?> ?Discover|in-session route|without a shell/i;

const problems = [];
const note = (s) => problems.push(s);

const read = (p, label) => {
  if (!existsSync(p)) {
    console.error(`FAIL: ${label} does not exist at ${p}`);
    process.exit(1);
  }
  return readFileSync(p, 'utf8');
};

// The passage around a match: enough lines that a fallback sentence next to the command counts,
// few enough that an unrelated mention elsewhere in the file does not.
const passageAround = (text, needle, span = 12) => {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) return null;
  return lines.slice(Math.max(0, i - span), i + span + 1).join('\n');
};

const builder = read(BUILDER, 'agents/builder.md');
const finder = read(FINDER, 'skills/ecosystem-finder/SKILL.md');

// ---- A: builder.md's list instruction -------------------------------------------------
{
  const p = passageAround(builder, 'claude plugin list --json');
  if (p === null) note('case A: builder.md no longer names `claude plugin list --json` at all');
  else if (!ABSENCE.test(p))
    note(
      'case A: builder.md instructs `claude plugin list --json` with nothing said about the ' +
        'command being absent — on a desktop-app install it is not on PATH',
    );
  else console.log('  A  builder.md list instruction ................ names a fallback');
}

// ---- B: ecosystem-finder Method step 1 ------------------------------------------------
{
  const p = passageAround(finder, 'claude plugin list --json');
  if (p === null) note('case B: ecosystem-finder no longer names `claude plugin list --json`');
  else if (!ABSENCE.test(p))
    note(
      "case B: ecosystem-finder's Method step 1 depends on `claude plugin list --json` and says " +
        'nothing about the command being absent, so its own first step is undoable on a ' +
        'desktop-app host',
    );
  else console.log('  B  ecosystem-finder step 1 .................... names a fallback');
}

// ---- C: the install blocks in both files ----------------------------------------------
{
  const missing = [];
  for (const [label, text] of [
    ['agents/builder.md', builder],
    ['skills/ecosystem-finder/SKILL.md', finder],
  ]) {
    const p = passageAround(text, 'claude plugin install');
    if (p === null) missing.push(`${label} (instruction gone)`);
    else if (!ABSENCE.test(p) || !FALLBACK.test(p)) missing.push(label);
  }
  if (missing.length)
    note(
      `case C: ${missing.length} install block(s) name a shell command with no in-session ` +
        `alternative: ${missing.join(', ')}`,
    );
  else console.log('  C  install blocks ............................. name the in-session route');
}

// ---- D: control — a file with no CLI instruction must not be flagged ------------------
{
  const control = join(PLUGIN, 'skills', 'quality-gate', 'SKILL.md');
  const text = read(control, 'skills/quality-gate/SKILL.md');
  if (/claude plugin (list|install|marketplace)/.test(text)) {
    note('control D: the chosen control file DOES carry a CLI instruction, so it controls nothing');
  } else {
    console.log('  D  control: file with no CLI instruction ...... not flagged (check is bounded)');
  }
}

// ---- E: control — a hedged passage must satisfy the detector --------------------------
{
  const synthetic = [
    'Run this to see what is installed:',
    '```',
    'claude plugin list --json',
    '```',
    'If that command is not found, the CLI is not on PATH — this happens on a desktop app',
    'install. Use `/plugin > Discover` in the session instead; it needs no shell.',
  ].join('\n');
  if (!ABSENCE.test(synthetic) || !FALLBACK.test(synthetic)) {
    note(
      'control E: a passage that plainly DOES explain the absent-command case fails the ' +
        'detector, so the detector is vacuous and cases A-C prove nothing (L12)',
    );
  } else {
    console.log('  E  control: hedged passage .................... satisfies the detector');
  }
}

// ---- verdict --------------------------------------------------------------------------
if (expectBug) {
  if (!problems.length) {
    console.error(
      'FAIL: --expect-bug found nothing. Every instruction site already names a fallback, so ' +
        'this run is not the defective state X236 describes.',
    );
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
  '\nPASS: every shipped `claude plugin ...` instruction says what to do when the CLI is not on ' +
    'PATH, and the check is bounded by controls in both directions.',
);
