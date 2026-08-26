#!/usr/bin/env node
//
// Reproduction for X182 — the product told a non-technical owner their work was backed up after
// every stage, when the backup was opt-in, needed GitHub, covered the app's code only, and rested on
// a consent that was collected nowhere.
//
// Four shipped sentences, all read by someone deciding whether their work is safe:
//
//   * `README.md` — "with a private backup of your work after every stage". Unconditional, and
//     "your work" reads as everything.
//   * `docs/index.html` — "In stages, with a private backup after each one." Same claim, same page
//     as the download link.
//   * `skills/phased-roadmap/SKILL.md` — "**Nothing is lost if work stops here.**" The strongest of
//     the four, and the one an owner would actually rely on.
//   * `skills/checkpoint-commit/SKILL.md` frontmatter — "Keeps work backed up offsite progressively".
//
// WHAT IS ACTUALLY TRUE, from the same skill:
//
//   1. It is OPT-IN. `checkpoint-commit`'s step 3 says "the user enables per-phase backup once, at
//      the phased-plan/warframe approval — see `warframe-prototype`".
//   2. `warframe-prototype/SKILL.md` NEVER MENTIONED BACKUP. Its blocking pop-up approves the
//      warframe and the phased plan. So the consent step 3 depends on was collected nowhere, and the
//      user was never asked the question the product believed they had answered.
//   3. It needs a connected GitHub. With no repository there is no offsite copy of anything.
//   4. It covers the app's code ONLY. `Dev-Memory/` — every decision, plan and progress record — is
//      `.gitignore`d by design and never pushed. `agents/memory-keeper.md` rule 4 says so outright:
//      an offsite copy of Dev-Memory is "not something this tool does".
//
// So on a machine that is lost, the code may be recoverable and the entire planning history is not —
// and the owner had been told "nothing is lost". THIS IS NOT A CONTRADICTION BETWEEN TWO SKILLS.
// `memory-keeper` (Dev-Memory, never backed up) and `checkpoint-commit` (app code, pushed) are about
// different things and both are internally right. The defect is that the PUBLIC wording generalised
// one of them into a promise about "your work".
//
//   case                                                      required
//   A  README does not promise an unconditional backup          conditional, and says what is excluded
//   B  the docs page likewise                                   conditional
//   C  phased-roadmap no longer says "nothing is lost"           the claim is gone
//   D  the warframe pop-up asks about backup                     and names the Dev-Memory exclusion
//   E  checkpoint-commit states both limits                      opt-in AND app-code-only
//   F  control: the feature is still offered everywhere          not deleted to pass A to E
//   G  control: memory-keeper still says Dev-Memory is not       the fact the wording must match
//
// Controls F and G are what stop this being a fix by deletion. Removing the backup feature, or
// removing memory-keeper's rule, would satisfy A to E while making the product worse. F requires the
// capability still to be described in all four places; G requires the underlying fact to be intact,
// because if Dev-Memory ever DID get an offsite copy, these warnings would themselves become false
// and this reproduction should fail rather than enforce a stale caveat.
//
// NOTHING IS EXECUTED. Every case reads a shipped file. No push, no commit, no network call.
//
// Usage:
//   node X182-backup-claim-overstated.mjs                # asserts the fixed state
//   node X182-backup-claim-overstated.mjs --expect-bug   # asserts the overstated claim

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(here, '..', '..', '..');
const REPO = join(PLUGIN, '..', '..');

const problems = [];
const note = (s) => problems.push(s);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
// Whitespace-collapsed: every phrase below wraps across lines in Markdown prose, and a window-based
// match on the raw text is the repair three earlier reproductions in this programme already needed.
const flat = (s) => (s || '').replace(/\s+/g, ' ');

const readme = read(join(REPO, 'README.md'));
const docs = read(join(REPO, 'docs', 'index.html'));
const roadmap = read(join(PLUGIN, 'skills', 'phased-roadmap', 'SKILL.md'));
const warframe = read(join(PLUGIN, 'skills', 'warframe-prototype', 'SKILL.md'));
const checkpoint = read(join(PLUGIN, 'skills', 'checkpoint-commit', 'SKILL.md'));
const keeper = read(join(PLUGIN, 'agents', 'memory-keeper.md'));

for (const [name, v] of [
  ['README.md', readme],
  ['docs/index.html', docs],
  ['phased-roadmap/SKILL.md', roadmap],
  ['warframe-prototype/SKILL.md', warframe],
  ['checkpoint-commit/SKILL.md', checkpoint],
  ['agents/memory-keeper.md', keeper],
]) {
  if (v === null) {
    console.error(`FAIL: ${name} does not exist, so nothing here can be judged`);
    process.exit(1);
  }
}

// ---- A: README must be conditional and name the exclusion --------------------------
{
  const f = flat(readme);
  if (/a private backup of your work after every stage/i.test(f)) {
    note(
      'case A: README still promises "a private backup of your work after every stage" — ' +
        'unconditional, and "your work" reads as everything, when the backup is opt-in, needs ' +
        'GitHub, and never covers the planning notes',
    );
  } else {
    const conditional = /if you have turned|turn(ed)? on|when you (have )?turn/i.test(f);
    const excludes = /planning notes[^.]{0,80}(never|only)|never copied anywhere/i.test(f);
    if (!conditional || !excludes) {
      note(
        'case A: README no longer makes the false claim, but does not replace it with the two facts ' +
          `an owner needs: that it is opt-in (${conditional ? 'stated' : 'MISSING'}) and that the ` +
          `planning notes are excluded (${excludes ? 'stated' : 'MISSING'})`,
      );
    } else {
      console.log('  A  README ..................................... conditional, exclusion named');
    }
  }
}

// ---- B: the docs page likewise ---------------------------------------------------
{
  const f = flat(docs);
  if (/In stages, with a private backup after each one/i.test(f)) {
    note('case B: docs/index.html still carries the unconditional "a private backup after each one"');
  } else if (!/turn on stage-by-stage backup|if you turn/i.test(f)) {
    note('case B: the docs page dropped the false claim without stating that backup is opt-in');
  } else {
    console.log('  B  docs/index.html ............................ conditional');
  }
}

// ---- C: the strongest claim must be gone ----------------------------------------
{
  // The correction paragraph necessarily QUOTES the old sentence, so a naive search would stay red
  // for ever. Only a live instruction counts: the quotation sits inside the parenthetical that
  // begins "(2026-08-23, X182:".
  const live = flat(roadmap).replace(/\(2026-08-23, X182:.*?\)\*\*/g, '');
  if (/Nothing is lost if work stops here/i.test(live)) {
    note(
      'case C: phased-roadmap still tells the user "Nothing is lost if work stops here" as a live ' +
        'instruction. With backup off the commit is local, and Dev-Memory is never pushed at all',
    );
  } else {
    console.log('  C  phased-roadmap "nothing is lost" .......... gone from the live text');
  }
}

// ---- D: the pop-up must actually ask -------------------------------------------
{
  const f = flat(warframe);
  const asks = /backup/i.test(f);
  const namesExclusion = /Dev-Memory\//.test(f) && /never/i.test(f);
  const decliningOk = /declin/i.test(f);
  if (!asks) {
    note(
      'case D: warframe-prototype STILL never mentions backup, yet checkpoint-commit step 3 says the ' +
        'user "enables per-phase backup once, at the phased-plan/warframe approval". The consent that ' +
        'skill relies on is collected nowhere, so the product acts on an answer it never asked for',
    );
  } else if (!namesExclusion) {
    note(
      'case D: the pop-up asks about backup but does not tell the user that Dev-Memory/ is never ' +
        'copied anywhere — which is the half that decides whether their planning history survives a ' +
        'lost machine',
    );
  } else if (!decliningOk) {
    note(
      'case D: the pop-up asks and warns, but does not say that declining is a normal answer — a ' +
        'consent question that reads as a warning is not really a question',
    );
  } else {
    console.log('  D  the warframe pop-up ....................... asks, warns, and allows a no');
  }
}

// ---- E: checkpoint-commit must state both limits -------------------------------
{
  const f = flat(checkpoint);
  const optIn = /only if the user turned it on|when the user has enabled/i.test(f);
  const codeOnly = /app's code only|covers the app's code only/i.test(f);
  if (!optIn || !codeOnly) {
    note(
      'case E: checkpoint-commit does not state both limits in its own text: opt-in ' +
        `(${optIn ? 'stated' : 'MISSING'}), app-code-only (${codeOnly ? 'stated' : 'MISSING'})`,
    );
  } else {
    console.log('  E  checkpoint-commit ......................... both limits stated');
  }
}

// ---- F: control — the feature must still be offered ---------------------------
{
  const missing = [];
  if (!/backup/i.test(readme)) missing.push('README');
  if (!/backup/i.test(docs)) missing.push('docs/index.html');
  if (!/checkpoint/i.test(roadmap)) missing.push('phased-roadmap');
  if (!/development/.test(checkpoint)) missing.push('checkpoint-commit');
  if (missing.length) {
    note(
      `control F: the backup capability is no longer described in ${missing.join(', ')}. The finding ` +
        'was that the claim was OVERSTATED, not that the feature should go — deleting it satisfies ' +
        'cases A to E while making the product worse',
    );
  } else {
    console.log('  F  control: the feature is still offered ..... in all four places');
  }
}

// ---- G: control — the underlying fact must be intact -------------------------
{
  const f = flat(keeper);
  if (!/not something this tool does/i.test(f)) {
    note(
      'control G: memory-keeper no longer states that an offsite copy of Dev-Memory is "not ' +
        'something this tool does". If that changed, the warnings added by cases A, D and E are ' +
        'themselves now wrong and must be re-decided rather than left standing as a stale caveat',
    );
  } else {
    console.log('  G  control: memory-keeper rule 4 ............. still in force');
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
  '\nPASS: the backup claim is conditional wherever it is made, says what it does not cover, is ' +
    'actually asked for at the gate that claims to ask, and the feature itself is untouched.',
);
