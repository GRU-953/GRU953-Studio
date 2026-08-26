#!/usr/bin/env node
//
// Reproduction for X234 — L16 had never been applied to the tools whose whole job is counting.
//
// L16 is this programme's own rule: a tool that enumerates must report its count against an
// INDEPENDENT one. The Layer 2 completeness critic found it had been applied to the reproduction list
// and, self-caught, to a reference count — and never to `roster-check`'s role count, `repo-integrity`'s
// four-way census, `licence-scan`'s manifest results, or `content-check`'s asset counts. Its words:
// "Every one of those is a tool that counts and reports its own count — the definition of the L16 shape
// — and none was reconciled against an independent enumeration this round."
//
// WHAT THE RECONCILIATION FOUND, and it is worth stating plainly because it is not a defect: **every
// tool agrees.** 38 agents, 37 skills, 11 commands, 19 hooks, 41 reproductions, 4 licence manifests —
// each matching a count taken independently from the filesystem. The gap was in the VERIFICATION, not
// in the product.
//
// So this file exists to keep it that way. An agreement established once and never re-checked decays
// into an assumption, which is how "36 references" (X219) and "116x headroom" (X101) both went stale
// inside two days. This runs in the harness on every commit instead.
//
// IT IS A SECOND IMPLEMENTATION, DELIBERATELY. It counts by reading the directories itself rather than
// by calling the code it checks. A reconciliation that shares an implementation with its subject is
// L12 — a check comparing a thing to itself always says clean — and that is the defect this programme
// has found more often than any other.
//
//   case                                                        required
//   A  repo-integrity's four-way census vs the filesystem        every figure agrees
//   B  roster-check's role count vs `ls agents/*.md`             agrees
//   C  licence-scan's manifest results vs a manifest search      agrees
//   D  content-check's asset counts vs the register's rows       agree, and sum correctly
//   E  the harness's reproduction list vs the directory          every file on disk is named
//
// Case D also checks an INTERNAL consistency the other cases cannot: the three disposition counts must
// SUM to the asset total. X195's defect was a count that no independent count supported, and a total
// that does not add up is the same shape caught one level earlier.
//
// Usage:
//   node X234-enumerator-reconciliation.mjs                # asserts the reconciled state
//   node X234-enumerator-reconciliation.mjs --expect-bug    # not meaningful here; see below

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const PLUGIN = join(HOOKS, '..');
const REPO_ROOT = join(PLUGIN, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (expectBug) {
  // Stated rather than left as a silent no-op: this reproduction has no --expect-bug state to assert.
  // X234 is not a defect in the product — it is a verification that had never been performed. There is
  // no earlier commit at which the counts disagreed, so there is nothing for this branch to reproduce.
  // A reproduction whose --expect-bug branch cannot fail is X176's defect, so it says so instead of
  // pretending.
  console.log(
    'X234 has no --expect-bug state: it asserts an agreement that has always held, not a defect that ' +
      'was fixed. Run it without the flag.',
  );
  process.exit(0);
}

const run = (script, args) => {
  try {
    return JSON.parse(execFileSync(NODE, [join(HOOKS, script), ...args], { encoding: 'utf8' }));
  } catch (e) {
    try {
      return JSON.parse((e.stdout || '').toString());
    } catch {
      die(`${script} produced no readable JSON: ${String(e.message).slice(0, 160)}`);
    }
  }
  return null;
};

// ---- independent counts, read here rather than asked of the subject ---------------
const nAgents = readdirSync(join(PLUGIN, 'agents')).filter((f) => f.endsWith('.md')).length;
const nSkills = readdirSync(join(PLUGIN, 'skills'), { withFileTypes: true }).filter((d) =>
  d.isDirectory(),
).length;
const nCommands = readdirSync(join(PLUGIN, 'commands')).filter((f) => f.endsWith('.md')).length;
const nHooks = readdirSync(HOOKS).filter((f) => f.endsWith('.mjs')).length;
const repros = readdirSync(join(HOOKS, 'test', 'repro')).filter(
  (f) => f.endsWith('.mjs') && f !== '_verdict.mjs',
);

// ---- A: repo-integrity's census --------------------------------------------------
{
  const ri = run('repo-integrity.mjs', [REPO_ROOT]);
  const pairs = [
    ['agentCount', ri.agentCount, nAgents],
    ['skillCount', ri.skillCount, nSkills],
    ['commandCount', ri.commandCount, nCommands],
    ['hookCount', ri.hookCount, nHooks],
  ];
  const off = pairs.filter(([, got, want]) => got !== want);
  if (off.length) {
    die(
      'case A: repo-integrity reports a census that an independent count of the same directories ' +
        `contradicts: ${off.map(([k, g, w]) => `${k} reports ${g}, independently ${w}`).join('; ')}`,
    );
  }
  console.log(
    `  A  repo-integrity census ...................... agrees (${nAgents}/${nSkills}/${nCommands}/${nHooks})`,
  );
}

// ---- B: roster-check's role count -----------------------------------------------
{
  const rc = run('roster-check.mjs', [PLUGIN, REPO_ROOT]);
  if (typeof rc.currentCount !== 'number') {
    die(
      'case B: roster-check publishes no role count, so nothing can be reconciled against it. A tool ' +
        'that validates a number without stating it cannot be checked — publish the figure it ' +
        'validated against (L16).',
    );
  }
  if (rc.currentCount !== nAgents) {
    die(
      `case B: roster-check reports ${rc.currentCount} roles, an independent count of agents/*.md gives ${nAgents}`,
    );
  }
  console.log(`  B  roster-check role count .................... agrees (${nAgents})`);
}

// ---- C: licence-scan's manifests -------------------------------------------------
{
  const ls = run('licence-scan.mjs', [REPO_ROOT]);
  if (!Array.isArray(ls.results))
    die('case C: licence-scan publishes no results array to reconcile');
  // Independent: count package.json outside node_modules, .git and the packaged copy.
  const walk = (dir, acc = []) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git') continue;
      const p = join(dir, d.name);
      if (p.includes(`clients${'/'}cli${'/'}plugin`)) continue;
      if (d.isDirectory()) walk(p, acc);
      else if (d.name === 'package.json') acc.push(p);
    }
    return acc;
  };
  const independent = walk(REPO_ROOT).length;
  if (ls.results.length !== independent) {
    die(
      `case C: licence-scan reports ${ls.results.length} manifest result(s); an independent search of ` +
        `the same tree finds ${independent} package.json. A census that disagrees with a directory ` +
        'walk is reporting on something other than this tree.',
    );
  }
  console.log(`  C  licence-scan manifest census ............... agrees (${independent})`);
}

// ---- D: content-check's asset counts, and their internal sum ---------------------
{
  const golden = join(HOOKS, 'test', 'fixtures', 'dev-memory', 'golden');
  const cc = run('content-check.mjs', [golden]);
  if (typeof cc.assets !== 'number') {
    console.log(
      '  D  content-check asset counts ................. no register present, nothing to reconcile',
    );
  } else {
    const register = join(golden, 'Dev-Memory', 'CONTENT.md');
    const rows = existsSync(register)
      ? readFileSync(register, 'utf8')
          .split('\n')
          .filter((l) => l.trim().startsWith('|') && !/^\s*\|[\s:|-]+\|?\s*$/.test(l)).length - 1
      : 0;
    if (cc.assets !== rows) {
      die(
        `case D: content-check reports ${cc.assets} assets; the register has ${rows} data row(s)`,
      );
    }
    const sum =
      (cc.assetsExistenceChecked ?? 0) +
      (cc.assetsInAppCopyNoFile ?? 0) +
      (cc.assetsUnresolvable ?? 0);
    if (sum !== cc.assets) {
      die(
        `case D: content-check's three disposition counts sum to ${sum} but it reports ${cc.assets} ` +
          'assets. Every asset must land in exactly one disposition — a total that does not add up is ' +
          "X195's defect caught one level earlier.",
      );
    }
    console.log(
      `  D  content-check asset counts ................. agree (${cc.assets}, dispositions sum correctly)`,
    );
  }
}

// ---- E: the harness's reproduction list -----------------------------------------
{
  const harness = readFileSync(join(HOOKS, 'hooks.test.mjs'), 'utf8');
  const named = new Set(
    [...harness.matchAll(/'([A-Za-z0-9][A-Za-z0-9._-]*\.mjs)',/g)].map((m) => m[1]),
  );
  const orphans = repros.filter((f) => !named.has(f));
  if (orphans.length) {
    die(
      `case E: ${orphans.length} reproduction(s) sit on disk and are named by nothing in the harness, ` +
        `so they are run by nobody — that is X207 returning: ${orphans.join(', ')}`,
    );
  }
  console.log(
    `  E  harness reproduction list .................. agrees (${repros.length} on disk, all named)`,
  );
}

console.log(
  '\nPASS: every tool that publishes a count agrees with a count taken independently, and ' +
    "content-check's dispositions sum to its total.",
);
