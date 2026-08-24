#!/usr/bin/env node
//
// Reproduction for X8 and X7 — "scan before every write" was documented and enforced by nothing, and
// no MCP tool was covered at all.
//
// `skills/dev-memory/SKILL.md` carries a section headed "Scan before every write — never skip". The
// only PreToolUse matcher was `Bash|PowerShell|Monitor|run_command`, so no `Write`, `Edit`,
// `MultiEdit` or `NotebookEdit` call ever reached the hook (X8), and no `mcp__*` tool did either
// unless its name happened to contain one of those four words (X7).
//
// WIDENING THE MATCHER ALONE WOULD HAVE MADE THINGS WORSE, and this file measured it BOTH ways rather
// than assuming one. `isPushCapable('')` fails closed to true on an empty command, so with the
// matcher widened and no content scan a write falls straight through into the push path — and what
// comes back depends on the project:
//
//   in a git repository        a `Write` of "hello world" returns **ask**, carrying the
//                              PUBLISHING-CONSENT prompt. A `Write` whose content holds an
//                              AWS-shaped key returns that same prompt saying "no secrets ... were
//                              found", because the scan looked at the git tree and never at the
//                              content being written.
//   NOT a git repository       every write returns **deny** — "not a git work tree; cannot prove the
//                              push set is clean". Reproduced at the parent commit by cases B, G1,
//                              G2 and I, which is how this second outcome was found: it was not
//                              predicted, it was measured.
//
// So the naive fix does not merely add noise, it can refuse every file write outright in any studio
// project that is not yet a git repository — which a brand-new project is. Cases B, G1, G2, I and K
// exist so no future change can reintroduce either outcome.
//
//   case                                                      required
//   A  Write whose content carries a key                       deny, naming the file and the line
//   B  Write with ordinary content                             silent
//   C  Edit whose new_string carries a key                      deny
//   D  MultiEdit with the key in a LATER edit                   deny
//   E  NotebookEdit whose new_source carries a key              deny
//   F  an mcp__ tool with a key anywhere in its input           deny
//   G  control: harmless Edit and harmless mcp__ input          silent
//   H  control: the same Write outside a studio project         silent — never interfere
//   I  control: the scan-allow marker on the line               silent — the documented opt-out
//   J  control: hooks.json actually names the write tools        the wiring exists
//   K  control: no write is ever asked about, or refused         the disaster case, both ways
//   L  a write carrying a stray command or script field         still scanned
//   M  an mcp__ input with a content key and a secret elsewhere  still scanned
//   N  control: the command paths are not swallowed              push and rm -rf still refuse
//
// Case D matters because the first thing a naive fix gets wrong is reading only `edits[0]`, which is
// the same shape as X10 (only the FIRST asset table) and X2 (only the FIRST Definition-of-Done table).
// Case I matters because the write scan must honour the SAME opt-out as the push scan; two different
// answers for one marker would be worse than either.
//
// The refusal names the LINE and the SHAPE and never the value, so a refusal message cannot leak the
// thing it refused. Case A asserts that too.
//
// NOTHING IS WRITTEN. Every case is a JSON payload handed to the hook on stdin; the hook decides and
// no file is created, because a PreToolUse decision happens before the tool runs.
//
// Usage:
//   node X7-X8-scan-before-every-write.mjs                # asserts the fixed state
//   node X7-X8-scan-before-every-write.mjs --expect-bug   # asserts the gap

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

// Split so the literal never appears in this file: the plugin's own scan reads this repository, and
// an unsplit example key here stops the project pushing itself. Every sibling reproduction splits it.
const KEY = `${'AKIA'}IOSFODNN7EXAMPLE`;

const problems = [];
const note = (s) => problems.push(s);

function studioProject() {
  const dir = mkdtempSync(join(tmpdir(), 'x8-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  return dir;
}
const STUDIO = studioProject();
// 2026-08-24: STUDIO is a studio project that is NOT a git repository, and case K could see only
// ONE of the two ways a write can be wrongly refused. In a git repo the fall-through outcome is the
// publishing-consent `ask`; here it is `deny: not a git work tree`. Case K's predicate matched only
// the first, so the reproduction passed while ordinary deletions were being DENIED — the outcome the
// commit message itself called the unpredicted, more dangerous one. Both environments now exist and
// case K checks both, because a control that can see one of two failure modes is a control that
// reports "locked out" while the lock is open.
const STUDIO_GIT = (() => {
  const dir = studioProject();
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  writeFileSync(join(dir, '.gitignore'), 'nothing\n', 'utf8');
  return dir;
})();
// A git repo with a TRACKED key, so case N can prove the push scan still fires after the restructure.
// Split so the literal never appears whole in this file — the project's own secret scan reads this
// repository, and an unsplit example key here stops the project pushing itself.
const PUSHREPO = (() => {
  const dir = studioProject();
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  writeFileSync(join(dir, '.gitignore'), 'nothing\n', 'utf8');
  writeFileSync(join(dir, 'creds.txt'), `aws_key = ${KEY}\n`, 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
  return dir;
})();
const PLAIN = mkdtempSync(join(tmpdir(), 'x8-plain-'));

function decide(payload) {
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'silent', reason: '' };
  try {
    const h = JSON.parse(out).hookSpecificOutput;
    return { decision: h.permissionDecision, reason: h.permissionDecisionReason || '' };
  } catch {
    return { decision: '(unparsed)', reason: out.slice(0, 160) };
  }
}

const call = (tool_name, tool_input, cwd = STUDIO) => decide({ tool_name, tool_input, cwd });

const expect = (id, got, want, what) => {
  if (got.decision !== want) {
    note(`case ${id}: ${what} -> ${got.decision}, expected ${want}`);
    return false;
  }
  console.log(`  ${id}  ${what.padEnd(46)} ${want}`);
  return true;
};

// ---- A: a Write carrying a key --------------------------------------------------
{
  const got = call('Write', { file_path: 'cfg.js', content: `const k = "${KEY}";` });
  if (expect('A', got, 'deny', 'Write whose content carries a key')) {
    if (got.reason.includes(KEY)) {
      note('case A: the refusal message contains the key itself — a refusal must never leak the value it refused');
    }
    if (!/line \d+/.test(got.reason)) {
      note(`case A: the refusal does not name a line, so a reader cannot find it: ${got.reason.slice(0, 140)}`);
    }
  }
}

// ---- B, C, D, E, F --------------------------------------------------------------
expect('B', call('Write', { file_path: 'notes.md', content: 'hello world' }), 'silent', 'Write with ordinary content');
expect('C', call('Edit', { file_path: 'a.js', new_string: `k = "${KEY}"` }), 'deny', 'Edit whose new_string carries a key');
expect(
  'D',
  call('MultiEdit', { file_path: 'a.js', edits: [{ new_string: 'fine' }, { new_string: `k = "${KEY}"` }] }),
  'deny',
  'MultiEdit with the key in a LATER edit',
);
expect('E', call('NotebookEdit', { new_source: `k = "${KEY}"` }), 'deny', 'NotebookEdit whose new_source carries a key');
expect('F', call('mcp__mailer__send', { body: `here is the key ${KEY}` }), 'deny', 'mcp__ tool with a key in its input');

// ---- G: controls — the harmless forms of the same tools -----------------------
expect('G1', call('Edit', { file_path: 'a.js', new_string: 'const x = 1;' }), 'silent', 'control: harmless Edit');
expect('G2', call('mcp__mailer__send', { body: 'hello' }), 'silent', 'control: harmless mcp__ input');

// ---- H: control — outside a studio project ----------------------------------
expect(
  'H',
  call('Write', { file_path: 'cfg.js', content: `const k = "${KEY}";` }, PLAIN),
  'silent',
  'control: the same Write, non-studio project',
);

// ---- I: control — the documented opt-out marker ------------------------------
expect(
  'I',
  call('Write', { file_path: 'fixture.js', content: `k = "${KEY}" // scan-allow: known test fixture` }),
  'silent',
  'control: the scan-allow marker is honoured',
);

// ---- J: control — the wiring exists ----------------------------------------
{
  const raw = readFileSync(join(HOOKS, 'hooks.json'), 'utf8');
  let matcher = '';
  try {
    const j = JSON.parse(raw);
    const events = j.hooks || j;
    for (const entries of Object.values(events)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (JSON.stringify(e).includes('scan.mjs')) matcher = String(e.matcher || '');
      }
    }
  } catch {
    /* reported below */
  }
  const missing = ['Write', 'Edit', 'mcp__'].filter((t) => !matcher.includes(t));
  if (missing.length) {
    note(
      `case J: hooks.json's PreToolUse matcher for scan.mjs does not name ${missing.join(', ')} ` +
        `(matcher is "${matcher}"), so those tool calls never reach the hook at all and every other ` +
        'case here is testing a code path the platform will not invoke',
    );
  } else {
    console.log('  J  control: hooks.json names the write tools     wired');
  }
}

// ---- K: control — no write may ever get the publishing prompt ----------------
{
  const bad = [];
  // A WRITE IS NOT A PUSH, and there are exactly two ways this hook can forget that: the
  // publishing-consent `ask`, and the `deny` it gives when it cannot prove a push set is clean
  // because there is no git repository. Both are the same defect wearing different clothes — the
  // call fell through to the push path — so the predicate names both. It was written against the
  // first alone, and the second is the one that was actually happening.
  const wronglyRefused = (got) =>
    got.decision === 'ask' ||
    got.decision === 'deny' ||
    /sends code out of your machine|fresh "yes"|not a git work tree/.test(got.reason);
  const PAYLOADS = [
    ['Write', { file_path: 'notes.md', content: 'hello world' }],
    ['Edit', { file_path: 'a.js', new_string: 'const x = 1;' }],
    ['MultiEdit', { file_path: 'a.js', edits: [{ new_string: 'fine' }] }],
    ['NotebookEdit', { new_source: 'print(1)' }],
    ['mcp__mailer__send', { body: 'hello' }],
    // EMPTY CONTENT — every one of these is an ordinary deletion, and not one was tested before.
    // Zero collected parts fell through to the push path, where `isPushCapable('')` fails closed to
    // push-capable, so deleting a line drew a consent prompt or an outright refusal.
    ['Write', { file_path: 'new.txt', content: '' }],
    ['Edit', { file_path: 'a.js', old_string: 'gone', new_string: '' }],
    ['MultiEdit', { file_path: 'a.js', edits: [{ old_string: 'gone', new_string: '' }] }],
    ['NotebookEdit', { cell_id: 'c1', edit_mode: 'delete' }],
  ];
  for (const [tool, input] of PAYLOADS) {
    for (const [envName, cwd] of [
      ['no git', STUDIO],
      ['git repo', STUDIO_GIT],
    ]) {
      const got = decide({ tool_name: tool, tool_input: input, cwd });
      if (wronglyRefused(got)) bad.push(`${tool} (${envName}) -> ${got.decision}`);
    }
  }
  if (bad.length) {
    note(
      `case K: ${bad.length} write-shaped call(s) were refused or challenged rather than allowed — ` +
        `${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ', …' : ''}. A write is not a push. This is ` +
        'the measured disaster case: an empty command fails closed to push-capable, so a call that ' +
        'reaches the push path at all draws a consent prompt in a git repo and an outright refusal ' +
        'in a studio project that is not yet one',
    );
  } else {
    console.log(
      `  K  control: ${PAYLOADS.length} writes × 2 environments ... never mistaken for a push`,
    );
  }
}

// ---- L: the stray-command bypass ---------------------------------------------
//
// 2026-08-24. The branch was gated on `if (!CMD)`, and `extractCommand()` reads `tool_input.command`,
// then `.script`, then `.CommandLine`. So ANY tool_input carrying one of those three field names
// switched the whole content scan off. This is not an exotic shape — `command` is one of the
// commonest MCP parameter names, and the mcp__ arm exists precisely for tools whose schema cannot be
// known, so the arm written for unknown tools was disabled by the commonest field an unknown tool
// has. Every payload below was SILENT at the parent and carries a key in plain sight.
{
  const missed = [];
  for (const [tool, input] of [
    ['Write', { command: 'echo hi', file_path: 'z.js', content: `k=${KEY}` }],
    ['Write', { script: 'echo hi', file_path: 'z.js', content: `k=${KEY}` }],
    ['Write', { CommandLine: 'echo hi', file_path: 'z.js', content: `k=${KEY}` }],
    ['Edit', { command: 'ls', file_path: 'a.js', new_string: `k=${KEY}` }],
    ['mcp__sh__exec', { command: 'echo hi', content: `k=${KEY}` }],
    ['mcp__x__run', { script: 'echo hi', content: `k=${KEY}` }],
  ]) {
    const got = decide({ tool_name: tool, tool_input: input, cwd: STUDIO });
    if (got.decision !== 'deny') {
      missed.push(`${tool} via ${Object.keys(input)[0]} -> ${got.decision}`);
    }
  }
  if (missed.length) {
    note(
      `case L: ${missed.length} write(s) carrying a key were not refused, because an unrelated command ` +
        `field switched the content scan off: ${missed.join(', ')}. The gate asked "does this payload ` +
        'have a command?" when the question is "does this payload write content?" — and the two are ' +
        'not mutually exclusive',
    );
  } else {
    console.log('  L  stray command/script/CommandLine field ..... still scanned');
  }
}

// ---- M: the mcp__ whole-input scan was gated on parts being empty --------------
//
// `take(ti.content)` ran for every tool, and the whole-input scan was `if (!parts.length && mcp__)`.
// So an MCP input carrying any harmless `content`, `new_string` or `new_source` string turned the
// whole-input scan off, and the same secret in the same field was refused or ignored depending on
// whether an unrelated key happened to be present beside it.
{
  const missed = [];
  for (const input of [
    { content: 'harmless', body: `k=${KEY}` },
    { new_string: 'harmless', payload: `k=${KEY}` },
    { new_source: 'harmless', nested: { deep: `k=${KEY}` } },
  ]) {
    const got = decide({ tool_name: 'mcp__x__put', tool_input: input, cwd: STUDIO });
    if (got.decision !== 'deny') missed.push(`${Object.keys(input).join('+')} -> ${got.decision}`);
  }
  // The control that makes this case mean anything: the SAME secret, in the SAME field, with the
  // harmless key removed. If this ever stopped denying, case M would be passing for the wrong reason.
  const control = decide({ tool_name: 'mcp__x__put', tool_input: { body: `k=${KEY}` }, cwd: STUDIO });
  if (control.decision !== 'deny') {
    note(`control M: the baseline mcp__ scan no longer denies at all (${control.decision})`);
  } else if (missed.length) {
    note(
      `case M: ${missed.join(', ')} — a harmless content key beside the secret switched the whole-input ` +
        'scan off, so the answer depended on an unrelated field being present',
    );
  } else {
    console.log('  M  mcp__ whole-input scan .................... runs regardless');
  }
}

// ---- N: control — fixing the above must not swallow the command paths ----------
//
// The repair moved the studio-project check and the exit out of the content branch. Get that wrong
// and a Bash command stops being scanned at all, trading a false negative on writes for a far worse
// one on pushes. So: a real push with a tracked key must still be refused, `rm -rf /` must still be
// refused, and a Write carrying a stray catastrophic command must reach X39 rather than being
// answered early by the write branch.
{
  const bad = [];
  const push = decide({
    tool_name: 'Bash',
    tool_input: { command: 'git push origin main' },
    cwd: PUSHREPO,
  });
  if (push.decision !== 'deny') bad.push(`a push with a tracked key -> ${push.decision}`);
  for (const [tool, input] of [
    ['Bash', { command: 'rm -rf /' }],
    ['Write', { command: 'rm -rf /', file_path: 'z', content: 'hi' }],
  ]) {
    const got = decide({ tool_name: tool, tool_input: input, cwd: STUDIO });
    if (got.decision !== 'deny') bad.push(`${tool} with rm -rf / -> ${got.decision}`);
  }
  // And an ordinary command outside a studio project must still be inspected rather than short-cut:
  // the old code stepped aside from INSIDE the content branch on `findStudioRoot() === null`, which
  // after the restructure would have skipped the push scan for every non-studio directory.
  const outside = decide({ tool_name: 'Bash', tool_input: { command: 'echo hello' }, cwd: PLAIN });
  if (outside.decision !== 'silent') {
    bad.push(`an ordinary echo outside a studio project -> ${outside.decision}`);
  }
  if (bad.length) {
    note(`control N: ${bad.join('; ')} — the repair has swallowed a command path`);
  } else {
    console.log('  N  control: push and rm -rf / ................. still refused');
  }
}

// Cleanup runs AFTER the last case, and that placement is load-bearing. It sat above cases L to N
// when they were first added, so every payload in them addressed a deleted directory, `findStudioRoot`
// returned null, and all three cases stepped aside reporting nothing. Case L looked like a clean
// failure and cases L and M would have been permanent no-ops — the X176 shape. What caught it was
// control M: the same secret in the same field with the harmless key removed, which must deny and
// did not. A case with no control cannot tell "the product is correct" from "my fixture is gone".
for (const d of [STUDIO, STUDIO_GIT, PUSHREPO, PLAIN]) {
  rmSync(d, { recursive: true, force: true });
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
  '\nPASS: every write-shaped tool call is scanned for secrets, in every field that carries content, ' +
    'silently unless it finds one — and no write is ever mistaken for a push.',
);
