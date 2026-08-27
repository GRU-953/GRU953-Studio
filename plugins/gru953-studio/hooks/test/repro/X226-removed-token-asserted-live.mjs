#!/usr/bin/env node
//
// Reproduction for X226 — a live document asserted a deleted authorisation token as a working check,
// inside a section headed "The guarantees it keeps (nothing is weakened)", and nothing could see it.
//
// `skills/checkpoint-commit/SKILL.md` told the reader that going public "still requires the separate
// `GO-PUBLIC-APPROVED` token, checked first — a checkpoint can never change visibility to public."
// Nothing checks it. That token and the go-public gate were removed on 2026-08-16 by X214. The same
// file contradicted itself twice more: 74 lines later it restated the false version, and elsewhere an
// orphaned tail still read "The token is TTL-bounded and private-only."
//
// WHY THE GUARD ADDED THE DAY BEFORE COULD NOT SEE IT. X219 gave INV4 a bare-name rule, but it asks
// whether a referenced .mjs FILE exists. `GO-PUBLIC-APPROVED` is an IDENTIFIER, not a filename, so the
// entire class was invisible. X226 is its third instance — X219 found one in SECURITY.md, X225 one in
// the dev-memory skill, this one in checkpoint-commit — which is why the rule below is worth having
// rather than the three passages merely rewritten.
//
// SCOPE CHOSEN BY MEASUREMENT over every live mention in the tree, not by preference:
//
//   PARAGRAPH disclosure (what INV4 already uses)   4 undisclosed. All real, all fixed.
//   SENTENCE disclosure                            38 newly flagged, nearly all honest dated history.
//                                                  Rejected: rewording honest records to satisfy a
//                                                  checker is X215's anti-pattern.
//   present-tense CLAIM VERB in the sentence       27 flagged, ~7 of them past-tense narrative that
//                                                  merely contains a word like "checks". Rejected:
//                                                  not precise enough to block on.
//
//   case                                                        required
//   A  a live skill asserting a removed token, no disclosure     BLOCKED         <- X226
//   B  the same assertion WITH the removal disclosed             quiet (control: a record may name a
//                                                                dead thing — X215's line)
//   C  a record (CHANGELOG) asserting it, undisclosed            quiet (control: records are exempt)
//   D  a live skill naming a token that still exists             quiet (control: the rule must not
//                                                                fire on live identifiers, and the
//                                                                list is named for exactly that reason)
//   E  the real repository at this commit                        quiet (control: proves all four real
//                                                                assertions are actually repaired)
//
// DISCLOSED RESIDUAL, recorded here and under "Known limitations" in SECURITY.md: paragraph scope
// means one disclosure excuses every OTHER removed identifier in that paragraph — which is precisely
// how X226 survived. The paragraph disclosed that the CHECKPOINT token was gone, then asserted
// GO-PUBLIC-APPROVED was still checked first. This rule does not close that, and both tighter scopes
// that would were measured and rejected above.
//
// Usage:
//   node X226-removed-token-asserted-live.mjs                # asserts the FIXED state
//   node X226-removed-token-asserted-live.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

const SAYS = /removed on 2026-08-16 by finding X214/i;

function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x226-'));
  try {
    const plugin = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(join(plugin, 'hooks'), { recursive: true });
    mkdirSync(join(plugin, 'skills'), { recursive: true });
    mkdirSync(join(plugin, 'agents'), { recursive: true });
    mkdirSync(join(plugin, 'commands'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# Fixture\n');
    writeFileSync(join(plugin, 'ROSTER.md'), '# Roster\n');
    writeFileSync(join(plugin, 'plugin.json'), '{"name":"fixture"}\n');
    writeFileSync(join(plugin, 'hooks', 'real-hook.mjs'), '// a hook that exists\n');
    if (extra) extra(dir, plugin);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X226', die);
    return v.problems.filter((p) => SAYS.test(String(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skill = (body) => (dir, plugin) => {
  const p = join(plugin, 'skills', 'checkpoint-commit', 'SKILL.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};

// ---- A: the defect ---------------------------------------------------------------
const A = verdict(
  skill(
    '# Checkpoint\n\nGoing public still requires the separate `GO-PUBLIC-APPROVED` token,\nchecked first.\n',
  ),
);
const aSeen = A.length > 0;
console.log(
  `  A  a live skill asserting a removed token ...... ${aSeen ? 'BLOCKED' : 'silent   <- X226'}`,
);

// ---- B: the same assertion, disclosed ------------------------------------------
{
  const B = verdict(
    skill(
      '# Checkpoint\n\nThis used to require a `GO-PUBLIC-APPROVED` token; it was removed on\n2026-08-16 by finding X214 and nothing checks it now.\n',
    ),
  );
  if (B.length > 0) {
    die(
      'control B failed: a paragraph that names the token AND says it was removed was still reported. ' +
        'That is a record, and X215 established that a record may name a dead thing — the only way to ' +
        `satisfy a check that rejects it is to delete the history. Problems: ${B.join(' | ')}`,
    );
  }
  console.log('  B  the same assertion, removal disclosed ....... quiet (control, X215 holds)');
}

// ---- C: a record is exempt -----------------------------------------------------
{
  const C = verdict((dir) =>
    writeFileSync(
      join(dir, 'CHANGELOG.md'),
      '# Changelog\n\n## 6.0.0\n\n- The `GO-PUBLIC-APPROVED` token gates going public.\n',
    ),
  );
  if (C.length > 0) {
    die(
      'control C failed: a CHANGELOG entry describing what was true at the time was reported. A ' +
        `changelog is a record of the past, which is the whole point of it. Problems: ${C.join(' | ')}`,
    );
  }
  console.log('  C  a CHANGELOG asserting it, undisclosed ....... quiet (control)');
}

// ---- D: a token that still exists must not fire --------------------------------
{
  const D = verdict(
    skill(
      '# Checkpoint\n\nCreate `Dev-Memory/SHIP-MEMORY-DELIBERATELY` to opt in. The marker is read\nby `scan.mjs`.\n',
    ),
  );
  if (D.length > 0) {
    die(
      'control D failed: the LIVE marker file was reported as removed. The list is named precisely so ' +
        'that a live identifier is never mistaken for a dead one — a pattern-based rule could not tell ' +
        `them apart. Problems: ${D.join(' | ')}`,
    );
  }
  console.log('  D  a token that still exists ................... quiet (control)');
}

// ---- E: the real tree ----------------------------------------------------------
{
  const v = refuseCrash(
    readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [REPO_ROOT]),
    'X226',
    die,
  );
  const E = v.problems.filter((p) => SAYS.test(String(p)));
  if (E.length > 0 && !expectBug) {
    die(
      'control E failed: the REAL repository still asserts a removed token as live. Four did — three ' +
        'in checkpoint-commit including the false guarantee, and one telling the reader to delete a ' +
        `file nothing creates. Problems: ${E.join(' | ')}`,
    );
  }
  console.log(
    `  E  the real repository at this commit .......... ${E.length === 0 ? 'quiet (control)' : `${E.length} still open`}`,
  );
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X226 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX226 REPRODUCED: a live skill asserts a deleted authorisation token as a working check and every ' +
      'gate reports clean, because the guard added for this class only recognises missing FILES.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: an undisclosed assertion of a removed token is blocked, while a disclosed one, a record, ' +
      'and a token that still exists are all left alone.',
  );
  process.exit(0);
}

die(
  'X226 is OPEN: nothing detects a live document asserting a removed authorisation token. INV4 asks ' +
    'whether a referenced .mjs FILE exists; these are identifiers, so the class is invisible to it.',
);
