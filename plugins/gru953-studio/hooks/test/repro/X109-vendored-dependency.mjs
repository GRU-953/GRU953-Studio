#!/usr/bin/env node
//
// Reproduction for X109 — third-party code copied INTO the plugin tree is invisible to
// the zero-dependency check, because that check reads the manifest and nothing else.
//
// THE GAP. X106 fixed the manifest check: a declared runtime dependency now fails
// whatever README.md says, and an unparseable manifest fails closed. But a dependency
// that is never declared — a compiled `.node`/`.dylib`, a bundled `node_modules/`, a
// library pasted in as a `.js` file — declares nothing, so the manifest stays empty and
// the check stays quiet. Meanwhile CONTRIBUTING.md and the header comment of 18 shipped
// hooks go on calling zero third-party dependencies "a deliberate, mechanically-checked
// property".
//
// WHY AN ALLOWLIST, NOT A LIST OF BANNED EXTENSIONS.
//
// The obvious approach is to look for `.node`, `.so`, `.dll`, `.dylib`, `.wasm`. That is
// the exact failure mode this whole family of findings is about: a check that only looks
// for what somebody thought of. X86 checked references but not coverage; X99 checked the
// register's internal shape but never compared it to its source; X106 checked whether a
// sentence was honest rather than whether the rule held. Each looked in the right
// direction and missed what was beside it.
//
// So the check is inverted. The plugin is 136 files: markdown, stdlib-only ES modules,
// a little JSON, and a licence. Nothing else has any business being there. Anything
// unanticipated therefore FAILS rather than passing unexamined — case D below is the
// whole argument, and a banned-extension list would sail straight past it.
//
// The cost is honest: a legitimately new file type makes this gate fail until someone
// widens the list on purpose. That is the intended behaviour, not a side effect, and the
// failure message says exactly how to do it — an over-strict gate that cannot be
// understood is an over-strict gate that gets switched off (lesson L5).
//
//   case                                                     required
//   A  clean fixture: only .md / .mjs / .json                 silent   (control)
//   B  a compiled .node binary in the tree                    FAILS
//   C  a bundled node_modules/ with a package inside          FAILS
//   D  a vendored library as a plain .js file                 FAILS    <- the allowlist's value
//   E  the REAL plugin tree                                   silent   (control)
//
// Controls A and E are load-bearing in opposite directions. A proves the check is not
// simply failing on everything; E proves it does not fail on the actual product, which
// is the difference between a working gate and one that gets disabled on day one.
//
// WHAT THIS DELIBERATELY DOES NOT COVER. A dependency fetched over the network at run
// time. `hooks/openrouter-models.mjs` legitimately uses Node's built-in fetch to read a
// public model catalogue, so "this plugin never fetches anything" is NOT a property this
// product has and must not be asserted as one. That half of X109 is disclosed as a
// residual rather than half-checked — see FINDINGS.md.
//
// Usage:
//   node X109-vendored-dependency.mjs                # asserts the FIXED state
//   node X109-vendored-dependency.mjs --expect-bug   # asserts the GAP is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..', '..', '..');       // .../plugins/gru953-studio
const repoRoot = join(pluginRoot, '..', '..');         // .../sandbox
const gate = join(pluginRoot, 'hooks', 'docs-consistency.mjs');

// A marker carried by every message this check emits, and by no other check in the file.
const SIGNAL = 'X109';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Run docs-consistency against `dir` and report whether the X109 check complained.
 *
 * A skeleton fixture fails many other checks; that is expected and irrelevant. We assert on
 * this check's own marker, never on the exit code, because an exit code cannot say WHICH
 * check objected.
 *
 * But "the marker is absent" had two causes and this function could not tell them apart: the
 * check stayed quiet, or the gate THREW before reaching it. Both returned false, and false
 * here means "the defect is present". readGate() names a crash so it can never be reported
 * as a finding.
 */
function fires(dir) {
  const v = refuseCrash(readGate(process.execPath, gate, [dir]), 'X109-vendored-dependency.mjs', die);
  return v.raw.includes(SIGNAL);
}

/** Build a minimal but well-formed plugin skeleton, then let `extra` add to it. */
function fixture(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x109-'));
  const plugin = join(dir, 'plugins', 'gru953-studio');
  mkdirSync(join(plugin, 'hooks'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Fixture\n');
  writeFileSync(join(plugin, 'ROSTER.md'), '# Roster\n');
  writeFileSync(join(plugin, 'hooks', 'noop.mjs'), '// nothing\n');
  writeFileSync(join(plugin, 'plugin.json'), '{"name":"fixture"}\n');
  if (extra) extra(plugin);
  try {
    return fires(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Control A: a clean tree must NOT trip the check. -------------------------
const A = fixture(null);
if (A) {
  die(
    'control A failed: a fixture containing only .md/.mjs/.json tripped the X109 check. ' +
      'It is failing on legitimate files, so every result below is meaningless.',
  );
}
console.log('  A  clean fixture (.md/.mjs/.json only) ......... silent   (as expected)');

// --- The three ways third-party code arrives without being declared. ----------
const B = fixture((p) => writeFileSync(join(p, 'hooks', 'fast.node'), 'BINARY'));
console.log(`  B  a compiled .node binary ..................... ${B ? 'FAILS  ' : 'SILENT '}${B ? '' : '<- gap'}`);

const C = fixture((p) => {
  mkdirSync(join(p, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(p, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
});
console.log(`  C  a bundled node_modules/ .................... ${C ? 'FAILS  ' : 'SILENT '}${C ? '' : '<- gap'}`);

const D = fixture((p) => writeFileSync(join(p, 'hooks', 'vendored-lib.js'), '/* a pasted-in library */\n'));
console.log(`  D  a vendored library as a plain .js ........... ${D ? 'FAILS  ' : 'SILENT '}${D ? '' : '<- gap'}`);

// --- Control E: the REAL plugin tree must still pass. --------------------------
// Without this, the check could be "correct" and still unusable, because it would fail
// on the product itself from the moment it shipped.
const E = fires(repoRoot);
if (E) {
  die(
    'control E failed: the real plugin tree trips the X109 check. Whatever it found is ' +
      'either a genuine vendored artefact — investigate before changing this test — or the ' +
      'allowlist is too narrow for files the product legitimately ships.',
  );
}
console.log('  E  the real plugin tree ....................... silent   (as expected)');

const gaps = [];
if (!B) gaps.push('B (compiled binary)');
if (!C) gaps.push('C (bundled node_modules)');
if (!D) gaps.push('D (vendored .js)');

if (expectBug) {
  if (gaps.length === 0) {
    die(
      'expected the X109 gap and did not find it: every form of vendored code is now caught. ' +
        'If it was fixed, delete this --expect-bug branch deliberately rather than leaving a ' +
        'reproduction that can no longer detect anything.',
    );
  }
  console.log(`\nX109 REPRODUCED: ${gaps.length} way(s) to add third-party code unnoticed — ${gaps.join(', ')}.`);
  process.exit(0);
}

if (gaps.length === 0) {
  console.log(
    '\nPASS: third-party code copied into the tree is caught — including as a file type ' +
      'nobody thought to ban, which is the point of checking what IS allowed rather than what is not.',
  );
  process.exit(0);
}

die(
  `X109 is OPEN — ${gaps.join(' and ')} passed unnoticed. The zero-dependency check reads the ` +
    'manifest and nothing else, so code that is never declared is never seen, while ' +
    'CONTRIBUTING.md and 18 hook headers keep calling the property mechanically checked. ' +
    'Fix: walk the plugin tree and allow only the file types it actually ships.',
);
