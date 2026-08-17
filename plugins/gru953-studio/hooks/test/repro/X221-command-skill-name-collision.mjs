#!/usr/bin/env node
//
// Reproduction for X221 (the mechanical half of X35) — nothing checked whether a command and a skill
// share a name, so the collision that produced X35 could recur silently, and a second one would be
// found the same way the first was: by a person noticing.
//
// A Claude Code plugin declares commands as `commands/<name>.md` and skills as `skills/<name>/`. Both
// land in ONE namespace, and which one answers a bare `<name>` is undocumented platform behaviour that
// may change without notice. `studio` was declared as both from the beginning; that is X35, open since
// 13 August and settled by the owner on 2026-08-17 by renaming the COMMAND to `studio-start` — the
// cheap side, because 48 files reference the skill name and almost nothing referenced the command's.
//
// Round 1 raised this half separately, as r1/X64: "No CI check for `basename(commands/*.md)` INTERSECT
// `basename(skills/*/)` — would have caught X35 automatically." It was mapped into X35's extension and
// never built, so the register carried the finding and not the guard. Fixing the one collision without
// this check would leave the next one exactly as undetectable as the first.
//
//   case                                                        required
//   A  a command and a skill sharing a name                      BLOCKED         <- X221
//   B  distinct command and skill names                          quiet (control)
//   C  a command whose name merely PREFIXES a skill's            quiet (control: `studio-start` vs
//                                                                `studio` must not collide, or the
//                                                                fix for X35 would trip its own check)
//   D  the real repository at this commit                        quiet (control: X35's collision is
//                                                                resolved, so the tree must pass)
//
// Control C is the one that matters, and it is the reason this compares whole names rather than
// searching for one inside the other. After the owner's rename the tree contains a command
// `studio-start` and a skill `studio`; a check built on "does either contain the other" would call
// that a collision and fail the very repair it exists to protect. That is the L15 shape again — where
// the changed thing shares a name with things kept, compare exactly, never loosely.
//
// Usage:
//   node X221-command-skill-name-collision.mjs                # asserts the FIXED state
//   node X221-command-skill-name-collision.mjs --expect-bug   # asserts the DEFECT is present

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

const MATCH = /same name|name collision|namespace/i;

/** A minimal plugin skeleton carrying the named commands and skills. */
function verdict({ commands, skills }) {
  const dir = mkdtempSync(join(tmpdir(), 'x221-'));
  try {
    const plugin = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(join(plugin, 'hooks'), { recursive: true });
    mkdirSync(join(plugin, 'agents'), { recursive: true });
    mkdirSync(join(plugin, 'commands'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# Fixture\n');
    writeFileSync(join(plugin, 'ROSTER.md'), '# Roster\n');
    writeFileSync(join(plugin, 'plugin.json'), '{"name":"fixture"}\n');
    for (const c of commands) {
      writeFileSync(join(plugin, 'commands', `${c}.md`), `---\ndescription: ${c}\n---\n\nBody.\n`);
    }
    for (const s of skills) {
      mkdirSync(join(plugin, 'skills', s), { recursive: true });
      writeFileSync(
        join(plugin, 'skills', s, 'SKILL.md'),
        `---\nname: ${s}\ndescription: ${s}\n---\n\nBody.\n`,
      );
    }
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X221', die);
    return v.problems.filter((p) => MATCH.test(String(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- A: the defect ---------------------------------------------------------------
const A = verdict({ commands: ['studio', 'studio-status'], skills: ['studio', 'dev-memory'] });
const aSeen = A.length > 0;
console.log(
  `  A  a command and a skill share a name .......... ${aSeen ? 'BLOCKED' : 'silent   <- X221'}`,
);

// ---- B: distinct names ----------------------------------------------------------
{
  const B = verdict({
    commands: ['studio-start', 'studio-status'],
    skills: ['dev-memory', 'quality-gate'],
  });
  if (B.length > 0) {
    die(
      'control B failed: entirely distinct command and skill names were reported as colliding. A check ' +
        `that fires on names that do not clash cannot be satisfied. Problems: ${B.join(' | ')}`,
    );
  }
  console.log('  B  distinct names ............................. quiet (control)');
}

// ---- C: a prefix is not a collision --------------------------------------------
{
  const C = verdict({
    commands: ['studio-start', 'studio-status'],
    skills: ['studio', 'dev-memory'],
  });
  if (C.length > 0) {
    die(
      'control C failed: the command `studio-start` and the skill `studio` were reported as colliding. ' +
        'That is the exact shape the owner chose on 2026-08-17 to RESOLVE X35, so a check built this ' +
        'way would fail the repair it exists to protect. Compare whole names, never one inside the ' +
        `other (L15). Problems: ${C.join(' | ')}`,
    );
  }
  console.log('  C  a command that merely prefixes a skill ..... quiet (control)');
}

// ---- D: the real tree ----------------------------------------------------------
{
  const v = refuseCrash(
    readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [REPO_ROOT]),
    'X221',
    die,
  );
  const D = v.problems.filter((p) => MATCH.test(String(p)));
  if (D.length > 0) {
    die(
      'control D failed: the REAL repository has a command/skill name collision at this commit. X35 was ' +
        `resolved by renaming the command to studio-start, so this should be clean. Problems: ${D.join(' | ')}`,
    );
  }
  console.log('  D  the real repository at this commit ......... quiet (control)');
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X221 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX221 REPRODUCED: a command and a skill declared under the same name pass every check, so the ' +
      'collision behind X35 could recur with nothing noticing.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: a command and a skill sharing a name is blocked, while distinct names and a command that ' +
      'merely prefixes a skill name are left alone.',
  );
  process.exit(0);
}

die(
  'X221 is OPEN: nothing checks `basename(commands/*.md)` against `basename(skills/*/)`. Round 1 raised ' +
    'this as r1/X64 — "would have caught X35 automatically" — and it was mapped into X35 and never ' +
    'built, so the register carried the finding and not the guard.',
);
