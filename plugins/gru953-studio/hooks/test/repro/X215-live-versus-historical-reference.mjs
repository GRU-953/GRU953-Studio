#!/usr/bin/env node
//
// Reproduction for X215 — INV4 cannot tell a LIVE reference from a HISTORICAL one, so a
// changelog that honestly records a deleted file is treated as a broken link.
//
// THE DEFECT. INV4 asserts that every `hooks/<name>.mjs` mentioned anywhere in the repository
// exists on disk. For a live instruction that is exactly right: a skill telling a user to run a
// script that is gone is a broken product.
//
// For a RECORD it is the opposite. A changelog entry describing the day a hook was removed must
// name that hook — that is what the entry is. So must a findings register describing the defect
// that removed it. Under INV4 those files become unfixable: the only way to satisfy the check is
// to delete the history, which is falsifying the record to satisfy a check about records.
//
// This is not hypothetical. Removing the push-authorisation layer (X214) put INV4 into exactly
// that state: it blocked on CHANGELOG.md, Dev-Memory/FINDINGS.md and an archived plan, none of
// which is an instruction to anybody.
//
// THE DISTINCTION, and it is a property of the FILE, not of the sentence. A file is LIVE if the
// product reads it to decide what to do or tells a user to do something: skills, agents,
// commands, hooks, the plugin manifests, README. A file is a RECORD if its job is to describe
// what happened: CHANGELOG.md, anything under Dev-Memory/, AUDIT-*.md, archived plans. Records
// are exempt; everything else is not.
//
// WHY NOT JUST EXEMPT THE ONE FILE. Because the next removal hits the next record, and the fix
// after that exempts another — until the invariant covers nothing and still reports clean. The
// rule is stated once, by category, and the categories are named in the code.
//
//   case                                                      required
//   A  a SKILL naming a hook that does not exist               BLOCKED (control: the point of INV4)
//   B  an AGENT naming a hook that does not exist              BLOCKED (control)
//   C  a COMMAND naming a hook that does not exist             BLOCKED (control)
//   D  CHANGELOG.md naming a removed hook                      clean   <- X215
//   E  Dev-Memory/FINDINGS.md naming a removed hook            clean   <- X215
//   F  a skill naming a hook that DOES exist                   clean   (control: no false alarm)
//
// Cases A, B and C are the whole point: if the exemption is drawn too wide, a genuinely broken
// instruction stops being reported and this fix has removed a real check to silence a nuisance.
//
// Usage:
//   node X215-live-versus-historical-reference.mjs                # asserts the FIXED state
//   node X215-live-versus-historical-reference.mjs --expect-bug   # asserts the DEFECT is present

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

const GHOST = 'hooks/definitely-not-a-real-hook.mjs';

/** A minimal plugin skeleton INV4 can walk, plus whatever `extra` adds. */
function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x215-'));
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
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X215', die);
    return v.problems.filter((p) => String(p).includes('which does not exist'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const write = (rel, body) => (dir, plugin) => {
  const p = rel.startsWith('Dev-Memory') ? join(dir, rel) : join(plugin, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};
const atRoot = (rel, body) => (dir) => {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
};

// ---- A, B, C: a LIVE instruction naming a missing hook must still be reported ----
const LIVE = [
  ['A', 'skills/publisher/SKILL.md', `# Publisher\n\nRun \`node ${GHOST}\` before shipping.\n`],
  ['B', 'agents/publisher.md', `# publisher\n\nInvoke \`${GHOST}\` at the publish stage.\n`],
  ['C', 'commands/studio-ship.md', `# /studio-ship\n\nThis runs \`${GHOST}\`.\n`],
];
for (const [id, rel, body] of LIVE) {
  const problems = verdict(write(rel, body));
  if (problems.length === 0) {
    die(
      `control ${id} failed: ${rel} tells a user to run ${GHOST}, which does not exist, and INV4 ` +
        'said nothing. That is the defect INV4 exists to catch, and an exemption drawn wide ' +
        'enough to swallow it has removed a real check rather than fixed a nuisance.',
    );
  }
  console.log(`  ${id}  a live ${rel.split('/')[0].padEnd(8)} naming a missing hook .... BLOCKED (control)`);
}

// ---- D, E: a RECORD naming a removed hook must not be reported -------------------
const D = verdict(atRoot('CHANGELOG.md', `# Changelog\n\n## 7.0.0\n\n- Removed \`${GHOST}\`, which had become unfixable.\n`));
const dQuiet = D.length === 0;
console.log(`  D  CHANGELOG.md recording a removal ............... ${dQuiet ? 'clean  ' : 'BLOCKED'}${dQuiet ? '' : '  <- X215'}`);

const E = verdict(atRoot('Dev-Memory/FINDINGS.md', `# Findings\n\n| ID | Statement |\n| :-- | :-- |\n| X1 | \`${GHOST}\` was deleted |\n`));
const eQuiet = E.length === 0;
console.log(`  E  Dev-Memory/FINDINGS.md recording it ............ ${eQuiet ? 'clean  ' : 'BLOCKED'}${eQuiet ? '' : '  <- X215'}`);

// ---- G, H: the other two exempt categories, each with a reason ------------------
const G = verdict(write('hooks/test/repro/X999-something.mjs', `// a reproduction that must name ${GHOST}\n`));
if (G.length !== 0) {
  die(
    'control G failed: test material was reported. A reproduction of the does-not-exist case has ' +
      `to name a file that does not exist: ${G[0]}`,
  );
}
console.log('  G  a reproduction naming a missing hook .......... clean   (test material)');

const H = verdict(write('../../clients/cli/plugin/skills/x/SKILL.md', `# x\n\nRun \`${GHOST}\`.\n`));
if (H.length !== 0) {
  die(
    'control H failed: the packaged copy under clients/cli/plugin/ was reported. It is regenerated ' +
      `from the source this check already covers, and its staleness is X38, not INV4: ${H[0]}`,
  );
}
console.log('  H  the packaged copy under clients/cli/ ......... clean   (build output)');

// ---- F: no false alarm on a healthy live reference -------------------------------
const F = verdict(write('skills/ok/SKILL.md', '# OK\n\nRun `node hooks/real-hook.mjs`.\n'));
if (F.length !== 0) {
  die(`control F failed: a skill naming a hook that DOES exist was reported: ${F[0]}`);
}
console.log('  F  a skill naming a hook that exists ............. clean   (control)');

const open = [];
if (!dQuiet) open.push('CHANGELOG.md');
if (!eQuiet) open.push('Dev-Memory/FINDINGS.md');

if (expectBug) {
  if (open.length === 0) die('expected INV4 to block on a record and it did not. If this was fixed, delete this --expect-bug branch deliberately.');
  console.log(`\nX215 REPRODUCED: INV4 blocks on ${open.join(' and ')} for honestly recording a deleted hook.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log('\nPASS: a live instruction naming a missing hook is still reported; a record of one is not.');
  process.exit(0);
}

die(
  `X215 is OPEN: INV4 reports ${open.join(' and ')} for naming a hook that no longer exists. Those ` +
    'files exist to record what happened; the only way to satisfy the check is to delete the ' +
    'history, which is falsifying a record to satisfy a check about records. Fix: exempt files ' +
    'whose job is to describe the past, by category, and leave every live instruction covered.',
);
