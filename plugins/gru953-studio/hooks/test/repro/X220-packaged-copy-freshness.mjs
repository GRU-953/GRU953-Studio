#!/usr/bin/env node
//
// Reproduction for X220 (the mechanical half of X38) — nothing detected that the packaged copy of the
// plugin had diverged from source, so it sat two days stale, containing five hooks that had been
// deleted, and no check anywhere noticed.
//
// `clients/cli/plugin/` is a copy of `plugins/gru953-studio/`, produced by
// `clients/cli/scripts/bundle-plugin.mjs` at packaging time and gitignored because it is build output.
// It is what `npm pack` ships, so it is what an installing user receives. Until this check existed,
// its only guarantee was that somebody had remembered to run the bundler.
//
// WHAT THAT COST, which is why this is not hygiene. On 2026-08-17 the copy was found dated 15 August
// and still carrying `gate.mjs` and the four `confirm-*.mjs` minters, deleted by X214 on 16 August. It
// therefore also lacked every fix since: X39's catastrophic-command refusals, X214's narrowing, X217,
// X218. Worse, it was twice mistaken for the truth on the same day:
//
//   * X219's first version asked "does this hook exist anywhere?" and the stale copy answered YES for
//     `gate.mjs`, so the invariant reported clean on all 36 broken references.
//   * A stale copy of scan.mjs — with behaviour matching this one exactly — was found to be what a
//     live session's PreToolUse hook actually runs, which is X40.
//
// Round 1 had filed exactly this on 15 August, as r1/X43: "a drifted twin that never received the F4
// `escalate` fix. A security fix present in one copy, absent in the shipped other." It entered the
// register as one line about staleness, the security half dropped, and sat open for two days (X99).
//
//   case                                                        required
//   A  a packaged copy carrying a file the source does not        BLOCKED         <- X220
//   B  a packaged copy whose file CONTENT differs from source     quiet (control — see below)
//   C  a packaged copy identical to source                       quiet (control)
//   D  no packaged copy at all                                   quiet (control: not every checkout
//                                                                has run the bundler, and demanding
//                                                                one would fail a clean clone)
//   E  the real repository at this commit                        quiet (control: the check must pass
//                                                                on the tree that ships)
//
// WHY B IS A CONTROL AND NOT A SECOND DEFECT, which was decided by measurement and not by preference.
// The first version of this fix blocked on content drift as well, and it turned the suite red three
// times over the moment it existed — not on a defect, but because source had been edited after the
// last bundle. That is the state a contributor is in every single time they touch a hook. A guard that
// interrupts ordinary work that often gets switched off, taking the real protection with it (L5). It
// would also have been redundant: `prepack` runs the bundler, so drifted content is regenerated before
// anything can be published.
//
// A file the copy carries that source does NOT is different in kind: editing source cannot produce
// one, only deleting from source without rebundling can, so it is never transient. And it is exactly
// what was found — five hooks deleted by X214 still sitting in the shipped copy, where two separate
// checks then read them as real. So the invariant blocks on that and reports the rest alongside it.
//
// Controls C, D and E are what keep this honest rather than merely strict. The copy is build output; a
// fresh clone has none, and a check that failed there would fail everyone who had done nothing wrong.
//
// Usage:
//   node X220-packaged-copy-freshness.mjs                # asserts the FIXED state
//   node X220-packaged-copy-freshness.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO_ROOT = join(HOOKS, '..', '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const MATCH = /packaged copy/i;

/** A minimal repo skeleton, plus whatever `extra` does to the packaged copy. */
function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x220-'));
  try {
    const source = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(join(source, 'hooks'), { recursive: true });
    mkdirSync(join(source, 'skills'), { recursive: true });
    mkdirSync(join(source, 'agents'), { recursive: true });
    mkdirSync(join(source, 'commands'), { recursive: true });
    mkdirSync(join(source, '.claude-plugin'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# Fixture\n');
    writeFileSync(join(source, 'ROSTER.md'), '# Roster\n');
    writeFileSync(join(source, 'plugin.json'), '{"name":"fixture"}\n');
    writeFileSync(
      join(source, '.claude-plugin', 'plugin.json'),
      '{"name":"fixture","version":"1.0.0"}\n',
    );
    writeFileSync(join(source, 'hooks', 'real-hook.mjs'), '// a hook that exists\n');
    if (extra) extra(dir, source);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X220', die);
    return v.problems.filter((p) => MATCH.test(String(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const packagedFrom = (source, dir) => {
  const target = join(dir, 'clients', 'cli', 'plugin');
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return target;
};

// ---- A: the copy carries a file the source does not ------------------------------
const A = verdict((dir, source) => {
  const target = packagedFrom(source, dir);
  writeFileSync(
    join(target, 'hooks', 'deleted-hook.mjs'),
    '// removed from source, still shipped\n',
  );
});
const aSeen = A.length > 0;
console.log(
  `  A  copy carries a file source does not ......... ${aSeen ? 'BLOCKED' : 'silent   <- X220'}`,
);

// ---- B: content drift must NOT block — it is the ordinary mid-edit state ----------
{
  const B = verdict((dir, source) => {
    const target = packagedFrom(source, dir);
    writeFileSync(
      join(target, 'hooks', 'real-hook.mjs'),
      '// an OLD version, missing a security fix\n',
    );
  });
  if (B.length > 0) {
    die(
      'control B failed: content drift blocked the gate. Every contributor is in this state the moment ' +
        'they edit a hook without rebundling, so blocking here interrupts ordinary work constantly — ' +
        'and `prepack` regenerates the copy anyway, so it is redundant as well as annoying. Measured, ' +
        `not assumed: the first version of this fix did block, and reddened the suite at once. Problems: ${B.join(' | ')}`,
    );
  }
  console.log("  B  copy's content differs (mid-edit) .......... quiet (control)");
}

// ---- C, D, E: the controls ------------------------------------------------------
{
  const C = verdict((dir, source) => packagedFrom(source, dir));
  if (C.length > 0) {
    die(
      'control C failed: a packaged copy IDENTICAL to source was reported as stale. A check that ' +
        `cannot recognise a correct copy can never be satisfied. Problems: ${C.join(' | ')}`,
    );
  }
  console.log('  C  copy identical to source ................... quiet (control)');
}
{
  const D = verdict(null);
  if (D.length > 0) {
    die(
      'control D failed: a checkout with NO packaged copy was reported. The copy is build output and a ' +
        'fresh clone has none, so this would fail for everyone who had done nothing wrong — which is ' +
        `how a guard gets switched off (L5). Problems: ${D.join(' | ')}`,
    );
  }
  console.log('  D  no packaged copy at all .................... quiet (control)');
}
{
  const v = refuseCrash(
    readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [REPO_ROOT]),
    'X220',
    die,
  );
  const E = v.problems.filter((p) => MATCH.test(String(p)));
  if (E.length > 0) {
    die(
      "control E failed: the REAL repository's packaged copy is stale at this commit. Re-run " +
        '`node clients/cli/scripts/bundle-plugin.mjs` from clients/cli, then this check again. ' +
        `Problems: ${E.join(' | ')}`,
    );
  }
  console.log('  E  the real repository at this commit ......... quiet (control)');
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X220 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX220 REPRODUCED: the packaged copy may carry a file deleted from source — code that has been ' +
      'removed, still shipping — with nothing detecting it.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: a packaged copy carrying a file deleted from source is blocked, while ordinary mid-edit ' +
      'content drift, an identical copy, an absent copy and the real tree are all left alone.',
  );
  process.exit(0);
}

die(
  'X220 is OPEN: nothing detects that the packaged copy carries a file deleted from source. It is what ' +
    '`npm pack` ships, so what an installing user receives — and on 2026-08-17 it was found two days ' +
    'stale, still carrying five hooks deleted by X214, which two separate checks then read as real.',
);
