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
// There is a SECOND way through, on the same line of reasoning. The parse failure is
// swallowed:
//
//     try { ... } catch { /* invalid JSON here is repo-integrity's /
//                            licence-scan's concern, not this gate's */ }
//
// That comment is false, and it was checked rather than assumed: licence-scan.mjs reads
// the ROOT package.json (line 171), never the plugin's own, and repo-integrity.mjs does
// not read dependencies at all. So a manifest that cannot be parsed is reported by
// nobody, and DC6 treats "I could not read it" as "it is fine" — the exact inversion
// the project's own C8 rule forbids: a gate that cannot read its input must never claim
// its input is fine.
//
// The five cases below are the whole argument. B and E are the defects.
//
//   case                              README claim   dependency   DC6 fires?
//   A  honest violation               present        present      YES  <- the only one it catches
//   B  claim deleted, dep added       absent         present      no   <- X106, first half
//   C  claim present, no dep          present        absent       no   (correct)
//   D  neither                        absent         absent       no   (correct)
//   E  manifest unparseable           absent         unknown      no   <- X106, second half
//
// Usage:
//   node X106-disarmable-dependency-gate.mjs                # asserts the FIXED state
//   node X106-disarmable-dependency-gate.mjs --expect-bug   # asserts the DEFECT is present
//
// Both directions matter. --expect-bug proves this script can still detect the
// hole rather than having quietly become a no-op that passes whatever it sees —
// the exact failure the F4 regression test committed, where a test certified a
// broken fix by pinning the defect as its expected value.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..', '..', '..');            // .../plugins/gru953-studio
const repoRoot = join(pluginRoot, '..', '..');              // .../sandbox
const gate = join(pluginRoot, 'hooks', 'docs-consistency.mjs');

const CLAIM = 'zero third-party code dependencies';
// A marker present in every DC6 failure message and in no other check's, so we detect
// DC6 firing and never mistake another check's complaint about the skeleton fixture for
// it. Deliberately not the full sentence: the wording changes when the check is fixed,
// and a reproduction that breaks on rewording tests the prose, not the behaviour.
//
// It must also be stable ACROSS the fix, so the same script can prove red before and
// green after. "finding 29" is the historical id DC6 has always cited and the fixed
// messages keep citing. A first attempt used "zero-dependency", which the pre-fix
// message does not contain — control A caught that immediately, which is what it is for.
const DC6_SIGNAL = 'finding 29';

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
function dc6Fires({ claim, dependency, malformed }) {
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

    if (malformed) {
      // Truncated mid-write — the realistic shape, not a contrived string.
      writeFileSync(join(plugin, 'package.json'), '{"name":"fixture","dependencies":{"left-pad"');
    } else if (dependency) {
      writeFileSync(
        join(plugin, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: { 'left-pad': '^1.0.0' } }, null, 2),
      );
    }

    // Non-zero exit is the normal case for a skeleton repo, so the OUTPUT is what matters,
    // never the exit code. That left one gap: a gate that THREW also produced no marker, and
    // "no marker" is read below as "DC6 did not fire" — a defect verdict manufactured by a
    // gate that never ran. readGate() names the crash instead.
    const v = refuseCrash(readGate(process.execPath, gate, [dir]), 'X106-disarmable-dependency-gate.mjs', die);
    return v.raw.includes(DC6_SIGNAL);
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

// --- The defects. -------------------------------------------------------------
// B: the claim is deleted, so the conjunction can never be satisfied.
const B = dc6Fires({ claim: false, dependency: true });
console.log(`  case B    (claim DELETED + dependency) -> DC6 ${B ? 'fires' : 'SILENT'}`);

// E: the manifest cannot be parsed, so the property cannot be verified — and the
// swallowed catch reports that as no dependency. Checked, not assumed: licence-scan.mjs
// reads the ROOT package.json (line 171), not the plugin's, and repo-integrity.mjs does
// not read dependencies at all, so no other gate covers this.
const E = dc6Fires({ claim: false, dependency: false, malformed: true });
console.log(`  case E    (manifest UNPARSEABLE)       -> DC6 ${E ? 'fires' : 'SILENT'}`);

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

// The defect is DC6 staying SILENT on B or E, so --expect-bug passes when either is silent.
const open = [];
if (!B) open.push('B (claim deleted + real dependency)');
if (!E) open.push('E (manifest unparseable)');

if (expectBug) {
  if (open.length === 0) {
    die(
      'expected the X106 defect and did not find it: DC6 now fires both on a real dependency ' +
        'with the README claim deleted, and on a manifest it cannot parse. If it was fixed, ' +
        'delete this --expect-bug branch deliberately rather than leaving a reproduction that ' +
        'can no longer detect anything.',
    );
  }
  console.log(`\nX106 REPRODUCED: ${open.length} way(s) past the guard — ${open.join(', ')}.`);
  process.exit(0);
}

if (open.length === 0) {
  console.log(
    '\nPASS: the zero-dependency property is checked on its own terms — a declared dependency ' +
      'fails whatever the README says, and a manifest that cannot be read fails closed.',
  );
  process.exit(0);
}

die(
  `X106 is OPEN — ${open.join(' and ')}. ` +
    'DC6 checks whether the README is LYING, not whether the property HOLDS: it fires only when ' +
    'the claim and a real dependency are both present, so deleting the "' +
    CLAIM +
    '" sentence disarms it — while the guarantee stays asserted in CONTRIBUTING.md and in 18 ' +
    'shipped hook headers. And its swallowed parse error reports "cannot read" as "fine", which ' +
    'no other gate covers: licence-scan reads the ROOT manifest, repo-integrity reads no ' +
    'dependencies at all. ' +
    'Fix: test the dependency on its own, and fail closed when the manifest cannot be parsed.',
);
