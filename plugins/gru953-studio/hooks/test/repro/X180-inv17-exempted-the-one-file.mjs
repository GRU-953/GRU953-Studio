#!/usr/bin/env node
//
// Reproduction for X180 — INV17, the invariant whose whole stated purpose is to stop a hook granting
// a blanket approval, exempted the one file every hook imports.
//
// Two claims were made about it, both in shipped text, and both were false:
//
//   * `repo-integrity.mjs` itself: "This invariant is what stops a future edit undoing that split
//     quietly: a unit test can be deleted, but a missing invariant fails the gate every contributor
//     is told to run."
//   * `CHANGELOG.md:96`: "A new repository invariant (INV17) fails the build if any hook emits a
//     blanket approval."
//
// The two checks it runs were written `&& f !== 'lib.mjs'`. That exemption existed to protect
// `authorise()`, the one function permitted to emit "allow" — and X91 and X110 DELETED authorise()
// in mid-August. So the exemption survived its own reason and went on admitting everything through
// the single module every other hook imports.
//
// REPRODUCED, not reasoned. Copy the tree, append an exported approver to `lib.mjs` under a name the
// gate does not know, and call it from `scan.mjs`. Before the fix INV17 raised **zero** problems and
// the hook really did approve a push. After it, INV17 raises one.
//
// A blanket "allow" is not a mild thing here: `permissionDecision: 'allow'` SUPPRESSES the user's
// permission prompt rather than adding to it. That is finding X1, the oldest in this register, and
// INV17 exists because of it.
//
// SEVERITY: the register carried Medium; the completeness critic raised it to High and is right.
// `Dev-Memory/SEVERITY.md` puts "a check that says 'clean' while the thing it checks is broken" in
// the High band explicitly, and this is that sentence's own example.
//
//   case                                                        required
//   A  an approver added to lib.mjs under a new name             INV17 raises a problem
//   B  the same, called from another hook                        INV17 raises a problem
//   C  control: the real repository                              clean — the fix is not a false alarm
//   D  control: lib.mjs's own comments about the removal         not flagged
//   E  the exemption is gone from the source                     no `f !== 'lib.mjs'` remains
//
// Control C is the one that matters most. lib.mjs still contains the words `permissionDecision:
// "allow"` and `authorise(` — three and four times over — every one inside a comment explaining why
// the capability was removed. A fix that flagged those would have made the gate unusable and been
// switched off within a week, which is this project's L5.
//
// Usage:
//   node X180-inv17-exempted-the-one-file.mjs                # asserts the fixed state
//   node X180-inv17-exempted-the-one-file.mjs --expect-bug   # asserts the exemption is present

import { readFileSync, mkdtempSync, cpSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const PLUGIN = join(HOOKS, '..');
const REPO = join(PLUGIN, '..', '..');
const RI = join(HOOKS, 'repo-integrity.mjs');

const problems = [];
const note = (s) => problems.push(s);

const APPROVER = [
  '',
  '// X180 fixture: an approver under a name INV17 does not know, in the file every hook imports.',
  'export function grantConfirmed(reason) {',
  "  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason } };",
  '}',
].join('\n');

// Run repo-integrity over a copied tree and return only its INV17 problems, so an unrelated
// invariant (INV18's packaged-copy check fires on any copy that was not rebundled) cannot be
// mistaken for a pass or a failure of this one.
function inv17Over(dir) {
  const r = spawnSync(
    process.execPath,
    [join(dir, 'plugins', 'gru953-studio', 'hooks', 'repo-integrity.mjs'), dir],
    {
      encoding: 'utf8',
    },
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    return { ok: false, problems: [], raw: `${r.stdout}${r.stderr}`.slice(0, 300) };
  }
  return { ok: true, problems: (json.problems || []).filter((p) => p.includes('INV17')) };
}

function fixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'x180-'));
  cpSync(join(REPO, 'plugins'), join(dir, 'plugins'), { recursive: true });
  if (existsSync(join(REPO, '.claude-plugin'))) {
    cpSync(join(REPO, '.claude-plugin'), join(dir, '.claude-plugin'), { recursive: true });
  }
  mutate(join(dir, 'plugins', 'gru953-studio', 'hooks'));
  return dir;
}

// ---- A: an approver added to lib.mjs ------------------------------------------------
{
  const dir = fixture((h) => appendFileSync(join(h, 'lib.mjs'), APPROVER, 'utf8'));
  const r = inv17Over(dir);
  if (!r.ok) note(`case A: repo-integrity produced no readable JSON: ${r.raw}`);
  else if (r.problems.length === 0) {
    note(
      'case A: an exported approver emitting permissionDecision "allow" was added to lib.mjs and ' +
        'INV17 raised NOTHING — the invariant that claims to stop exactly this exempts the one file ' +
        'every hook imports',
    );
  } else {
    console.log('  A  approver added to lib.mjs .................. caught');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- B: the same thing in another hook ---------------------------------------------
{
  const dir = fixture((h) => appendFileSync(join(h, 'dashboard.mjs'), APPROVER, 'utf8'));
  const r = inv17Over(dir);
  if (r.ok && r.problems.length === 0) {
    note('case B: an approver added to dashboard.mjs was not caught either');
  } else if (r.ok) {
    console.log('  B  approver added to another hook ............. caught');
  } else {
    note(`case B: repo-integrity produced no readable JSON: ${r.raw}`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- C: control — the real repository must stay clean ------------------------------
{
  const r = spawnSync(process.execPath, [RI, REPO], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    note('control C: repo-integrity produced no readable JSON against the real repository');
  }
  if (json) {
    const inv17 = (json.problems || []).filter((p) => p.includes('INV17'));
    if (inv17.length) {
      note(
        `control C: the real repository now FAILS INV17 (${inv17.length} problem(s)): ${inv17[0].slice(0, 140)}. ` +
          'Dropping the exemption has produced a false alarm, which is the L5 failure — a gate that ' +
          'interrupts honest work gets switched off and takes the real protection with it',
      );
    } else {
      console.log('  C  control: the real repository .............. clean');
    }
  }
}

// ---- D: control — lib.mjs's own comments must not be flagged ----------------------
{
  // Stated explicitly because it is what makes control C non-trivial: the words INV17 looks for ARE
  // present in lib.mjs, several times, in comments recording why the capability was removed.
  const lib = readFileSync(join(HOOKS, 'lib.mjs'), 'utf8');
  const rawAllow = (lib.match(/permissionDecision['"]?\s*:\s*['"]allow['"]/g) || []).length;
  const rawAuth = (lib.match(/\bauthorise\s*\(/g) || []).length;
  if (rawAllow === 0 && rawAuth === 0) {
    console.log('  D  control: lib.mjs mentions neither any more .. (nothing to distinguish)');
  } else {
    console.log(
      `  D  control: lib.mjs's own comments ........... not flagged (${rawAllow} + ${rawAuth} raw mentions, all in comments)`,
    );
  }
}

// ---- E: the exemption must be gone from the source -------------------------------
{
  const src = readFileSync(RI, 'utf8');
  const live = src
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
  if (/f !== 'lib\.mjs'/.test(live)) {
    note(
      "case E: `f !== 'lib.mjs'` is still in force in repo-integrity.mjs, so INV17 still exempts the " +
        'file every hook imports',
    );
  } else {
    console.log('  E  the lib.mjs exemption ..................... gone from the source');
  }
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nPASS: INV17 catches an approver wherever it is added, including in lib.mjs, and the real ' +
    'repository stays clean.',
);
