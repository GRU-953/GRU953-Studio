#!/usr/bin/env node
//
// Reproduction for X370 — five project-level gates that reported success for a root they
// could not read at all.
//
// ONE REPRODUCTION, FIVE CALL SITES, DELIBERATELY. This is X113/X115/X118's rule —
//
//     a check must FAIL when its input is missing, unreadable, or unrecognised
//
// — broken in the five places X115's fix was never carried across to. licence-scan.mjs was
// repaired for exactly this in X115 and answers `BLOCKED: cannot scan ... it does not exist`;
// its five siblings answered `{"status":"not a studio project"}` with exit 0 for the same
// input. All five are blocking Publish pre-flight checks, so a mistyped or unresolved path
// made five of them report success on work none of them had inspected.
//
// THE CRUCIAL DISTINCTION, which a careless fix would destroy. Three states must stay
// separate, and the old code collapsed the first two into one answer:
//
//   * root is a readable directory with no Dev-Memory/  -> stand down, exit 0. LOAD-BEARING:
//                                                          these gates run inside other
//                                                          people's repositories and in this
//                                                          repo itself, which has no
//                                                          Dev-Memory/ of its own.
//   * root does not exist / is a FILE / Dev-Memory is
//     a file                                           -> BLOCKED. The gate looked at nothing.
//   * root is a studio project                         -> proceed to the real checks.
//
// Every case below is paired with a control on the stand-down path, because a fix that made
// the first case fail would break the product for everyone who installs the plugin — and that
// is a worse outcome than the defect being reproduced here.
//
// WHY `Dev-Memory` AS A FILE IS A DEFECT AND NOT A STAND-DOWN. `isDirectory()` returns false
// for it, so the old code read it as "no studio project". A file with that name means the
// project marker is corrupt, which is not the same as there being no project, and answering
// clean hides it.
//
// Usage:
//   node X370-unreadable-root-reported-clean.mjs                # asserts the FIXED state
//   node X370-unreadable-root-reported-clean.mjs --expect-bug   # asserts the DEFECT is present

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

// The five gates that share the decision, named individually so a partial fix is visible
// rather than averaged away.
const GATES = [
  'verify-progress.mjs',
  'quality-gate.mjs',
  'traceability-check.mjs',
  'memory-integrity.mjs',
  'content-check.mjs',
];

/**
 * Run a gate against `dir`. Judged through readGate() so a CRASH is never mistaken for a
 * refusal — which matters especially here, because the defect under test is precisely a gate
 * being unable to read something, and a gate that threw would otherwise look like a gate that
 * correctly objected.
 */
function run(gate, dir) {
  const v = refuseCrash(readGate(NODE, join(HOOKS, gate), [dir]), `${gate} in X370`, die);
  return { code: v.code, out: v.raw, status: v.status };
}

function withTmp(build, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'x370-'));
  try {
    if (build) build(dir);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const open = [];

// ---- Case 1: a root that does not exist -------------------------------------------
{
  const missing = join(tmpdir(), 'x370-definitely-not-here-4b81ce');
  for (const g of GATES) {
    const r = run(g, missing);
    const objected = r.code !== 0;
    if (!objected) open.push(`${g} (nonexistent root)`);
    console.log(
      `  case  ${g.padEnd(24)} root does not exist ........ ${objected ? 'BLOCKS ' : 'exit 0 '}${objected ? '' : '<- defect'}`,
    );
  }
}

// ---- Case 2: a FILE used as a root --------------------------------------------------
withTmp(null, (d) => {
  const asFile = join(d, 'not-a-directory.md');
  writeFileSync(asFile, '# I am a file, not a project root\n');
  for (const g of GATES) {
    const r = run(g, asFile);
    const objected = r.code !== 0;
    if (!objected) open.push(`${g} (file as root)`);
    console.log(
      `  case  ${g.padEnd(24)} root is a FILE ............. ${objected ? 'BLOCKS ' : 'exit 0 '}${objected ? '' : '<- defect'}`,
    );
  }
});

// ---- Case 3: Dev-Memory exists but is a file, not a directory -----------------------
withTmp(
  (d) => writeFileSync(join(d, 'Dev-Memory'), 'not a directory\n'),
  (d) => {
    for (const g of GATES) {
      const r = run(g, d);
      const objected = r.code !== 0;
      if (!objected) open.push(`${g} (Dev-Memory is a file)`);
      console.log(
        `  case  ${g.padEnd(24)} Dev-Memory is a file ....... ${objected ? 'BLOCKS ' : 'exit 0 '}${objected ? '' : '<- defect'}`,
      );
    }
  },
);

// ---- Control A: a readable directory with no Dev-Memory must STILL stand down --------
// This is the control that matters most. Every gate here runs in ordinary checkouts,
// including this repository, which has no Dev-Memory/ of its own.
withTmp(
  (d) => writeFileSync(join(d, 'README.md'), '# someone else’s repository\n'),
  (d) => {
    for (const g of GATES) {
      const r = run(g, d);
      if (r.code !== 0) {
        die(
          `control failed: ${g} refused a readable directory that simply has no Dev-Memory/. ` +
            'These gates run inside other people’s repositories and in this repo itself — ' +
            'this "fix" would break the product for everyone who installs the plugin. ' +
            `Verdict was: ${r.status}`,
        );
      }
      if (!/not a studio project/.test(r.out)) {
        die(
          `control failed: ${g} exited 0 for a directory with no Dev-Memory/ but did not say ` +
            `"not a studio project" — the stand-down path must remain explicit, not silent. Got: ${r.out.slice(0, 160)}`,
        );
      }
    }
    console.log('  ctrl  all five ................ readable dir, no Dev-Memory . exit 0  (as expected)');
  },
);

// ---- Control B: a real studio project must get PAST the root check -------------------
// It will very likely BLOCK on its own missing files (that is X113's rule) — what this
// control proves is that the complaint is no longer about the ROOT being unreadable.
withTmp(
  (d) => mkdirSync(join(d, 'Dev-Memory'), { recursive: true }),
  (d) => {
    for (const g of GATES) {
      const r = run(g, d);
      if (/cannot inspect|is not a directory|marker is corrupt/.test(r.out)) {
        die(
          `control failed: ${g} treated a genuine studio project (Dev-Memory/ present) as an ` +
            `unreadable root. The root check is firing on valid input. Got: ${r.out.slice(0, 160)}`,
        );
      }
    }
    console.log('  ctrl  all five ................ real Dev-Memory/ present .... past the root check');
  },
);

// ---- verdict -------------------------------------------------------------------------
if (expectBug) {
  if (open.length === 0) {
    die(
      'expected the X370 defect and found none: all five gates now refuse a root they cannot ' +
        'read. If they were fixed, delete this --expect-bug branch deliberately.',
    );
  }
  console.log(
    `\nREPRODUCED: ${open.length} gate/case pair(s) still report success on a root they never read — ${open.join(', ')}.`,
  );
  process.exit(0);
}

if (open.length === 0) {
  console.log(
    '\nPASS: all five gates refuse a root that does not exist, a root that is a file, and a ' +
      'corrupt Dev-Memory marker — and all five still stand down for a readable directory that ' +
      'simply is not a studio project.',
  );
  process.exit(0);
}

die(
  `OPEN — ${open.join(', ')} still report success for a root they could not read. ` +
    'A gate that cannot read its input must never claim its input is fine (X113/X115/X118). ' +
    'Fix: classifyStudioRoot() in lib.mjs, which separates "readable root, no Dev-Memory" ' +
    'from "could not look".',
);
