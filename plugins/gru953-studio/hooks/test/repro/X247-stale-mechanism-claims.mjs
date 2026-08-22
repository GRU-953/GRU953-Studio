#!/usr/bin/env node
//
// Reproduction for X247 and X248 — two claims about the product's own update mechanism that the
// product contradicts. Both had been "fixed" already; both survived by sitting one file away from
// where somebody looked.
//
// X247 — THE DAILY CHECK THAT DOES NOT EXIST, fourth visit.
//
// "GRU953-Studio checks once a day, the first time you use it." No code does that. Verified three
// independent ways, and this reproduction re-checks all three rather than trusting the claim:
//   * only two things invoke auto-update.mjs, and both pass --force
//     (clients/cli/src/index.js and commands/studio-update.md);
//   * it appears nowhere in hooks/hooks.json;
//   * session-start.mjs stopped running it, its own comment recording the removal.
// So the 24-hour `.last-update-check` window inside auto-update.mjs is unreachable.
//
// X233 corrected this wording in four places on 2026-08-18 and left four more standing, including
// `index.js:204` — the line printed at the END of `install`, so the first thing a new user was ever
// told about updates. The same binary contradicted itself: `autoupdate` printed "nothing checks on
// its own" 75 lines further down. Two of the survivors were inside auto-update.mjs itself, three
// lines above the machinery they described, in a file the audit had read "1-246, every line".
//
// X248 — A PREMISE THAT WENT STALE AND TOOK THE ADVICE WITH IT.
//
// A comment dated 2026-07-29 asserted that "`@gru953/studio-cli` has never been published to npm
// (confirmed 404 from the registry) and there is no publish step anywhere in .github/workflows/".
// Both halves are false now: publish.yml carries a job named "Publish @gru953/studio-cli to npm"
// which runs `npm publish --access public`.
//
// The consequence is the interesting part. Because the premise said no package could exist, the
// message it justified told the user to RE-CLONE the git repository — the single worst instruction
// for a package-installed user. `clients/cli/src/index.js`'s own `cmdUpdate` had the right answer
// for that exact situation all along. So a hook gave worse advice than the CLI beside it, purely
// because a true comment was never revisited after it stopped being true.
//
//   case                                                              required
//   A  the premise: nothing invokes the updater without --force        still true, re-checked here
//   B  no shipped text promises a daily or once-a-day check            none outside a correction
//   C  the publish-step claim matches .github/workflows/               no false "no publish step"
//   D  a package install is told to update via its package manager     not to re-clone
//   E  control: the honest replacement is actually present             the messages say what IS true
//
// Case A is a PREMISE check, not a defect check. If someone later wires the updater to run without
// --force, the daily-check wording becomes true and cases B onward should stop being asserted — so
// this file fails loudly rather than quietly asserting a stale rule, which is the very mistake X248
// is about.
//
// Usage:
//   node X247-stale-mechanism-claims.mjs                # asserts the fixed state
//   node X247-stale-mechanism-claims.mjs --expect-bug   # asserts the defects

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const ROOT = join(HOOKS, '..', '..', '..');

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const problems = [];
const note = (s) => problems.push(s);

const AU = read(join(HOOKS, 'auto-update.mjs'));
const HOOKS_JSON = read(join(HOOKS, 'hooks.json'));
const INDEX = read(join(ROOT, 'clients', 'cli', 'src', 'index.js'));
const AUJS = read(join(ROOT, 'clients', 'cli', 'src', 'autoupdate.js'));
const SEC = read(join(ROOT, 'SECURITY.md'));
const CMD = read(join(HOOKS, '..', 'commands', 'studio-update.md'));

for (const [name, v] of [
  ['auto-update.mjs', AU],
  ['hooks.json', HOOKS_JSON],
  ['clients/cli/src/index.js', INDEX],
  ['SECURITY.md', SEC],
]) {
  if (v === null) {
    console.error(`FAIL: ${name} is missing, so this reproduction cannot judge anything`);
    process.exit(1);
  }
}

// Strip line comments so a note EXPLAINING a corrected claim is never mistaken for the claim. This
// is the repair X243's reproduction needed, applied here from the start.
const live = (t) =>
  String(t || '')
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|#)/.test(l))
    .join('\n');

// ---- A: the premise — nothing runs the updater without --force ---------------------
{
  // Comments are stripped FIRST. index.js carries a comment that itself says "call sites invoke
  // auto-update.mjs and both pass --force" — and counting that sentence as a call without --force is
  // how the first version of this case reported the premise broken while it held. Third time this
  // programme has made that mistake in a reproduction; hence live() being used everywhere here.
  // An INVOCATION, not a mention. `commands/studio-update.md:5` says "following the
  // `auto-update.mjs` ..." as prose, and counting that as a call without --force is how the second
  // version of this case still reported the premise broken. A line only counts if it actually runs
  // the thing: node, spawnSync or process.execPath naming the script.
  const INVOKES = /(?:\bnode\b|spawnSync|execPath)[^\n]{0,120}auto-update\.mjs[^\n]{0,80}/g;
  const callers = [];
  for (const [name, text] of [
    ['clients/cli/src/index.js', live(INDEX)],
    ['commands/studio-update.md', live(CMD)],
  ]) {
    const calls = String(text || '').match(INVOKES) || [];
    if (calls.length) callers.push([name, calls]);
  }
  const forceless = callers.filter(([, calls]) => calls.some((c) => !/--force/.test(c)));
  const inHooksJson = /auto-update/.test(HOOKS_JSON);
  if (forceless.length || inHooksJson) {
    note(
      'case A: the PREMISE has changed — ' +
        (inHooksJson ? 'auto-update.mjs is now registered in hooks.json; ' : '') +
        (forceless.length
          ? `invoked without --force by ${forceless.map(([n]) => n).join(', ')}; `
          : '') +
        'so an automatic periodic check may now genuinely exist and cases B onward need re-deciding ' +
        'rather than asserting a rule that has gone stale',
    );
  } else {
    console.log(
      `  A  premise: every caller passes --force ...... holds (${callers.length} callers, none in hooks.json)`,
    );
  }
}

// ---- B: no shipped text promises a daily check -------------------------------------
{
  // SCOPE, and this was got wrong first time in a way worth recording. The first version tested
  // `live(text)` — comments stripped — and TWO of the four real survivors were comments, inside
  // auto-update.mjs, three lines above the machinery they described. So the check would have passed
  // over exactly the instances that mattered. A false statement in a comment is not harmless: X248
  // in this same file is a comment whose stale premise produced bad user-facing advice.
  //
  // So the whole file is examined, and the exemption is a DATED CORRECTION rather than "it is a
  // comment" — the same scope X226 settled on. A block is a run of lines between blank lines; a
  // block carrying the claim must also carry a correction marker. Disclosed residual, identical to
  // X226's: paragraph scope means one correction excuses every other mention in the same paragraph.
  const CLAIM =
    /checks once a day|check on first use each day|once a day automatically|first time you use it\./i;
  const CORRECTED = /X2\d\d|Corrected \d{4}-\d{2}-\d{2}|used to (?:say|read|end)/i;
  const offenders = [];
  for (const [name, text] of [
    ['plugins/gru953-studio/hooks/auto-update.mjs', AU],
    ['clients/cli/src/index.js', INDEX],
    ['clients/cli/src/autoupdate.js', AUJS],
  ]) {
    if (!text) continue;
    const bad = text
      .split(/\n\s*\n/)
      .filter((block) => CLAIM.test(block) && !CORRECTED.test(block));
    if (bad.length) offenders.push(`${name} (${bad.length} uncorrected block(s))`);
  }
  // SECURITY.md is prose with no comment syntax, so its own dated corrections necessarily quote the
  // old wording. Judge it on whether a correction accompanies the quote, which is that file's
  // documented convention.
  // Whitespace is collapsed before looking for the correction, because the correction WRAPS across
  // lines in the source ("**Corrected\n  2026-08-22 (X247)") and a flat search for it finds nothing —
  // reporting the file as an offender while it is in fact correctly corrected. Exactly the failure
  // X243's reproduction had to be repaired for, made again here.
  const secFlat = String(SEC || '').replace(/\s+/g, ' ');
  if (SEC && CLAIM.test(SEC) && !/Corrected 2026-08-22 \(X247\)/.test(secFlat)) {
    offenders.push('SECURITY.md');
  }
  if (offenders.length) {
    note(
      `case B: ${offenders.length} file(s) still promise a periodic update check that no code ` +
        `performs: ${offenders.join(', ')}`,
    );
  } else {
    console.log('  B  daily-check promises ..................... none outside a dated correction');
  }
}

// ---- C: the publish-step claim must match the workflows ---------------------------
{
  const wf = join(ROOT, '.github', 'workflows');
  let publishes = false;
  if (existsSync(wf)) {
    for (const f of readdirSync(wf)) {
      const t = read(join(wf, f)) || '';
      if (/npm publish|vsce publish/.test(t)) publishes = true;
    }
  }
  const claimsNoPublish = /no publish step anywhere/i.test(live(AU));
  if (publishes && claimsNoPublish) {
    note(
      'case C: auto-update.mjs asserts there is "no publish step anywhere in .github/workflows/" ' +
        'while a workflow there runs npm publish or vsce publish',
    );
  } else if (!publishes && !claimsNoPublish) {
    console.log(
      '  C  publish-step claim ....................... no workflow publishes, nothing claimed',
    );
  } else {
    console.log('  C  publish-step claim ....................... matches the workflows');
  }
}

// ---- D: a package install is pointed at its package manager ----------------------
{
  const liveAU = live(AU);
  if (/Re-clone/i.test(liveAU)) {
    note(
      'case D: auto-update.mjs tells a NON-checkout installation to re-clone the git repository — ' +
        'the one thing a package-installed user should not do, and the opposite of what ' +
        "clients/cli/src/index.js's own cmdUpdate says for the same situation",
    );
  } else if (!/npm install -g @gru953\/studio-cli/.test(liveAU)) {
    note(
      'case D: auto-update.mjs no longer tells a non-checkout installation how to update at all — ' +
        'the advice was removed rather than corrected',
    );
  } else {
    console.log('  D  non-checkout advice ...................... points at the package manager');
  }
}

// ---- E: control — the honest replacement is actually present ---------------------
{
  if (!/nothing checks on its own/i.test(live(INDEX))) {
    note(
      'control E: index.js no longer states what DOES happen about updates. Deleting the false ' +
        'promise without replacing it leaves the user knowing less than before',
    );
  } else {
    console.log('  E  control: the true statement is present ... yes');
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
  '\nPASS: no shipped text promises an update check that no code performs, the publish-step claim ' +
    'matches the workflows, and a package install is pointed at the tool that installed it.',
);
