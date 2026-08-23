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
  for (const [tool, input] of [
    ['Write', { file_path: 'notes.md', content: 'hello world' }],
    ['Edit', { file_path: 'a.js', new_string: 'const x = 1;' }],
    ['MultiEdit', { file_path: 'a.js', edits: [{ new_string: 'fine' }] }],
    ['NotebookEdit', { new_source: 'print(1)' }],
    ['mcp__mailer__send', { body: 'hello' }],
  ]) {
    const got = call(tool, input);
    if (got.decision === 'ask' || /sends code out of your machine|fresh "yes"/.test(got.reason)) {
      bad.push(`${tool} -> ${got.decision}`);
    }
  }
  if (bad.length) {
    note(
      `case K: ${bad.join(', ')} received the publishing-consent prompt. A write is not a push. This ` +
        'is the measured disaster case: with the matcher widened and no content scan, an empty command ' +
        'fails closed to push-capable and every file write raises a consent prompt',
    );
  } else {
    console.log('  K  control: no write gets the publishing prompt  locked out');
  }
}

rmSync(STUDIO, { recursive: true, force: true });
rmSync(PLAIN, { recursive: true, force: true });

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
