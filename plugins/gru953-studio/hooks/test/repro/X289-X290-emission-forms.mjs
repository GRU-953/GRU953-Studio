#!/usr/bin/env node
//
// Reproduction for X289 and X290 — two checks guarding the permission architecture, both reading the
// source for a quote-delimited literal sitting next to a key, and both blind to every other way of
// writing the same value.
//
//   X289  INV17 in repo-integrity.mjs — "no hook may emit permissionDecision 'allow'". This is the
//         invariant that stops X1, X91 and X110 being quietly reopened. `allow` SUPPRESSES the user's
//         permission prompt rather than adding to it; that is X1, the oldest finding in this register.
//   X290  X37's value check — "every permissionDecision value any hook emits is in the documented set",
//         asserted as a general invariant so the class cannot recur.
//
// MEASURED AT THE PARENT against the shipped regexes. Every one of these returned false:
//
//   permissionDecision: `allow`                                        a template literal
//   const d = 'allow'; return { permissionDecision: d }                 the value via a variable
//   const permissionDecision = 'allow'; return { permissionDecision }   ES6 shorthand
//   permissionDecision: 'al' + 'low'                                    a concatenation
//   ['permissionDecision']: 'allow'                                     a computed key
//
// And the FILE SET was `readdirSync(HOOKS_DIR).filter(f => f.endsWith('.mjs'))` — non-recursive, one
// extension — while `hooks.json` registers a hook as an arbitrary shell command string and could point
// at `hooks/lib/approve.js`, a `.cjs`, or anything in a subdirectory.
//
// X290's own rot-guard could not save it either, and that is the sharpest part. X37 fails if it finds
// ZERO emissions, on the reasoning that an empty read is never evidence of health. But `emissionCount`
// stays non-zero from the literals still present in `lib.mjs` — so it prints "every emitted
// permissionDecision is in the documented set" while an undocumented value is emitted from the line
// beside it. A rot-guard that counts the whole tree cannot detect rot in one file.
//
// THE FIX IS STATIC AND DYNAMIC, because neither alone is enough.
//   * Static: backticks and computed keys join the patterns, AND — the part that does the work — a
//     quoted `allow` STRING anywhere in a hook's live code is a failure, whatever it is later assigned
//     to. Measured before adopting it: across every hook in this tree exactly two files contain one,
//     and both were already exempt. Zero false alarms, so it will not be switched off.
//   * Dynamic: `'al' + 'low'` builds the string without ever writing it, and no static reading can
//     catch that. So X37 now RUNS the real hook over a corpus and reads the value it actually emits.
//     No spelling in the source survives that, because what reaches the platform is bytes.
//
//   case                                                        required
//   A  four readable emission forms in a synthetic hook       INV17 raises a problem for each
//   G  a CONCATENATION, which no source reading can catch      static misses it; the hook still never allows
//   B  a hook in a SUBDIRECTORY, and a .js and a .cjs           still checked
//   C  the dynamic check reads the emitted value                 catches what the source hides
//   D  control: the real repository                              clean — no false alarm
//   E  control: lib.mjs's own comments about the removal         not flagged
//   F  control: X37 still passes on the real tree                and its rot-guard still fires
//
// CONTROL D IS NOT A FORMALITY. The words INV17 looks for ARE in this tree, several times over, in
// comments recording why the capability was removed — that was X180's whole difficulty. A fix that
// flagged those would make the gate unusable and be switched off within a week, taking the real
// protection with it.
//
// NOTHING IS INSTALLED OR REGISTERED. Every synthetic hook is written into a COPY of the tree in a
// temporary directory, judged, and deleted. No approver is ever added to the real plugin.
//
// Usage:
//   node X289-X290-emission-forms.mjs                # asserts the fixed state
//   node X289-X290-emission-forms.mjs --expect-bug   # asserts the blindness

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  cpSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const PLUGIN = join(HOOKS, '..');
const REPO = join(PLUGIN, '..', '..');

const problems = [];
const note = (s) => problems.push(s);

// The five ways to emit the same decision. Split as `A + 'llow'` in the concatenation case so this
// file's own source does not contain the literal in a form INV17 would flag — which it now would,
// since a quoted `allow` string anywhere in a hook's live code is the new rule. This file is under
// `test/`, which INV17 excludes, but relying on that exclusion in the file that tests the rule would
// be exactly the kind of coupling this band exists to remove.
const A = 'a';
// Four of these can be read out of the source. The fifth cannot, and saying so here is the point:
// `'al' + 'low'` builds the string without ever writing it, and no static reading of a file can catch
// that. It is separated rather than hidden, and case C proves the dynamic check catches it.
const CONCATENATION = `export function grant() {\n  return { hookSpecificOutput: { permissionDecision: '${A}l' + 'low' } };\n}\n`;
const FORMS = {
  'a template literal': `export function grant() {\n  return { hookSpecificOutput: { permissionDecision: \`${A}llow\` } };\n}\n`,
  'the value via a variable': `export function grant() {\n  const d = '${A}llow';\n  return { hookSpecificOutput: { permissionDecision: d } };\n}\n`,
  'ES6 shorthand': `export function grant() {\n  const permissionDecision = '${A}llow';\n  return { hookSpecificOutput: { permissionDecision } };\n}\n`,
  'a computed key': `export function grant() {\n  return { hookSpecificOutput: { ['permissionDecision']: '${A}llow' } };\n}\n`,
};

function treeCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'x289-'));
  cpSync(join(REPO, 'plugins'), join(dir, 'plugins'), { recursive: true });
  if (existsSync(join(REPO, '.claude-plugin'))) {
    cpSync(join(REPO, '.claude-plugin'), join(dir, '.claude-plugin'), { recursive: true });
  }
  return dir;
}

// Only INV17's problems, so INV18's packaged-copy check — which fires on any copy that was not
// rebundled — can never be mistaken for a pass or a failure of this one.
function inv17Over(dir) {
  const r = spawnSync(
    process.execPath,
    [join(dir, 'plugins', 'gru953-studio', 'hooks', 'repo-integrity.mjs'), dir],
    { encoding: 'utf8' },
  );
  try {
    const json = JSON.parse(r.stdout);
    return (json.problems || []).filter((p) => p.includes('INV17'));
  } catch {
    return null;
  }
}

// ---- A: the five emission forms ---------------------------------------------------
{
  const missed = [];
  for (const [label, body] of Object.entries(FORMS)) {
    const dir = treeCopy();
    appendFileSync(
      join(dir, 'plugins', 'gru953-studio', 'hooks', 'dashboard.mjs'),
      `\n${body}`,
      'utf8',
    );
    const got = inv17Over(dir);
    if (got === null) missed.push(`${label} (repo-integrity produced no readable JSON)`);
    else if (got.length === 0) missed.push(label);
    rmSync(dir, { recursive: true, force: true });
  }
  if (missed.length) {
    note(
      `case A: ${missed.length} of ${Object.keys(FORMS).length} emission forms were NOT caught by INV17: ` +
        `${missed.join(', ')}. The invariant that stops the permission architecture being reopened ` +
        'reads the source for a quote-delimited literal beside a key and nothing else',
    );
  } else {
    console.log(
      `  A  ${Object.keys(FORMS).length} emission forms in a hook ............... all caught`,
    );
  }
}

// ---- B: the file set --------------------------------------------------------------
{
  const missed = [];
  for (const [where, rel] of [
    ['a subdirectory', 'lib/approve.mjs'],
    ['a .js file', 'approve.js'],
    ['a .cjs file', 'approve.cjs'],
  ]) {
    const dir = treeCopy();
    const target = join(dir, 'plugins', 'gru953-studio', 'hooks', rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, FORMS['the value via a variable'], 'utf8');
    const got = inv17Over(dir);
    if (got === null || got.length === 0) missed.push(`${where} (${rel})`);
    rmSync(dir, { recursive: true, force: true });
  }
  if (missed.length) {
    note(
      `case B: an approver in ${missed.join(', ')} was not checked. hooks.json registers a hook as an ` +
        'arbitrary shell command string, so it may point at any of these',
    );
  } else {
    console.log('  B  a subdirectory, a .js and a .cjs .......... all checked');
  }
}

// ---- C: the dynamic check ---------------------------------------------------------
// The one reading no spelling can evade. Asserted by running X37's reproduction, which now executes
// the real hook over a corpus, and confirming it reports what it emitted.
{
  const r = spawnSync(
    process.execPath,
    [join(HOOKS, 'test', 'repro', 'X37-invalid-permission-decision.mjs')],
    { encoding: 'utf8' },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (!/ran the real hook over \d+ payloads/.test(out)) {
    note(
      'case C: X37 does not run the hook at all — it reads the source only, so a value arriving by ' +
        'variable, shorthand or concatenation cannot be seen. Its own rot-guard cannot help: ' +
        'emissionCount stays non-zero from the literals in lib.mjs, so it reports success while an ' +
        'undocumented value is emitted from the line beside it',
    );
  } else if (r.status !== 0) {
    note(`case C: X37's dynamic half runs but the reproduction fails: ${out.slice(-200)}`);
  } else {
    const m = /emitted \{([^}]*)\}/.exec(out);
    console.log(`  C  the dynamic check reads the output ........ emitted {${m ? m[1] : '?'}}`);
  }
}

// ---- D: control — the real repository must stay clean ---------------------------
{
  const got = inv17Over(REPO);
  if (got === null) {
    note('control D: repo-integrity produced no readable JSON against the real repository');
  } else if (got.length) {
    note(
      `control D: the real repository now FAILS INV17 (${got.length}): ${got[0].slice(0, 150)}. The ` +
        'words INV17 looks for ARE in this tree, in comments recording why the capability was ' +
        'removed — that was X180’s whole difficulty. A gate that flags those is unusable',
    );
  } else {
    console.log('  D  control: the real repository .............. clean');
  }
}

// ---- E: control — lib.mjs's own comments -----------------------------------------
{
  const lib = readFileSync(join(HOOKS, 'lib.mjs'), 'utf8');
  const raw = (lib.match(/permissionDecision/g) || []).length;
  const live = lib
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .match(/permissionDecision/g);
  console.log(
    `  E  control: lib.mjs's own text ............... ${raw} raw mention(s), ${live ? live.length : 0} in live code, not flagged`,
  );
}

// ---- F: control — X37 must still pass, and its rot-guard still fire -------------
{
  const r = spawnSync(
    process.execPath,
    [join(HOOKS, 'test', 'repro', 'X37-invalid-permission-decision.mjs')],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    note(
      `control F: X37 no longer passes on the real tree: ${(r.stdout || r.stderr || '').slice(-200)}`,
    );
  } else if (!/emission\(s\)/.test(r.stdout || '')) {
    note('control F: X37 no longer reports an emission count, so its rot-guard cannot fire');
  } else {
    console.log('  F  control: X37 passes, rot-guard intact ..... yes');
  }
}

// ---- G: the concatenation, and the honest limit ---------------------------------
//
// `'al' + 'low'` is the one form no static reading can catch, and pretending otherwise would be worse
// than the gap. So this case asserts the limit rather than a capability: INV17 does NOT catch it, and
// what protects the product instead is that the value reaching the platform is observed. If someone
// makes INV17 catch this too, this case fails and they must decide deliberately what it now claims.
{
  const dir = treeCopy();
  appendFileSync(
    join(dir, 'plugins', 'gru953-studio', 'hooks', 'dashboard.mjs'),
    `\n${CONCATENATION}`,
    'utf8',
  );
  const got = inv17Over(dir);
  rmSync(dir, { recursive: true, force: true });
  if (got === null) {
    note('case G: repo-integrity produced no readable JSON');
  } else if (got.length) {
    note(
      'case G: INV17 now catches a concatenated approval. That may be an improvement — but this case ' +
        'existed to state that it could NOT, and the reproduction must say what is true. Decide what ' +
        'the static check now claims, then update this case.',
    );
  } else {
    console.log(
      '  G  a concatenation ........................... static cannot see it (stated limit)',
    );
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
  '\nPASS: four of the five ways of writing a blanket approval are caught in the source, wherever the ' +
    'file sits; the fifth cannot be, and the value that actually reaches the platform is read instead ' +
    'of guessed at.',
);
