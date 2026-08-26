#!/usr/bin/env node
//
// Reproduction for X14 — the first-run demo instructed an autonomous publish of a user's work to
// GitHub, on their very first session, and three other shipped files forbid exactly that.
//
// `skills/first-run/SKILL.md` step 4 read, verbatim:
//
//   4. Auto-publish to user's GitHub (guided: runs `gh auth login` if needed, creates private repo,
//      pushes, tags, creates Release with downloadable zip).
//
// No confirmation step. No mention of `publish-github`, the skill that owns publishing. What the
// rest of the product says:
//
//   * `operating-charter/SKILL.md` — publishing needs "their own explicit, fresh 'yes' — every time".
//   * `publish-github/SKILL.md` — its AskUserQuestion pop-up, in "permanent and irreversible"
//     wording, comes BEFORE `gh repo create`, and "if the user declines, stop here; nothing below
//     this step runs".
//   * the same skill's description — publishing is "never auto-invoked by Claude on its own
//     initiative … only the user's own explicit trigger should start" it.
//
// AND IT WAS REACHABLE ON THE MOST ORDINARY PATH THERE IS. `studio/SKILL.md` says that if a user has
// had no first-run setup, run it "before anything else". So the very first thing a new,
// non-technical owner experienced could be their work being pushed to a repository nobody asked
// them about.
//
// The register carried this at Medium since 13 August, when `gate.mjs` still existed and would have
// demanded a token. X214 deleted that layer on 16 August, and the single remaining PreToolUse hook
// returns NO DECISION for `gh repo create`, `git push -u origin main` or `gh release create` on a
// clean tree. So the documented autonomy stopped having anything behind it, and nobody re-graded the
// row. The completeness critic raised it to High on the current evidence, which is the right test:
// a band is judged against the evidence as it now stands, not as it stood when it was written.
//
//   case                                                       required
//   A  first-run does not instruct an autonomous publish        no "Auto-publish" step
//   B  first-run defers to the skill that owns publishing       names publish-github
//   C  first-run requires a fresh yes before creating anything  says so explicitly
//   D  the celebration does not assume it published             conditional wording
//   E  control: the step still EXISTS                           publishing is still offered
//   F  control: the three forbidding files still forbid it      the contradiction is real
//
// Control E is the important one. Deleting step 4 would pass A to D and quietly remove a feature the
// first-run experience is built around; the finding is that it published WITHOUT ASKING, not that it
// published. Control F guards the other end: if the charter ever stopped requiring a fresh yes, this
// would no longer be a contradiction and the reproduction should say so rather than assert a rule
// that has been withdrawn.
//
// Usage:
//   node X14-first-run-autonomous-publish.mjs                # asserts the fixed state
//   node X14-first-run-autonomous-publish.mjs --expect-bug   # asserts the defect

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(here, '..', '..', '..', 'skills');

const read = (rel) => {
  const p = join(SKILLS, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const problems = [];
const note = (s) => problems.push(s);

const firstRun = read('first-run/SKILL.md');
if (firstRun === null) {
  console.error('FAIL: skills/first-run/SKILL.md does not exist, so nothing here can be judged');
  process.exit(1);
}

// The numbered demo steps only. A correction paragraph necessarily quotes the old instruction, and a
// check that could not tell a quotation from a live step would stay red for ever — the repair
// X243's reproduction needed and X247's after it.
const stepBlock = (() => {
  const start = firstRun.indexOf('1. Auto-run simplified interview');
  if (start < 0) return firstRun;
  const end = firstRun.indexOf('### Phase 4', start);
  return firstRun.slice(start, end > start ? end : undefined);
})();
const liveSteps = stepBlock
  .split('\n')
  .filter((l) => !/^\s*>/.test(l))
  .join('\n');
// Whitespace-collapsed, because every phrase these cases look for WRAPS across lines in Markdown
// prose — "publish it ONLY on a fresh, explicit\n   yes" defeated a `[^.\n]{0,40}` window and
// reported case C failing on a correctly-fixed file. Third reproduction in this programme to need
// exactly this repair; it is written into the file rather than quietly fixed.
const liveFlat = liveSteps.replace(/\s+/g, ' ');

// ---- A: no autonomous publish instruction -----------------------------------------
{
  if (/Auto-publish/i.test(liveSteps)) {
    note(
      'case A: first-run still instructs "Auto-publish to user\'s GitHub" as a numbered step, with no ' +
        "confirmation anywhere in it — an autonomous push of the user's work on their first session",
    );
  } else {
    console.log('  A  autonomous publish instruction ............ gone');
  }
}

// ---- B: it defers to the skill that owns publishing -------------------------------
{
  if (!/publish-github/.test(liveSteps)) {
    note(
      'case B: first-run never names `publish-github`, the skill that owns publishing and carries the ' +
        'confirmation, so it describes a publish route that bypasses the protocol entirely',
    );
  } else {
    console.log('  B  defers to publish-github .................. yes');
  }
}

// ---- C: a fresh yes is required before anything is created -----------------------
{
  const requiresYes =
    /(fresh|explicit)[^.]{0,40}yes/i.test(liveFlat) || /only on a[^.]{0,30}yes/i.test(liveFlat);
  const beforeCreate =
    /never[^.]{0,60}(create|push)/i.test(liveFlat) ||
    /may happen before the answer/i.test(liveFlat);
  if (!requiresYes || !beforeCreate) {
    note(
      'case C: first-run does not state that a fresh explicit yes is required, and that nothing may ' +
        'be created or pushed before it — the two halves that make the deferral binding rather than ' +
        'a suggestion',
    );
  } else {
    console.log('  C  requires a fresh yes first ................ stated');
  }
}

// ---- D: the celebration must not assume a publish happened ----------------------
{
  const idx = firstRun.indexOf('Published at github.com');
  if (idx < 0) {
    console.log('  D  celebration wording ....................... no publish announcement at all');
  } else {
    const around = firstRun.slice(idx, idx + 400);
    if (!/only if|if it was published|declined/i.test(around)) {
      note(
        'case D: the celebration announces "Published at github.com/…" unconditionally, so a user who ' +
          'declined would be told their work was published when it was not',
      );
    } else {
      console.log('  D  celebration wording ....................... conditional');
    }
  }
}

// ---- E: control — publishing must still be OFFERED -----------------------------
{
  const stillOffers = /publish/i.test(liveSteps);
  if (!stillOffers) {
    note(
      'control E: first-run no longer mentions publishing at all. The finding was that it published ' +
        'WITHOUT ASKING, not that it published — deleting the step removes a feature instead of ' +
        'fixing the defect',
    );
  } else {
    console.log('  E  control: publishing is still offered ...... yes');
  }
}

// ---- F: control — the rule it contradicted must still be in force --------------
{
  const charter = read('operating-charter/SKILL.md') || '';
  const pub = read('publish-github/SKILL.md') || '';
  const charterRequires = /fresh\s+"?yes"?\s*—?\s*every time/i.test(charter);
  const pubConfirmsFirst = /permanent and irreversible/i.test(pub);
  if (!charterRequires || !pubConfirmsFirst) {
    note(
      'control F: the rules this finding rested on are no longer in the tree — ' +
        (charterRequires ? '' : 'the charter no longer demands a fresh yes every time; ') +
        (pubConfirmsFirst
          ? ''
          : 'publish-github no longer carries its "permanent and irreversible" pop-up; ') +
        'so cases A to D are asserting a contradiction that may no longer exist and need re-deciding',
    );
  } else {
    console.log('  F  control: the charter and the pop-up ....... both still in force');
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
  '\nPASS: first-run offers to publish and publishes only on a fresh explicit yes, defers to the ' +
    'skill that owns publishing, and never announces a repository it did not create.',
);
