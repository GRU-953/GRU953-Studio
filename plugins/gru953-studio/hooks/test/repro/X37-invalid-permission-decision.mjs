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

import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
//
// 2026-08-24, X290: this was `['"]([a-zA-Z_-]+)['"]` and so saw only a quote-delimited literal
// adjacent to the key. Backticks and computed keys are now included. A value arriving by variable,
// shorthand or concatenation still cannot be read from the source at all — and this file's own "the
// pattern has rotted" guard could not catch that either, because `emissionCount` stays non-zero from
// the literals elsewhere in `lib.mjs`, so it would print "every emitted permissionDecision is in the
// documented set" while an undocumented value was emitted from the line beside it.
//
// The answer is not a cleverer regex. Case B below RUNS the real hook over a corpus and reads the
// value it actually emits, which is the only reading that cannot be evaded by how the value is
// spelled. Static and dynamic together; neither alone closes the class X37 exists to close.
const EMIT_RE = /permissionDecision['"`]?\s*\]?\s*:\s*['"`]([a-zA-Z_-]+)['"`]/g;

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

// ---- the dynamic half: read what the hook actually EMITS ------------------------
//
// Whatever the source looks like, what reaches the platform is a JSON payload. Running the real hook
// over a corpus and reading the value out of its output is the one check that no spelling can evade:
// a variable, a template literal, ES6 shorthand and `'al' + 'low'` all produce the same bytes here.
{
  const CORPUS = [
    // Each shape is chosen to reach a different exit: a refusal, a consent ask, and silence.
    { tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
    { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    { tool_name: 'Bash', tool_input: { command: 'echo hello' } },
    { tool_name: 'Bash', tool_input: { command: 'scp x user@host:/tmp/' } },
    { tool_name: 'Write', tool_input: { file_path: 'a.js', content: 'const a = 1;' } },
    { tool_name: 'Write', tool_input: { file_path: 'a.js', content: '' } },
    { tool_name: 'Edit', tool_input: { file_path: 'a.js', old_string: 'x', new_string: '' } },
    { tool_name: 'mcp__x__put', tool_input: { body: 'hello' } },
    { tool_name: 'Bash', tool_input: {} },
    { tool_name: 'Bash' },
    {},
  ];
  const dir = mkdtempSync(join(tmpdir(), 'x37-'));
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'Dev-Memory/\n', 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  writeFileSync(join(dir, 'a.js'), 'const a = 1;\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });

  const emitted = new Set();
  let ran = 0;
  for (const payload of CORPUS) {
    const r = spawnSync(process.execPath, [join(hooksDir, 'scan.mjs')], {
      input: JSON.stringify({ ...payload, cwd: dir }),
      encoding: 'utf8',
    });
    ran += 1;
    const out = (r.stdout || '').trim();
    if (!out) continue;
    try {
      const v = JSON.parse(out).hookSpecificOutput.permissionDecision;
      if (typeof v === 'string') emitted.add(v);
    } catch {
      fail(`the hook produced output that is not a decision payload: ${out.slice(0, 120)}`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  const undocumented = [...emitted].filter((v) => !DOCUMENTED.has(v));
  if (undocumented.length) {
    fail(
      `the hook EMITTED ${undocumented.map((v) => JSON.stringify(v)).join(', ')}, which is not in the ` +
        'documented set. Read from the output, so no spelling of the value in the source can hide it.',
    );
  }
  if (emitted.size === 0) {
    fail(
      `ran the real hook over ${ran} payloads and it emitted no decision on any of them. Either the ` +
        'corpus no longer reaches a deciding path, or the hook has stopped deciding. Refusing to pass ' +
        'on a dynamic check that observed nothing — an empty read is never evidence of health.',
    );
  }
  if (emitted.has('allow')) {
    fail(
      'the hook emitted permissionDecision "allow", which SUPPRESSES the user\'s permission prompt ' +
        'rather than adding to it. That is finding X1, the oldest in this register.',
    );
  }
  console.log(
    `  ran the real hook over ${ran} payloads; emitted {${[...emitted].sort().join(', ')}} — all documented, none "allow"`,
  );
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
  console.log('OK: every emitted permissionDecision is in the documented set.');
}
