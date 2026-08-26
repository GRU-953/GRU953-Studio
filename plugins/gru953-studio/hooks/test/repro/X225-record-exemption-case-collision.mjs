#!/usr/bin/env node
//
// Reproduction for X225 — the record-folder exemption is compiled CASE-INSENSITIVELY, so a shipped
// skill directory whose name differs from the private records folder only in case is invisible to two
// gates at once.
//
// `Dev-Memory/` is a project's private records folder, and X215 established that a record may name a
// deleted file because that is what the record IS. Both gates therefore exempt it:
//
//     repo-integrity.mjs   EXEMPT_FROM_INV4_RE = new RegExp([... '(^|/)Dev-Memory/' ...], 'i')
//     docs-consistency.mjs RECORD_OR_FIXTURE_RE = /... |(^|\/)Dev-Memory\//i
//
// The `i` makes that alternative match `plugins/gru953-studio/skills/dev-memory/` as well — a LIVE
// shipped skill, and one of the most-read files in the product. Both halves of INV4 skip it: the
// prefixed `hooks/<name>.mjs` rule and the bare-name rule X219 added. INV4's own comment states the
// opposite guarantee in as many words: "Everything else - skills, agents, commands, hooks, README,
// SECURITY.md, the manifests - is a live instruction and stays covered."
//
// It was not covered, and two real falsehoods were living behind it at HEAD 84fd822:
//
//   SKILL.md:118  a live INSTRUCTION to "open a PR-like review via `confirm-memory-persist.mjs`" -
//                 a script deleted by X214 on 2026-08-16.
//   SKILL.md:306  a present-tense SAFETY GUARANTEE resting on the deleted `gate.mjs`: persisted
//                 memory "can never reach a public repository" because that hook checks the
//                 go-public gate first. No such hook and no such gate exist.
//
// The second is the worse kind: not a broken instruction but a false assurance about where private
// memory can end up.
//
// THE SAME SHAPE IS RIGHT IN ONE PLACE AND WRONG IN TWO (L14). `scan.mjs`'s security-relevant sibling
// is `const DEVMEMORY_RE = /(^|\/)Dev-Memory(\/|$)/;` - correctly case-SENSITIVE, so the push guard
// never confused the skill with the records folder. Only the two documentation gates did.
//
// AND WHY NO CONTROL CAUGHT IT: X215's controls A, B and C hold a live skill, agent and command naming
// a missing hook, and all three - plus all seven of X219's cases - use `skills/publisher/SKILL.md`. No
// control ever placed a broken reference in a skill whose DIRECTORY NAME collides with an exempt
// pattern, so the exemption boundary those controls were written to pin was never tested at its edge.
// It also means X219's measured "36 references" was taken with an instrument blind to this file, so
// that figure was understated by 11.
//
//   case                                                        required
//   A  a skill under skills/dev-memory/ naming a missing hook    BLOCKED         <- X225
//   B  the real Dev-Memory/ records folder naming a deleted hook quiet (control: X215's exemption
//                                                                must survive - a record may name a
//                                                                deleted file)
//   C  an ordinary skill naming a missing hook                   BLOCKED (control: the check works)
//   D  the real repository at this commit                        quiet (control: proves the two live
//                                                                falsehoods are actually repaired)
//
// Control B is the one that shapes the fix. Making the pattern case-SENSITIVE keeps `Dev-Memory/`
// exempt and stops `dev-memory/` being swept in with it. Measured over the tracked tree before
// changing anything: exactly five files lose their exemption, and all five are live product files in
// that skill directory. No record loses anything.
//
// Usage:
//   node X225-record-exemption-case-collision.mjs                # asserts the FIXED state
//   node X225-record-exemption-case-collision.mjs --expect-bug   # asserts the DEFECT is present

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

const GHOST = 'definitely-not-a-real-hook.mjs';
const SAYS = /which does not exist/i;

/** A minimal plugin skeleton, plus whatever `extra` writes. */
function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x225-'));
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
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X225', die);
    return v.problems.filter((p) => SAYS.test(String(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skillAt = (rel, body) => (dir, plugin) => {
  const p = join(plugin, 'skills', rel, 'SKILL.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};

// ---- A: the defect ---------------------------------------------------------------
const A = verdict(skillAt('dev-memory', `# Memory\n\nRun \`${GHOST}\` before every write.\n`));
const aSeen = A.length > 0;
console.log(
  `  A  a skill under skills/dev-memory/ ............ ${aSeen ? 'BLOCKED' : 'silent   <- X225'}`,
);

// ---- B: the real records folder must stay exempt ---------------------------------
{
  const B = verdict((dir) => {
    const p = join(dir, 'Dev-Memory', 'FINDINGS.md');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `# Register\n\n- \`${GHOST}\` was removed on 2026-08-16.\n`);
  });
  if (B.length > 0) {
    die(
      "control B failed: the project's own private records folder was reported for naming a deleted " +
        'file. That is what a record IS, and X215 established it — the only way to satisfy a check ' +
        `that rejects it is to falsify the record. Problems: ${B.join(' | ')}`,
    );
  }
  console.log('  B  the real Dev-Memory/ records folder ......... quiet (control, X215 holds)');
}

// ---- C: an ordinary skill must still be caught ----------------------------------
{
  const C = verdict(skillAt('publisher', `# Publisher\n\nRun \`${GHOST}\` before shipping.\n`));
  if (C.length === 0) {
    die(
      'control C failed: an ordinary skill naming a missing hook was not reported, so this run ' +
        'measures nothing — a check that reports nothing would pass case A by accident.',
    );
  }
  console.log('  C  an ordinary skill naming a missing hook ..... BLOCKED (control)');
}

// ---- D: the real tree ------------------------------------------------------------
{
  const v = refuseCrash(
    readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [REPO_ROOT]),
    'X225',
    die,
  );
  const D = v.problems.filter((p) => SAYS.test(String(p)));
  if (D.length > 0 && !expectBug) {
    die(
      'control D failed: the REAL repository still carries an undisclosed reference to a deleted ' +
        'hook. Two lived in skills/dev-memory/SKILL.md behind this exemption — a live instruction at ' +
        `:118 and a false safety guarantee at :306. Problems: ${D.join(' | ')}`,
    );
  }
  console.log(
    `  D  the real repository at this commit .......... ${D.length === 0 ? 'quiet (control)' : `${D.length} still open`}`,
  );
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X225 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX225 REPRODUCED: a live shipped skill is exempt from the broken-reference check because its ' +
      'directory name differs from the private records folder only in case.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: a skill whose directory name merely resembles the records folder is covered, the real ' +
      'records folder is still exempt, and the tree carries no undisclosed reference.',
  );
  process.exit(0);
}

die(
  'X225 is OPEN: the record-folder exemption is case-insensitive, so skills/dev-memory/ is invisible ' +
    "to both INV4 and docs-consistency. scan.mjs's security sibling DEVMEMORY_RE is correctly " +
    'case-sensitive, so the same shape is right in one place and wrong in two (L14).',
);
