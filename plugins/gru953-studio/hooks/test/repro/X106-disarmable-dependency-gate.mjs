#!/usr/bin/env node
// Reproduction for X106 — the zero-dependency gate is disarmed by deleting the
// sentence it guards.
//
// `CONTRIBUTING.md` and the header comment of 18 shipped hook scripts describe
// "zero third-party runtime dependencies" as "a deliberate, mechanically-checked
// property". The mechanism is DC6 in `docs-consistency.mjs`:
//
//     if (claimsZeroDependencies && hasRealDependency) fail(...)
//
// It fires only when BOTH are true. So it does not check the property. It checks
// whether the README is lying about the property — and the cheapest way to stop
// lying is to stop claiming. Remove the sentence and a real dependency passes
// unnoticed, while CONTRIBUTING.md and 18 file headers go on describing the
// guarantee as mechanically checked.
//
// This is the same class as X86 (the memory audit reports `clean` on a graph
// missing 91% of lessons) and X99 (the register was never compared with its
// source): every one of them verifies internal agreement rather than the truth
// of the thing guarded.
//
// The four cases below are the whole argument. Case B is the defect.
//
//   case                              README claim   dependency   DC6 fires?
//   A  honest violation               present        present      YES  <- the only one it catches
//   B  claim deleted, dep added       absent         present      no   <- X106
//   C  claim present, no dep          present        absent       no   (correct)
//   D  neither                        absent         absent       no   (correct)
//
// Usage:
//   node X106-disarmable-dependency-gate.mjs                # asserts the FIXED state
//   node X106-disarmable-dependency-gate.mjs --expect-bug   # asserts the DEFECT is present
//
// Both directions matter. --expect-bug proves this script can still detect the
// hole rather than having quietly become a no-op that passes whatever it sees —
// the exact failure the F4 regression test committed, where a test certified a
// broken fix by pinning the defect as its expected value.

import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..', '..', '..');            // .../plugins/gru953-studio
const repoRoot = join(pluginRoot, '..', '..');              // .../sandbox
const gate = join(pluginRoot, 'hooks', 'docs-consistency.mjs');

const CLAIM = 'zero third-party code dependencies';
// The exact wording DC6's own failure message uses, so we detect DC6 firing and
// never mistake some other check's failure for it.
const DC6_SIGNAL = 'finding 29 has regressed';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Build a throwaway repo containing only what DC6 reads, run the gate against it,
 * and report whether DC6 specifically fired.
 *
 * Every other check in docs-consistency.mjs will also complain about this skeleton;
 * that is expected and irrelevant. We assert on DC6's own message, never on the
 * exit code, because an exit code cannot tell us WHICH check failed.
 */
function dc6Fires({ claim, dependency }) {
  const dir = mkdtempSync(join(tmpdir(), 'x106-'));
  try {
    const plugin = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(plugin, { recursive: true });

    writeFileSync(
      join(dir, 'README.md'),
      claim
        ? `# Fixture\n\nThis plugin has ${CLAIM}.\n`
        : '# Fixture\n\nA README that simply does not mention dependencies at all.\n',
    );

    if (dependency) {
      writeFileSync(
        join(plugin, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: { 'left-pad': '^1.0.0' } }, null, 2),
      );
    }

    let out = '';
    try {
      out = execFileSync(process.execPath, [gate, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // Non-zero exit is the normal case for a skeleton repo. The output is what matters.
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }
    return out.includes(DC6_SIGNAL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Control first: prove the fixture harness can make DC6 fire at all. -------
// Without this, "case B does not fire" would be unfalsifiable — a harness that
// never triggers the gate would report the defect whether or not it exists.
const A = dc6Fires({ claim: true, dependency: true });
if (!A) {
  die(
    'control case A did not fire: a README carrying the claim WITH a real dependency ' +
      'should trip DC6. The harness is not reaching the gate, so nothing below can be trusted.',
  );
}
console.log('  control A (claim + dependency) -> DC6 fires ..................... as expected');

// --- Correctness controls: DC6 must stay silent when there is no violation. ---
if (dc6Fires({ claim: true, dependency: false })) die('case C fired: a truthful claim with no dependency must not fail.');
console.log('  control C (claim, no dependency) -> silent ...................... as expected');
if (dc6Fires({ claim: false, dependency: false })) die('case D fired: no claim and no dependency must not fail.');
console.log('  control D (neither) -> silent ................................... as expected');

// --- The defect: claim deleted, dependency added. -----------------------------
const B = dc6Fires({ claim: false, dependency: true });
console.log(`  case B    (claim DELETED + dependency) -> DC6 ${B ? 'fires' : 'SILENT'}`);

// --- Second half of the finding: the guarantee is still asserted elsewhere. ---
// The hole only matters because other files keep promising the property. If a
// future fix deletes those promises instead of fixing the gate, this count drops
// and the assertion below should be revisited deliberately, not silently.
let assertedElsewhere = 0;
const contributing = join(repoRoot, 'CONTRIBUTING.md');
if (existsSync(contributing)) {
  try {
    const txt = execFileSync('grep', ['-c', '-i', 'zero third-party', contributing], { encoding: 'utf8' });
    assertedElsewhere = Number(txt.trim()) || 0;
  } catch {
    assertedElsewhere = 0; // grep exits 1 on no match
  }
}
console.log(`  the guarantee is still asserted in CONTRIBUTING.md ${assertedElsewhere} time(s)`);

// The defect IS DC6 staying silent in case B, so --expect-bug passes when B is false.
if (expectBug) {
  if (B) {
    die(
      'expected the X106 defect and did not find it: DC6 fired on a real dependency even with ' +
        'the README claim deleted, so the gate now checks the property rather than the claim. ' +
        'If DC6 was fixed, delete this --expect-bug branch deliberately rather than leaving a ' +
        'reproduction that can no longer detect anything.',
    );
  }
  console.log('\nX106 REPRODUCED: deleting the README sentence disarms the gate that guards it.');
  process.exit(0);
}

if (B) {
  console.log('\nPASS: DC6 now fires on a real dependency regardless of what the README claims.');
  process.exit(0);
}

die(
  'X106 is OPEN: DC6 checks whether the README is lying, not whether the property holds. ' +
    'Delete the "' +
    CLAIM +
    '" sentence and a real dependency passes unnoticed, while the guarantee stays asserted ' +
    'in CONTRIBUTING.md and in 18 shipped hook headers. ' +
    'Fix: test hasRealDependency on its own, and treat the README claim as a separate check.',
);
