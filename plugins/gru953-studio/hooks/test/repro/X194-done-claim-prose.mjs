#!/usr/bin/env node
//
// Reproduction for X194 (High, P6 convergence round 2) — ordinary English sentences in
// PROGRESS.md are reported as unverifiable "done" claims, and the gate blocks.
//
// THE DEFECT. verify-progress.mjs sweeps every line outside a recognised table for a done
// claim that no table can verify:
//
//     if (l.split(/[|:—-]/).some((seg) => isDoneValue(seg.trim()))) claims.push(l);
//
// `isDoneValue` is PREFIX-anchored — `/^(done|completed?|finished|shipped|delivered)\b/i` —
// because it was written to read a STATUS CELL, where the whole cell is the value. Pointed at
// prose it says yes to any sentence, or any colon/dash-separated fragment of one, that merely
// BEGINS with a completion word. Measured at the parent commit, on the golden fixture:
//
//     "Shipped items are listed in the release notes."   -> BLOCKED
//     "Completed work: see the table."                   -> BLOCKED
//     "Done deals are recorded elsewhere."               -> BLOCKED
//     "Finished reading the spec - notes below."         -> BLOCKED
//     "Delivered to staging on Tuesday."                 -> BLOCKED
//
// These are sentences a person writes in a progress file without a second thought, and the
// gate refuses the phase checkpoint over them.
//
// THE FIX, AND THE LINE IT MUST NOT CROSS. The sweep exists for a real reason, and finding F9
// on 2026-08-13 already had to repair it once: a done claim written outside any table cannot
// be verified by any table, and must be reported. So this cannot be softened into silence.
//
// The discriminator is that a STATUS is the whole value, whereas prose merely starts with the
// word. `T5: done` has a segment that IS "done"; "Delivered to staging on Tuesday." has no
// segment that is anything but a sentence. The prose sweep therefore requires the segment to
// BE a completion value — trailing punctuation allowed — rather than to begin with one. The
// status-cell reading is untouched: widening it was X139, and narrowing it here would undo
// that fix in the place it was actually needed.
//
//   case                                                         required
//   A  the golden fixture, untouched                              clean   (control)
//   B  "- T9 — done" outside any table                            BLOCKED (control: the sweep
//                                                                          must still work)
//   C  "T9: done" outside any table                               BLOCKED (control)
//   D  "- T9 — shipped" (an X139 synonym)                         BLOCKED (control: X139 holds)
//   E  five ordinary sentences beginning with a done word         clean   <- X194
//   F  a table row whose Status cell reads "shipped"              clean   (control: X139's
//                                                                          real target still
//                                                                          reads as done)
//
// Case F is the one that stops this fix from quietly reverting X139. If narrowing the prose
// sweep also narrowed the status-cell reading, a row marked "shipped" would stop counting as
// done and the evidence requirement would silently lapse.
//
// Usage:
//   node X194-done-claim-prose.mjs                # asserts the FIXED state
//   node X194-done-claim-prose.mjs --expect-bug   # asserts the DEFECT is present

import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const GOLDEN = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden', 'Dev-Memory');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function verdict(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x194-'));
  try {
    mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
    cpSync(GOLDEN, join(dir, 'Dev-Memory'), { recursive: true });
    if (mutate) mutate(join(dir, 'Dev-Memory'));
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'verify-progress.mjs'), [dir]), 'X194', die);
    // Collect every array field the gate emits rather than naming one. This sweep reports
    // under `unverifiableTables`, and the first version of this reproduction read `problems`
    // and `unidentified` — so control B failed, correctly, on a harness that was looking in
    // the wrong place. Reading them all removes a whole class of that mistake.
    const all = Object.values(v.json || {}).flatMap((x) => (Array.isArray(x) ? x : []));
    return { status: v.status, messages: all };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SWEEP_SAYS = 'outside any recognised task table';
const append = (text) => (dm) => appendFileSync(join(dm, 'PROGRESS.md'), `\n${text}\n`);
const swept = (v) => v.messages.some((m) => String(m).includes(SWEEP_SAYS));

// ---- A: baseline ---------------------------------------------------------------
const A = verdict(null);
if (A.status !== 'clean')
  die(
    `control A failed: the golden fixture must be clean at baseline, got ${A.status}: ${A.messages[0] || ''}`,
  );
console.log('  A  the golden fixture, untouched ............... clean   (control)');

// ---- B, C, D: the sweep must keep doing its job --------------------------------
for (const [id, line, why] of [
  ['B', '- T9 — done', 'a bullet claiming done, outside any table'],
  ['C', 'T9: done', 'a colon-separated claim'],
  ['D', '- T9 — shipped', 'an X139 synonym'],
]) {
  const v = verdict(append(line));
  if (!swept(v)) {
    die(
      `control ${id} failed: "${line}" is ${why} and must still be reported — finding F9 of ` +
        '2026-08-13 already had to repair this sweep once, and a fix that silences it would ' +
        `reopen that: ${v.messages[0] || '(nothing said)'}`,
    );
  }
  console.log(`  ${id}  ${line.padEnd(16)} ............... BLOCKED (control)`);
}

// ---- B2: X196 — the claims the FIRST version of this fix silently stopped catching ----
// P6 round 3 found that requiring the segment to BE exactly a completion value traded the
// false alarm for a FALSE CLEAN — the worse direction. Every real claim carrying a qualifier
// went quiet. These are held here so the trade cannot be made again.
for (const [line, why] of [
  ['- T9 — done (2026-08-16)', 'a claim with a date'],
  ['- T9 — done, evidence to follow', 'a claim with a note'],
  ['T9: completed on Tuesday', 'a claim with a qualifier'],
  ['- T9 — shipped to staging', 'an X139 synonym with a qualifier'],
]) {
  const v = verdict(append(line));
  if (!swept(v)) {
    die(
      `control B2 failed: "${line}" is ${why} and must be reported. Requiring the segment to be ` +
        'EXACTLY a completion value silences every claim that carries a qualifier — that was ' +
        `finding X196, and it is a false clean, which is worse than the false alarm it replaced: ${v.messages[0] || '(nothing said)'}`,
    );
  }
  console.log(`  B2 ${line.padEnd(31)} .... BLOCKED (control: X196)`);
}

// ---- G: X194 RE-OPENED 2026-08-18 — the axis case E could not reach -------------
//
// Case E's five sentences all put the completion word at position 0. The repair of 2026-08-16
// guarded on `si > 0`, which excludes exactly that position — so case E passed whether or not
// the fix it was written for had been implemented, and it had not been. All five sentences
// below still blocked the phase checkpoint on 2026-08-18, four months of green suite later.
//
// Two causes, neither addressed by that repair. Three of these hide the completion word inside
// an ordinary hyphenated word, which the split class cut open: "Re-done" became ["Re","done"].
// The other two put it after a real colon, where beginning with a completion word is not
// evidence of a claim.
//
// This case exists to hold the DIMENSION, not the sentences: position and word-internal
// separators, not "more sentences starting with done". A control that varies only the dimension
// its author already had in mind inherits their blind spot — which is what happened here.
const PROSE_OFF_POSITION_ZERO = [
  'Re-done work is tracked in the table above.',
  'Half-finished features are parked in the backlog.',
  'See the well-shipped orders report for last quarter.',
  'Note: completed work is described in the release notes.',
  'Phase 1 - Shipped items are listed in the release notes.',
  'Nothing here is done - Done deals are recorded elsewhere.',
];
const offPositionAlarms = [];
for (const line of PROSE_OFF_POSITION_ZERO) {
  if (swept(verdict(append(line)))) offPositionAlarms.push(line);
}
console.log(
  `  G  ${PROSE_OFF_POSITION_ZERO.length} sentences, done-word NOT at position 0 ... ${offPositionAlarms.length ? `${offPositionAlarms.length} FLAGGED  <- X194` : 'clean  '}`,
);
if (offPositionAlarms.length > 0 && !expectBug) {
  die(
    `case G: ${offPositionAlarms.length} ordinary sentence(s) still block the phase checkpoint. ` +
      `First: "${offPositionAlarms[0]}". A hyphen inside a word is not a separator, and a segment ` +
      'that merely begins with a completion word is not a claim — the discriminator is whether the ' +
      'line NAMES A TASK, which is what controls B, C, D and B2 all do and none of these does.',
  );
}

// ---- H: X228 — a task named in PROSE is still a claim -----------------------------
//
// 2026-08-18. The X194 repair of 2026-08-17 required the line to contain an id-shaped token, so
// "- Refactor the login form: completed on Tuesday" reported CLEAN while "- T9: completed on
// Tuesday" blocked — identical absent evidence, and only the naming convention deciding. That
// swallowed the whole X196 class whenever a task was named in words, which is the false-clean
// direction this gate exists to prevent.
//
// No control in this file could see it: every must-BLOCK case above names `T9` and every
// must-stay-clean case names nothing, so an id test partitions that set perfectly whether or not it
// is the right rule. Case H holds the NAMING axis so that can never be true again.
const PROSE_NAMED = [
  '- Refactor the login form: completed on Tuesday',
  '- Wire up the payment flow: finished last week',
  '- Login rewrite | shipped to production',
  '- Refactor the login form — done (2026-08-17)',
  '- Refactor the login form — done, no evidence',
  // Reclassified 2026-08-18, and stated rather than buried: on 2026-08-17 this sat in case G as a
  // false alarm. It is not one. With a label in front of it, "Status: Delivered to staging on
  // Tuesday." is an unevidenced completion claim in a progress file, which is precisely what this
  // gate is for. The bare sentence "Delivered to staging on Tuesday.", with no label, still passes —
  // it is case E, and its only segment is the first.
  'Status: Delivered to staging on Tuesday.',
];
const missedNamed = [];
for (const line of PROSE_NAMED) {
  if (!swept(verdict(append(line)))) missedNamed.push(line);
}
console.log(
  `  H  ${PROSE_NAMED.length} claims naming the task in prose ....... ${missedNamed.length ? `${missedNamed.length} MISSED  <- X228` : 'all BLOCKED'}`,
);
if (missedNamed.length > 0 && !expectBug) {
  die(
    `case H: ${missedNamed.length} unevidenced done claim(s) reported clean because the task is named ` +
      `in words rather than by id. First: "${missedNamed[0]}". The discriminator is not whether the ` +
      'line contains an id — it is whether the completion word is followed by a short qualifier (a ' +
      'status) or by a clause (prose).',
  );
}

// ---- E: X194 --------------------------------------------------------------------
const PROSE = [
  'Shipped items are listed in the release notes.',
  'Completed work: see the table.',
  'Done deals are recorded elsewhere.',
  'Finished reading the spec - notes below.',
  'Delivered to staging on Tuesday.',
];
const falseAlarms = [];
for (const line of PROSE) {
  if (swept(verdict(append(line)))) falseAlarms.push(line);
}
console.log(
  `  E  ${PROSE.length} ordinary sentences .................... ${falseAlarms.length ? `${falseAlarms.length} FLAGGED` : 'clean  '}${falseAlarms.length ? '  <- X194' : ''}`,
);
for (const f of falseAlarms) console.log(`         flagged: "${f}"`);

// ---- F: X139's real target must still read as done ------------------------------
{
  const F = verdict((dm) => {
    const p = join(dm, 'PROGRESS.md');
    const src = readFileSync(p, 'utf8');
    // Flip an existing evidenced row's status word to an X139 synonym. If "shipped" stopped
    // counting as done, the row would no longer need evidence and this file would go quiet in
    // a way that looks like success.
    writeFileSync(p, src.replace(/\|\s*done\s*\|/i, '| shipped |'));
  });
  if (F.status !== 'clean') {
    die(
      'control F failed: an evidenced row whose Status cell reads "shipped" must still be clean. ' +
        `X139 widened the status reading deliberately, and narrowing it here would undo that: ${F.messages[0] || ''}`,
    );
  }
  console.log('  F  a Status cell reading "shipped" ............. clean   (control: X139 holds)');
}

// ---- the two axes this file held still, added 2026-08-25 ------------------------
//
// X194 varied the WORDING of a done claim thoroughly and held two things constant: the SEPARATOR
// between the task and the claim, and the SPELLING of a tick. An axis-enumeration sweep asked what
// was never moved, and the answer was measurable in one run against the real gate — with no evidence
// recorded anywhere, these were all reported CLEAN:
//
//   T1 = done      T1 -> done      T1<TAB>done      T1 (done)      - T1 x ✓
//
// while `T1 — done`, `T1 | done`, `T1: done` and the ✅ ✔ ☑ ticks all blocked correctly. A gate that
// catches three spellings of a claim and misses five is not catching the claim; it is catching a
// habit of punctuation.
//
// THE BARE-SPACE FORM IS ASSERTED AS A GAP, not fixed. `T1 done`, with no punctuation at all, is still
// reported clean and that is deliberate: adding it makes every sentence containing the word a
// candidate, leaving the auxiliary-verb guard as the only thing between this gate and a false alarm on
// ordinary prose. Case Z below pins that decision so it cannot be quietly reversed, and so nobody
// mistakes it for an oversight.
{
  const SEPARATORS = [
    ['an em dash', 'T1 — done'],
    ['a pipe', 'T1 | done'],
    ['a colon', 'T1: done'],
    ['an equals', 'T1 = done'],
    ['an ASCII arrow', 'T1 -> done'],
    ['a unicode arrow', 'T1 → done'],
    ['a tab', 'T1\tdone'],
  ];
  const TICKS = [
    ['a ticked box', '- [x] T1 build it'],
    ['U+2705 ✅', '- T1 build it ✅'],
    ['U+2714 ✔', '- T1 build it ✔'],
    ['U+2713 ✓', '- T1 build it ✓'],
    ['U+2611 ☑', '- T1 build it ☑'],
  ];
  const missed = [];
  for (const [label, line] of [...SEPARATORS, ...TICKS]) {
    if (!swept(verdict(append(line)))) missed.push(`${label} (${JSON.stringify(line)})`);
  }
  if (missed.length) {
    die(
      `separator/tick axes: ${missed.length} unevidenced done claim(s) were reported CLEAN — ` +
        `${missed.join(', ')}. The claim is the same in every one; only the punctuation differs`,
    );
  } else {
    console.log(
      `  S  ${SEPARATORS.length} separators and ${TICKS.length} tick spellings ..... all blocked`,
    );
  }

  // The false-alarm line, which is what makes widening the separators safe rather than reckless.
  const ordinary = [
    'T1 — the build is done when tests pass',
    'T1 — this will be done later',
    'T1 — nothing has been done yet',
    'Notes (see below) about the plan',
    'The work is not done and should not be marked so',
    'T1 — a cross means not done: ✗',
    'Setup = configure the tools first',
  ];
  const wrong = ordinary.filter((l) => swept(verdict(append(l))));
  if (wrong.length) {
    die(
      `control: ${wrong.length} ordinary line(s) now BLOCK — ${wrong.join('; ')}. Widening the ` +
        'separators must not turn prose into a claim; a gate that fires on prose gets switched off',
    );
  } else {
    console.log(`  S· control: ${ordinary.length} ordinary lines ................ still clean`);
  }

  // Z — the two stated gaps, asserted rather than left implicit. The parenthesised form was TRIED:
  // it worked, and it blocked the golden fixture's own "Phase 1 (Build) shipped" line, so it was
  // withdrawn. Both gaps are pinned here so neither drifts back in unnoticed.
  if (swept(verdict(append('T1 (done)')))) {
    die(
      'case Z: `T1 (done)` now BLOCKS. Parentheses were deliberately excluded from the separator set ' +
        'because splitting on a bracket made the golden fixture\'s "Phase 1 (Build) shipped" read as ' +
        'a done claim. If this is wanted, the control must be re-checked first.',
    );
  } else {
    console.log('  Z· the parenthesised form ................... still clean (stated gap)');
  }
  if (swept(verdict(append('T1 done')))) {
    die(
      'case Z: `T1 done`, with no separator at all, now BLOCKS. That may be an improvement — but it ' +
        'was a deliberate exclusion, because with no punctuation every sentence containing the word ' +
        'becomes a candidate. Decide it deliberately and update this case; do not let it drift in.',
    );
  } else {
    console.log('  Z  the bare-space form ....................... still clean (stated gap)');
  }
}

if (expectBug) {
  if (falseAlarms.length === 0)
    die(
      'expected the X194 false alarms and found none. If it was fixed, delete this --expect-bug branch deliberately.',
    );
  console.log(
    `\nX194 REPRODUCED: ${falseAlarms.length} ordinary sentence(s) reported as unverifiable done claims.`,
  );
  process.exit(0);
}

if (falseAlarms.length === 0) {
  console.log(
    '\nPASS: a done claim outside a table is still reported; an English sentence that merely begins with a completion word is not.',
  );
  process.exit(0);
}

die(
  `X194 is OPEN: ${falseAlarms.length} ordinary sentence(s) were reported as done claims. The ` +
    'prose sweep uses isDoneValue, which is prefix-anchored because it was written to read a ' +
    'STATUS CELL, where the whole cell is the value. Fix: in the prose sweep require the segment ' +
    'to BE a completion value rather than to begin with one, and leave the status-cell reading alone.',
);
