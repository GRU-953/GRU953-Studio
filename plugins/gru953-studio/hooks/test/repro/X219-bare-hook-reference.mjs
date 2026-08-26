#!/usr/bin/env node
//
// Reproduction for X219 — INV4 recognises only ONE spelling of a hook reference, so the commonest
// spelling of a broken one is invisible, and 36 references to five deleted hooks accumulated in
// shipped documents while the gate reported clean.
//
// INV4 exists to stop a file referencing a hook that does not exist. It matched:
//
//     const refHook = /hooks\/([a-z0-9-]+\.mjs)/gi;
//
// — a reference must carry the `hooks/` prefix. Prose almost never writes it that way. SECURITY.md,
// four skills, an agent and a command all write a bare `` `gate.mjs` ``, and INV4 saw none of them.
// Its own comment meanwhile claimed the boundary was already right: "Everything else — skills,
// agents, commands, hooks, README, SECURITY.md, the manifests — is a live instruction and stays
// covered." Covered for one spelling only, which is the L12 shape at one remove: the check did not
// compare a thing to itself, it compared a thing to a form of itself that hardly ever occurs.
//
// X215 hardened this same invariant the day before and did not find it, because all three of its
// live-instruction controls used the prefixed spelling too. A control inherits the author's blind
// spot unless something forces the other case.
//
// WHAT ACCUMULATED BEHIND IT, measured rather than estimated. Live prose carries 117 bare `.mjs`
// references. Exactly five of those names exist nowhere in the repository, and all five are the
// files X214 deleted — `gate.mjs` and its four `confirm-*.mjs` minters — across 36 references. Four
// of them are not stale prose but live INSTRUCTIONS to run a script that is gone
// (publish-github/SKILL.md, checkpoint-commit/SKILL.md, commands/studio-publish.md,
// agents/memory-keeper.md), which an agent would follow. Zero of the other 112 references are false
// alarms, so the widened rule below costs no honest work — the L5 test a widened guard has to pass
// before it is worth having.
//
//   case                                                          required
//   A  a live skill naming a BARE missing hook                     BLOCKED        <- X219
//   B  a live skill naming a bare hook that EXISTS                 quiet (control)
//   C  a live skill naming a bare .mjs that exists ELSEWHERE       quiet (control: a reproduction
//      in the tree (not in hooks/)                                 filename in prose is not a defect)
//   D  a CHANGELOG naming a bare missing hook                      quiet (control: X215's
//                                                                  record exemption still holds)
//   E  a live skill naming a PREFIXED missing hook                 BLOCKED (control: the original
//                                                                  spelling still works)
//
// Controls B and C are what keep this from becoming a nuisance gate: the rule flags a bare name only
// when NO file of that basename exists anywhere in the repository, so `lib.mjs` and every
// reproduction filename mentioned in a document stay silent.
//
// Usage:
//   node X219-bare-hook-reference.mjs                # asserts the FIXED state
//   node X219-bare-hook-reference.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const GHOST_BARE = 'definitely-not-a-real-hook.mjs';
const GHOST_PREFIXED = `hooks/${GHOST_BARE}`;
const REAL_HOOK = 'real-hook.mjs';
// A .mjs that exists in the tree but NOT under hooks/ — the shape of a reproduction filename quoted
// in a document, which must never be mistaken for a broken hook reference.
const ELSEWHERE = 'some-repro.mjs';

/** A minimal plugin skeleton INV4 can walk, plus whatever `extra` adds. */
function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x219-'));
  try {
    const plugin = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(join(plugin, 'hooks', 'test', 'repro'), { recursive: true });
    mkdirSync(join(plugin, 'skills'), { recursive: true });
    mkdirSync(join(plugin, 'agents'), { recursive: true });
    mkdirSync(join(plugin, 'commands'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# Fixture\n');
    writeFileSync(join(plugin, 'ROSTER.md'), '# Roster\n');
    writeFileSync(join(plugin, 'plugin.json'), '{"name":"fixture"}\n');
    writeFileSync(join(plugin, 'hooks', REAL_HOOK), '// a hook that exists\n');
    writeFileSync(
      join(plugin, 'hooks', 'test', 'repro', ELSEWHERE),
      '// a test file that exists\n',
    );
    if (extra) extra(dir, plugin);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X219', die);
    return v.problems.filter((p) => String(p).includes('which does not exist'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skill = (body) => (dir, plugin) => {
  const p = join(plugin, 'skills', 'publisher', 'SKILL.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};
const atRoot = (rel, body) => (dir) => writeFileSync(join(dir, rel), body);

// ---- A: the defect ---------------------------------------------------------------
const A = verdict(skill(`# Publisher\n\nPush safety is enforced by \`${GHOST_BARE}\`.\n`));
const aSeen = A.length > 0;
console.log(
  `  A  a live skill naming a BARE missing hook ...... ${aSeen ? 'BLOCKED' : 'silent   <- X219'}`,
);

// ---- B, C: the false-alarm controls ----------------------------------------------
{
  const B = verdict(skill(`# Publisher\n\nPush safety is enforced by \`${REAL_HOOK}\`.\n`));
  if (B.length > 0) {
    die(
      `control B failed: a bare reference to ${REAL_HOOK}, which EXISTS, was reported as missing. ` +
        `A rule that flags hooks that are present is a nuisance gate, and a nuisance gate gets ` +
        `switched off (L5), taking the real check with it. Problems: ${B.join(' | ')}`,
    );
  }
  console.log('  B  a bare reference to a hook that EXISTS ....... quiet (control)');
}
{
  const C = verdict(
    skill(`# Publisher\n\nProved by \`${ELSEWHERE}\`, which lives under test/repro.\n`),
  );
  if (C.length > 0) {
    die(
      `control C failed: ${ELSEWHERE} exists in the tree but not under hooks/, and was reported as ` +
        'a missing hook. Every reproduction filename quoted in a document has this shape — 112 such ' +
        `references exist in the real tree — so this rule would raise 112 false alarms. Problems: ${C.join(' | ')}`,
    );
  }
  console.log('  C  a bare .mjs that exists elsewhere ........... quiet (control)');
}

// ---- D: X215's record exemption must survive -------------------------------------
{
  const D = verdict(
    atRoot('CHANGELOG.md', `# Changelog\n\n## 7.0.0\n\n- Removed \`${GHOST_BARE}\`.\n`),
  );
  if (D.length > 0) {
    die(
      'control D failed: a CHANGELOG entry recording the removal of a hook was reported as a broken ' +
        'reference. That is exactly what X215 fixed the day before, and widening the spelling must ' +
        `not undo it — the only way to satisfy such a check is to falsify the record. Problems: ${D.join(' | ')}`,
    );
  }
  console.log('  D  a CHANGELOG naming the removed hook ......... quiet (control, X215 holds)');
}

// ---- F, G: the disclosure window is the PARAGRAPH, not the line ------------------
//
// Measured, after a per-line version of this rule failed five true records. The prose in this
// repository is hard wrapped near 76 characters, so a sentence naming a removed hook routinely puts
// the name on one line and "removed" on the next. Requiring them on the SAME line would mean
// reflowing sentences to satisfy a checker — X215's anti-pattern, where the only way to pass is to
// distort the record. Control G is the other half: a paragraph may not borrow its neighbour's
// disclosure, or one honest sentence anywhere in a file would excuse every false claim in it.
{
  const F = verdict(
    skill(
      `# Publisher\n\nPush safety was enforced by \`${GHOST_BARE}\`\nuntil it was removed on 2026-08-16.\n`,
    ),
  );
  if (F.length > 0) {
    die(
      'control F failed: a disclosure wrapped onto the next line was rejected. This prose is hard ' +
        'wrapped, so that is the normal shape of an honest record; rejecting it forces sentences to ' +
        `be reflowed to suit a checker. Problems: ${F.join(' | ')}`,
    );
  }
  console.log('  F  a disclosure wrapped onto the next line ..... quiet (control)');
}
{
  const G = verdict(
    skill(
      `# Publisher\n\nSome other hook was removed last year.\n\nPush safety is enforced by \`${GHOST_BARE}\`.\n`,
    ),
  );
  if (G.length === 0) {
    die(
      "control G failed: a live claim borrowed the PRECEDING paragraph's disclosure. If a removal " +
        'word anywhere nearby excuses a false claim, one honest sentence would excuse a whole file — ' +
        'the exemption would swallow the check, which is what X215 warned about.',
    );
  }
  console.log('  G  a neighbouring paragraph cannot excuse it ... BLOCKED (control)');
}

// ---- E: the original spelling must still be caught -------------------------------
{
  const E = verdict(skill(`# Publisher\n\nRun \`node ${GHOST_PREFIXED}\` before shipping.\n`));
  if (E.length === 0) {
    die(
      'control E failed: the PREFIXED spelling is no longer caught. Widening a rule must add a case, ' +
        'not replace one — this is the control that stops the fix trading one blind spot for another.',
    );
  }
  console.log('  E  a live skill naming a PREFIXED missing hook . BLOCKED (control)');
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X219 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX219 REPRODUCED: a live skill states that a hook which does not exist enforces push safety, ' +
      'and INV4 reported clean because the reference lacked a `hooks/` prefix.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: a bare reference to a missing hook is caught, the prefixed form still is, and neither a ' +
      'hook that exists, a file elsewhere in the tree, nor a record is disturbed.',
  );
  process.exit(0);
}

die(
  'X219 is OPEN: INV4 matched only `hooks/<name>.mjs`, so a bare `<name>.mjs` naming a deleted hook ' +
    'was invisible. Flag a bare name when NO file of that basename exists anywhere in the repository ' +
    '— measured against this tree, that rule reports the 36 real references and nothing else.',
);
