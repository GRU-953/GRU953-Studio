#!/usr/bin/env node
//
// Reproduction for X179 — git's DASHED BUILTIN form pushed with no decision from the push hook, so
// the secret scan was skipped entirely rather than downgraded.
//
// `git-push` and `git-send-pack` are real executables in `$(git --exec-path)`. On the machine this
// was found on, both are symlinks to `git`:
//
//   /opt/homebrew/opt/git/libexec/git-core/git-push       -> ../../bin/git
//   /opt/homebrew/opt/git/libexec/git-core/git-send-pack  -> ../../bin/git
//
// They perform the push without the words `git push` ever appearing, and `isPushCapable` modelled
// only the spaced forms. Measured through the real hook against a fixture carrying BOTH controls — a
// tracked `AKIA…`-shaped key and a non-gitignored `Dev-Memory/`:
//
//   git push origin main                       deny
//   $(git --exec-path)/git-push origin main    NO DECISION
//   git-push origin main                       NO DECISION
//   git-send-pack origin main                  NO DECISION
//
// NO DECISION, not a weaker one: `isPushCapable` gates the whole scan, so the secret was never
// looked for. A push that would have shipped an AWS-shaped key reached the network unexamined.
//
// THIS IS NOT THE OBFUSCATION CLASS SECURITY.md DISCLOSES. Nothing is hidden or encoded here — the
// command literally reads `git-push`. It is a documented invocation form the classifier had never
// modelled, which is a different thing from a residual that was weighed and accepted.
//
//   case                                                    required
//   A  the spaced forms                                      still push-capable (control)
//   B  the dashed builtins, bare                             push-capable
//   C  the dashed builtins by absolute libexec path          push-capable
//   D  a dashed builtin after a separator, and with --force  push-capable
//   E  control: `git-push-helper`                            NOT push-capable
//   F  control: ordinary commands mentioning the words       NOT push-capable
//   G  end to end: the real hook DENIES a dashed push        with the secret named
//
// Controls E and F are what stop this being an over-fix. A hyphen CONTINUES a program name, so
// `git-push-helper` is a different program; the first version of the fix caught it, because the
// project's shared LEXICAL_BOUNDARY permits a following hyphen. If an ordinary install script were
// swept up, the guard would be switched off within a week and take the real protection with it.
//
// NOTHING IS EXECUTED. Every case is a string handed to the classifier, or a JSON payload handed to
// the hook on stdin. No push, and no dashed builtin, is ever run.
//
// Usage:
//   node X179-dashed-git-builtins.mjs                # asserts the fixed state
//   node X179-dashed-git-builtins.mjs --expect-bug   # asserts the gap

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
// 2026-08-26, finding X356 (Windows-only; class: a filesystem path used where the ESM
// loader requires a URL). `import()` of a bare absolute path works on POSIX only —
// on the Windows runner join(HOOKS, 'lib.mjs') is 'D:\a\...\lib.mjs', which Node parses
// as a URL with scheme "d:" and rejects with ERR_UNSUPPORTED_ESM_URL_SCHEME. It throws
// during top-level evaluation, so this reproduction crashed before case A ran and the
// harness read the non-zero exit as "the defect is back". pathToFileURL() gives the
// right file:// URL on both platforms and resolves to the same module instance on POSIX.
// Idiom copied from X242 (9cb7c9e) into this file in d7f73be; already fixed once in the
// product code (repo-integrity.mjs, "2026-08 R3") and never carried into the tests.
const { isPushCapable } = await import(pathToFileURL(join(HOOKS, 'lib.mjs')).href);

const problems = [];
const note = (s) => problems.push(s);

// git's own answer for where its builtins live — read, never invoked for a push.
const execPath = (() => {
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '/usr/libexec/git-core';
})();

const check = (label, cases, wanted, caseId) => {
  const wrong = cases.filter((c) => isPushCapable(c) !== wanted);
  if (wrong.length) {
    note(
      `case ${caseId}: ${wrong.length} of ${cases.length} ${label} judged ` +
        `${wanted ? 'NOT push-capable' : 'push-capable'}: ${wrong.map((w) => JSON.stringify(w)).join(', ')}`,
    );
    return false;
  }
  console.log(`  ${caseId}  ${label.padEnd(44, '.')} ${wanted ? 'push-capable' : 'ignored'}`);
  return true;
};

// ---- A to F: the classifier, both directions ---------------------------------------
check(
  'the spaced forms (control)',
  ['git push origin main', 'git send-pack origin main'],
  true,
  'A',
);
check(
  'the dashed builtins, bare',
  ['git-push origin main', 'git-send-pack origin main'],
  true,
  'B',
);
check(
  'the dashed builtins by absolute path',
  [`${execPath}/git-push origin main`, `"$(git --exec-path)/git-send-pack" origin main`],
  true,
  'C',
);
check(
  'after a separator, and with --force',
  ['echo hi && git-push origin main', 'git-push --force origin main', 'git-push;'],
  true,
  'D',
);
check(
  'control: a LONGER hyphenated name',
  ['git-push-helper origin main', 'git-push-upstream x', 'git-send-pack-shim y'],
  false,
  'E',
);
check(
  'control: ordinary commands naming the words',
  ['echo hello', 'git status', 'npm run git-pusher', 'cat my-git-push-notes.md'],
  false,
  'F',
);

// ---- G: end to end, through the real hook ------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x179-'));
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'nothing\n', 'utf8');
  // Split so the literal never appears in this file: the plugin's own secret scan reads this
  // repository, and an unsplit example key here stops the project pushing itself. Every sibling
  // reproduction splits it for the same reason.
  writeFileSync(join(dir, 'creds.txt'), `aws_key = ${'AKIA' + 'IOSFODNN7EXAMPLE'}\n`, 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });

  const decide = (command) => {
    const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }),
      encoding: 'utf8',
    });
    const out = (r.stdout || '').trim();
    if (!out) return 'NO DECISION';
    try {
      return JSON.parse(out).hookSpecificOutput.permissionDecision;
    } catch {
      return '(unparsed)';
    }
  };

  const shouldDeny = [
    'git-push origin main',
    `${execPath}/git-push origin main`,
    'git-send-pack origin main',
  ];
  const undecided = shouldDeny.filter((c) => decide(c) !== 'deny');
  if (undecided.length) {
    note(
      `case G: the real hook returned no denial for ${undecided.length} dashed push form(s) against a ` +
        `fixture carrying a tracked AWS-shaped key: ${undecided.join(', ')}. The scan is skipped ` +
        'entirely, not downgraded — the secret is never looked for.',
    );
  } else {
    console.log('  G  end to end: the hook denies a dashed push ... deny, naming the secret');
  }
  // And the control end to end, so the fix cannot be a blanket denial.
  const helper = decide('git-push-helper origin main');
  if (helper === 'deny') {
    note(
      `control G: the hook now DENIES "git-push-helper origin main" (${helper}). A hyphen continues a ` +
        'program name, so that is a different program and an ordinary script would be blocked.',
    );
  } else {
    console.log('  G· control: git-push-helper end to end ....... no decision');
  }
  rmSync(dir, { recursive: true, force: true });
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
  "\nPASS: git's dashed builtins are push-capable in every form tested, a longer hyphenated name is " +
    'not, and the real hook denies a dashed push that would ship a secret.',
);
