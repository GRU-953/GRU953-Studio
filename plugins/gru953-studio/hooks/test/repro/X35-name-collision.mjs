#!/usr/bin/env node
// Reproduction for X35 — a component name declared in BOTH commands/ and skills/.
//
// Current Claude Code registers `commands/<n>.md` and `skills/<n>/SKILL.md` into ONE
// namespace. Declaring the same name in both registers it twice: the always-on
// description cost is paid twice, and a single invocation name serves two different
// bodies with no documented precedence rule.
//
// Proven by a minimal three-plugin experiment on 2026-08-15 with claude 2.1.233:
//   cmdonly   (command only) -> "Skills (1)  foo"        always-on ~8   on-invoke <20
//   skillonly (skill only)   -> "Skills (1)  foo"        always-on ~8   on-invoke ~17.2k
//   collide   (both)         -> "Skills (2)  foo, foo"   always-on ~15  on-invoke ~17.2k
// The always-on figure is the SUM of the two descriptions, so both genuinely register;
// the per-component table de-duplicates by name and shows only the larger body.
//
// This script asserts the STATIC invariant, which needs no CLI and no network:
//   no name may appear as both a command and a skill in this plugin.
// When the `claude` CLI is present it ALSO runs the live confirmation as a bonus check.
//
// Usage:
//   node X35-name-collision.mjs                # asserts the FIXED state (no collisions)
//   node X35-name-collision.mjs --expect-bug   # asserts the DEFECTIVE state (>=1 collision)
//
// Running both directions is the point: the first proves the fix holds, the second
// proves this reproduction can still detect the defect rather than having quietly
// become a no-op that passes whatever it is pointed at.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
// .../plugins/gru953-studio/hooks/test/repro -> .../plugins/gru953-studio
const pluginRoot = join(here, '..', '..', '..');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function listCommands(root) {
  const dir = join(root, 'commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => basename(f, '.md'));
}

function listSkills(root) {
  const dir = join(root, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
  });
}

// --- the invariant -----------------------------------------------------------

const commands = listCommands(pluginRoot);
const skills = listSkills(pluginRoot);

if (commands.length === 0 && skills.length === 0) {
  // Fail closed: an empty read is never evidence of health. (Lesson L7 / method M5 —
  // a gate that cannot see its input must never claim its input is fine.)
  fail(
    `read no commands and no skills under ${pluginRoot} — refusing to report a verdict on input I could not read`,
  );
}

const skillSet = new Set(skills);
const collisions = commands.filter((c) => skillSet.has(c)).sort();

const total = commands.length + skills.length;
console.log(
  `commands: ${commands.length}  skills: ${skills.length}  ` +
    `namespace entries: ${total}  collisions: ${collisions.length}`,
);

if (expectBug) {
  if (collisions.length === 0) {
    fail(
      '--expect-bug was given but NO name collision was found. Either the defect is ' +
        'fixed (run without the flag) or this reproduction has stopped detecting it.',
    );
  }
  console.log(`reproduced X35: ${collisions.length} collision(s): ${collisions.join(', ')}`);
  console.log(
    `each collided name costs its always-on description twice and resolves by an ` +
      `undocumented rule.`,
  );
} else {
  if (collisions.length > 0) {
    fail(
      `${collisions.length} name(s) declared as BOTH a command and a skill: ` +
        `${collisions.join(', ')}. Each is registered twice in one namespace, pays its ` +
        `always-on description cost twice, and resolves by no documented rule. ` +
        `Rename one side, or delete the redundant wrapper.`,
    );
  }
  console.log('OK: no name is declared as both a command and a skill.');
}

// --- optional live confirmation ---------------------------------------------
// Bonus only. Never changes the verdict above: CI must not depend on the CLI being
// installed, and a missing tool is not evidence of health.

let cliOut = null;
try {
  cliOut = execFileSync(
    'claude',
    ['--plugin-dir', pluginRoot, 'plugin', 'details', 'gru953-studio'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 },
  );
} catch {
  console.log('live check: skipped (claude CLI not available here)');
}

if (cliOut) {
  const m = cliOut.match(/Skills \((\d+)\)\s+(.*)/);
  if (!m) {
    console.log('live check: skipped (could not parse `plugin details` output)');
  } else {
    const reported = Number(m[1]);
    const names = m[2].split(',').map((s) => s.trim());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    console.log(
      `live check: CLI reports Skills (${reported}); local count ${total}; ` +
        `duplicate names in CLI output: ${dupes.length ? dupes.join(', ') : 'none'}`,
    );
    if (reported !== total) {
      console.log(
        `live check NOTE: CLI count ${reported} != local count ${total} — the platform's ` +
          `namespace rule may have changed. Re-read the primary docs before trusting either.`,
      );
    }
  }
}
