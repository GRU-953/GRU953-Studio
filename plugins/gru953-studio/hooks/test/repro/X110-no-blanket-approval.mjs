#!/usr/bin/env node
//
// Reproduction for X110 — INV17 polices the blanket-approval capability in one file
// only, so any other hook may grant one unnoticed.
//
// THE DEFECT. `repo-integrity.mjs` carries INV17, the invariant that stops a future edit
// quietly restoring the silent approval that finding X1 removed. Its own comment says
// "only gate.mjs may call it". The code says something much narrower:
//
//     if (f === 'scan.mjs' && /\bauthorise\s*\(/.test(code)) { fail(...) }
//
// The line above it catches a hook that writes the literal string "allow" — but a hook
// that imports `authorise` from lib.mjs writes no such string, because the literal lives
// inside lib.mjs. So EVERY hook except scan.mjs could call authorise() and INV17 stayed
// quiet: the guard's stated rule and its enforced rule were different rules.
//
// WHY THIS MATTERED THE DAY IT WAS FOUND. X91's fix removed `authorise` from gate.mjs
// altogether — a record on disk cannot prove a person agreed, so the gate now asks
// instead of allowing. That left NO hook entitled to call authorise()... guarded by an
// invariant that could only see one file. The guard protecting today's fix could not
// see the thing it was protecting.
//
// THE FIX, and why it deletes rather than polices. `authorise()` existed to emit
// `allow`, which suppresses the user's permission prompt. Nothing may do that any more,
// so the function had no remaining caller and no permitted future one: dead code whose
// only purpose was to be misused. It is removed from lib.mjs, and INV17 now asserts the
// capability is ABSENT rather than merely confined. Removing a dangerous capability
// beats policing it — which is the whole lesson of this round of findings.
//
//   case                                              required
//   A  a benign hook using stepAside()                 silent   (control)
//   B  any hook calling authorise()                    FAILS    <- X110
//   C  scan.mjs calling authorise()                    FAILS    (control: worked before too)
//   D  lib.mjs exporting authorise()                   FAILS    <- the capability itself
//   E  a hook emitting the literal "allow"             FAILS    (control: worked before too)
//
// Controls A, C and E are load-bearing in both directions. C and E prove the harness
// genuinely reaches INV17, so "case B is silent" cannot be an artefact of the fixture
// never getting there. A proves INV17 is not simply failing on everything, which would
// make every other row meaningless.
//
// Usage:
//   node X110-no-blanket-approval.mjs                # asserts the FIXED state
//   node X110-no-blanket-approval.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..', '..', '..');
const repoRoot = join(pluginRoot, '..', '..');
const gate = join(pluginRoot, 'hooks', 'repo-integrity.mjs');

const MARKER = 'INV17';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Build a fixture whose hooks directory contains a minimal, INV17-clean lib.mjs, then
 * let `extra` add whatever the case is about. Returns the INV17 messages emitted.
 *
 * A skeleton trips many OTHER invariants; that is expected. We collect only lines
 * carrying the INV17 marker, because an exit code cannot say which invariant objected.
 */
function inv17Messages(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x110-'));
  try {
    const hooks = join(dir, 'plugins', 'gru953-studio', 'hooks');
    mkdirSync(hooks, { recursive: true });
    // A lib.mjs that satisfies INV17's own "both halves" requirement, so the baseline is
    // quiet and any message we see belongs to the case under test.
    writeFileSync(
      join(hooks, 'lib.mjs'),
      'export function stepAside() { process.exit(0); }\n' +
        'export function escalate(r) { console.log(String(r)); process.exit(0); }\n',
    );
    if (extra) extra(hooks);
    let out = '';
    try {
      out = execFileSync(process.execPath, [gate, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }
    // Parse the report rather than grepping its text. repo-integrity emits JSON, so the
    // quotes inside a message arrive escaped (`\"allow\"`) and a raw substring match on
    // `"allow"` silently finds nothing — which is how the first version of this script
    // reported a broken harness rather than a result. Parsing removes the whole class.
    try {
      const report = JSON.parse(out);
      return (report.problems || []).filter((p) => String(p).includes(MARKER));
    } catch {
      // Not JSON (a crash, or a future change of format): fall back to line matching, and
      // say so rather than silently returning nothing.
      const lines = out.split('\n').filter((l) => l.includes(MARKER));
      if (lines.length === 0 && out.trim() !== '') {
        die(`repo-integrity produced output this script could not parse as JSON:\n${out.slice(0, 400)}`);
      }
      return lines.map((l) => l.trim());
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sawAuthoriseCall = (msgs) => msgs.some((m) => /calls authorise\(\)/.test(m));
const sawAuthoriseExport = (msgs) => msgs.some((m) => /exports authorise\(\)/.test(m));
const sawLiteralAllow = (msgs) => msgs.some((m) => /emits permissionDecision "allow"/.test(m));

// --- Control A: a benign hook must not trip INV17. ----------------------------
const A = inv17Messages((h) =>
  writeFileSync(join(h, 'benign.mjs'), "import { stepAside } from './lib.mjs';\nstepAside();\n"),
);
if (A.length > 0) {
  die(`control A failed: a benign hook tripped INV17 (${A[0]}). It is failing on legitimate code, so nothing below means anything.`);
}
console.log('  A  benign hook using stepAside() ............... silent   (as expected)');

// --- Control E: the literal-"allow" check must still work. --------------------
const E = inv17Messages((h) =>
  writeFileSync(join(h, 'literal.mjs'), 'console.log(JSON.stringify({ permissionDecision: "allow" }));\n'),
);
if (!sawLiteralAllow(E)) {
  die('control E failed: a hook emitting the literal "allow" did not trip INV17. The harness is not reaching the invariant.');
}
console.log('  E  hook emitting literal "allow" .............. FAILS    (as expected)');

// --- Control C: the scan.mjs-specific check must still work. ------------------
const C = inv17Messages((h) =>
  writeFileSync(join(h, 'scan.mjs'), "import { authorise } from './lib.mjs';\nauthorise('x');\n"),
);
if (!sawAuthoriseCall(C)) {
  die('control C failed: scan.mjs calling authorise() did not trip INV17, though that is the one case the old code did cover.');
}
console.log('  C  scan.mjs calling authorise() ............... FAILS    (as expected)');

// --- Case B: ANY other hook calling authorise(). ------------------------------
const B = inv17Messages((h) =>
  writeFileSync(join(h, 'other.mjs'), "import { authorise } from './lib.mjs';\nauthorise('x');\n"),
);
const bCaught = sawAuthoriseCall(B);
console.log(`  B  a NON-scan hook calling authorise() ........ ${bCaught ? 'FAILS   ' : 'SILENT  '}${bCaught ? '' : '<- X110'}`);

// --- Case D: lib.mjs providing the capability at all. -------------------------
const D = inv17Messages((h) =>
  writeFileSync(
    join(h, 'lib.mjs'),
    'export function stepAside() { process.exit(0); }\n' +
      'export function escalate(r) { console.log(String(r)); process.exit(0); }\n' +
      'export function authorise(r) { console.log(String(r)); process.exit(0); }\n',
  ),
);
const dCaught = sawAuthoriseExport(D);
console.log(`  D  lib.mjs exporting authorise() .............. ${dCaught ? 'FAILS   ' : 'SILENT  '}${dCaught ? '' : '<- X110'}`);

// --- The real tree must stay clean. -------------------------------------------
let realOut = '';
try {
  realOut = execFileSync(process.execPath, [gate, repoRoot], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  realOut = `${e.stdout || ''}${e.stderr || ''}`;
}
let realInv17 = [];
try {
  realInv17 = (JSON.parse(realOut).problems || []).filter((p) => String(p).includes(MARKER));
} catch {
  realInv17 = realOut.split('\n').filter((l) => l.includes(MARKER));
}
if (realInv17.length > 0) {
  die(`the REAL plugin tree trips INV17: ${realInv17[0]}`);
}
console.log('  —  the real plugin tree ....................... silent   (as expected)');

const gaps = [];
if (!bCaught) gaps.push('B (a non-scan hook may call authorise)');
if (!dCaught) gaps.push('D (lib.mjs may still provide it)');

if (expectBug) {
  if (gaps.length === 0) {
    die(
      'expected the X110 defect and did not find it: INV17 now covers every hook and the ' +
        'capability itself. If it was fixed, delete this --expect-bug branch deliberately rather ' +
        'than leaving a reproduction that can no longer detect anything.',
    );
  }
  console.log(`\nX110 REPRODUCED: ${gaps.length} way(s) to restore a blanket approval unnoticed — ${gaps.join(', ')}.`);
  process.exit(0);
}

if (gaps.length === 0) {
  console.log(
    '\nPASS: no hook may call authorise(), and lib.mjs may not provide it. The capability is ' +
      'absent rather than merely confined.',
  );
  process.exit(0);
}

die(
  `X110 is OPEN — ${gaps.join(' and ')}. INV17's comment says "only gate.mjs may call it", but the ` +
    'code only tests `f === "scan.mjs"`, and a hook importing authorise from lib.mjs writes no ' +
    'literal "allow" for the neighbouring check to find. Since X91 removed authorise from ' +
    'gate.mjs, NO hook is entitled to call it. ' +
    'Fix: delete authorise() from lib.mjs and have INV17 assert the capability is absent.',
);
