#!/usr/bin/env node
// Reproduction for X37 — a hook emitting a `permissionDecision` value that does not exist.
//
// `lib.mjs` shipped `permissionDecision: 'escalate'` on the path added for
// independent-review finding F4 (a valid publish token blanket-approving anything bolted
// onto the push). The documented value set for a PreToolUse hook is:
//
//     allow | deny | ask | defer
//
// `escalate` is not in it. Verified 2026-08-15 by fetching the raw source of
// https://code.claude.com/docs/en/hooks.md (272,682 bytes) and grepping it, rather than
// trusting a summary — three separate summarised fetches of that page each returned a
// DIFFERENT answer for this one field. The word "escalate" occurs exactly once in the
// whole document, at line 1021, inside prose describing what `ask` does:
//
//     "Uses hookSpecificOutput for richer control: allow, deny, or escalate to the user."
//
// That single descriptive word is the trap. It reads exactly like a value name, and it
// sits in the events table where an implementer checking the API would look first.
//
// Why it matters: an unrecognised value means the hook renders no decision, so the call
// falls through to the normal permission flow — which is precisely the silent approval in
// auto mode that F4 was written to prevent. The correct value for "make the user confirm"
// is `ask`.
//
// This asserts the GENERAL invariant, not the single string, so the class cannot recur if
// the platform renames or adds a value (method M5 — fail closed by construction; the same
// shape as INV17, which was added after the previous enum mistake).
//
// Usage:
//   node X37-invalid-permission-decision.mjs                # asserts the FIXED state
//   node X37-invalid-permission-decision.mjs --expect-bug   # asserts the DEFECTIVE state
//
// Running both directions is the point: the first proves the fix holds, the second proves
// this reproduction can still detect the defect rather than having quietly become a no-op.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
// .../hooks/test/repro -> .../hooks
const hooksDir = join(here, '..', '..');

// The documented set, verified against the raw source on 2026-08-15.
// hooks.md:987   `permissionDecision` (allow/deny/ask/defer)
// hooks.md:1708  "four outcomes (allow, deny, ask, or defer)"
// hooks.md:1717  precedence is deny > defer > ask > allow
const DOCUMENTED = new Set(['allow', 'deny', 'ask', 'defer']);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(hooksDir)) {
  fail(`cannot read ${hooksDir} — refusing to report a verdict on input I could not read`);
}

const files = readdirSync(hooksDir).filter((f) => f.endsWith('.mjs'));

if (files.length === 0) {
  // Fail closed: an empty read is never evidence of health (method M5).
  fail(`found no .mjs files under ${hooksDir} — refusing to report a verdict`);
}

// Match an emitted literal, e.g.  permissionDecision: 'escalate'
// Deliberately does NOT match the identifier alone, so prose and comments that merely
// mention the field are not treated as emissions.
const EMIT_RE = /permissionDecision\s*:\s*['"]([a-zA-Z_-]+)['"]/g;

const offenders = [];
let emissionCount = 0;

for (const f of files) {
  const text = readFileSync(join(hooksDir, f), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    // Skip single-line comments so the documentation table inside lib.mjs — which
    // legitimately NAMES the values while describing them — is not counted as an emission.
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    for (const m of line.matchAll(EMIT_RE)) {
      emissionCount++;
      if (!DOCUMENTED.has(m[1])) {
        offenders.push({ file: basename(f), line: i + 1, value: m[1] });
      }
    }
  });
}

if (emissionCount === 0) {
  fail(
    'scanned every hook and found no permissionDecision emission at all. Either the hooks ' +
      'stopped emitting decisions, or this pattern has rotted. Refusing to pass.',
  );
}

console.log(
  `scanned ${files.length} hook file(s); ${emissionCount} permissionDecision emission(s); ` +
    `${offenders.length} outside the documented set {${[...DOCUMENTED].join(', ')}}`,
);

if (expectBug) {
  if (offenders.length === 0) {
    fail(
      '--expect-bug was given but every emitted value is documented. Either the defect is ' +
        'fixed (run without the flag) or this reproduction no longer detects it.',
    );
  }
  for (const o of offenders) {
    console.log(`reproduced X37: ${o.file}:${o.line} emits '${o.value}' — not a valid value`);
  }
} else {
  if (offenders.length > 0) {
    const list = offenders.map((o) => `${o.file}:${o.line} -> '${o.value}'`).join('; ');
    fail(
      `${offenders.length} hook emission(s) use an undocumented permissionDecision: ${list}. ` +
        `Valid values are ${[...DOCUMENTED].join(', ')}. An unrecognised value renders no ` +
        `decision, so the call falls through to the normal permission flow — the silent ` +
        `approval in auto mode that finding F4 exists to prevent. Use 'ask' to force a prompt.`,
    );
  }
  console.log("OK: every emitted permissionDecision is in the documented set.");
}
