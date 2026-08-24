#!/usr/bin/env node
//
// Reproduction for X286 — the documented opt-out silenced a REAL secret in files where `//` is not a
// comment at all.
//
// The marker exists for a good reason: a deliberate test fixture carrying a fake key would otherwise
// block every push in the repository that holds it. Its justification, in the product's own words, is
// "a maintainer annotating a deliberate test vector". `isScanAllowed` was
// `trimEnd().endsWith(SCAN_ALLOW_MARKER)` and asked nothing about the FILE, so `//` was treated as a
// comment introducer in every file on disk.
//
// In a Kubernetes secret manifest, a Makefile, a shell script or a JSON config, `//` is not an
// annotation. It is ordinary payload text that happens to sit at the end of the line, and the whole
// justification for the exemption fails. MEASURED AT THE PARENT — five files, five real AWS-shaped
// keys, every one exempted:
//
//   k8s-secret.yml          AWS_KEY: <KEY> // scan-allow: known test fixture   -> exempt
//   Makefile                AWS_KEY=<KEY> // scan-allow: known test fixture    -> exempt
//   deploy.sh               export AWS_KEY=<KEY> // scan-allow: …              -> exempt
//   config.json             {"aws_key": "<KEY>"} // scan-allow: …              -> exempt
//   docker-compose.env.txt  AWS_KEY=<KEY> // scan-allow: …                     -> exempt
//
// HOW IT WAS FOUND. X218's reproduction varies the marker's POSITION (trailing, mid-line, absent) and
// its SPELLING (case, internal whitespace, comment sigil), and it protects this project's own twelve
// exemptions with a whole-tree control. It passes. The axis it held still was the FILE TYPE: the only
// case that asserts the exemption SURVIVES is case A, and case A is always `fixture.js`.
//
// THE OWNER'S DECISION, 2026-08-24: require a comment sigil valid for that file's type — chosen over
// restricting the opt-out to a list of code extensions, because a `#` comment in a shell test fixture
// is perfectly legitimate and a rule that refused it would be refusing correct usage.
//
//   case                                                    required
//   A  `//` in a file where it is not a comment              the secret is still refused
//   B  `#` in a file where `#` IS the comment character      exempt — the opt-out still works
//   C  `#` in a .js file, where it is not a comment          the secret is still refused
//   D  control: `//` in a .js file                           exempt — the original case, unchanged
//   E  a format with no comments at all (json)               no opt-out exists, secret refused
//   F  control: a commit message                             either sigil works — see below
//   G  control: this plugin's own tree                        still pushable
//
// CASE F IS THE ONE DELIBERATE EXCEPTION and it is a test rather than an omission. A commit message
// has no file type, so no comment syntax can be established from one — and the person wrote that text
// deliberately; nobody's Kubernetes manifest becomes a commit message by accident. So both sigils are
// accepted there, via an explicit `AUTHORED_TEXT` sentinel rather than by the check quietly falling
// through.
//
// CONTROL G IS WHAT MAKES THIS SAFE TO SHIP. All five files in this project that carry the marker are
// `.mjs`, where `//` is exactly right — checked before the change was made rather than hoped for
// afterwards. If a future edit withdrew a real exemption, this control fails.
//
// NOTHING IS PUSHED. Each case builds a throwaway repository with no remote and hands the hook a
// payload on stdin. Every key is AWS's own reserved documentation placeholder.
//
// Usage:
//   node X286-marker-needs-a-comment.mjs                # asserts the fixed state
//   node X286-marker-needs-a-comment.mjs --expect-bug   # asserts the over-broad opt-out

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO = join(HOOKS, '..', '..', '..');

const problems = [];
const note = (s) => problems.push(s);

const KEY = `${'AKIA'}IOSFODNN7EXAMPLE`;
const SLASH = '// scan-allow: known test fixture';
const HASH = '# scan-allow: known test fixture';

function repoWith(file, body, commitMessage) {
  const dir = mkdtempSync(join(tmpdir(), 'x286-'));
  execSync(`git init -q ${dir}`);
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'Dev-Memory/\n', 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  const target = join(dir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${body}\n`, 'utf8');
  execSync('git add -A', { cwd: dir });
  execSync(
    `git -c user.email=t@example.invalid -c user.name=t commit -q -m ${JSON.stringify(commitMessage || 'fixture')}`,
    { cwd: dir },
  );
  return dir;
}

function push(cwd) {
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      cwd,
    }),
    encoding: 'utf8',
  });
  if (r.stderr && r.stderr.trim()) return `crashed: ${r.stderr.trim().split('\n')[0].slice(0, 90)}`;
  const out = (r.stdout || '').trim();
  if (!out) return 'silent';
  try {
    return JSON.parse(out).hookSpecificOutput.permissionDecision;
  } catch {
    return 'unparsed';
  }
}

// `deny` = the secret was reported. `ask` = it was exempted and only the publishing prompt remains.
const judge = (id, label, cases, want) => {
  const wrong = [];
  for (const [file, body, msg] of cases) {
    const dir = repoWith(file, body, msg);
    const got = push(dir);
    if (got !== want) wrong.push(`${file} -> ${got}`);
    rmSync(dir, { recursive: true, force: true });
  }
  if (wrong.length) {
    note(
      `case ${id}: ${wrong.length} of ${cases.length} ${label} — wanted ${want} ` +
        `(${want === 'deny' ? 'the secret reported' : 'the exemption honoured'}), got: ${wrong.join(', ')}`,
    );
    return;
  }
  console.log(`  ${id}  ${label.padEnd(48, '.')} ${want === 'deny' ? 'refused' : 'exempt'}`);
};

judge(
  'A',
  '`//` where it is not a comment',
  [
    ['k8s-secret.yml', `AWS_KEY: ${KEY} ${SLASH}`],
    ['Makefile', `AWS_KEY=${KEY} ${SLASH}`],
    ['deploy.sh', `export AWS_KEY=${KEY} ${SLASH}`],
    ['docker-compose.env.txt', `AWS_KEY=${KEY} ${SLASH}`],
  ],
  'deny',
);

judge(
  'B',
  '`#` where `#` IS the comment character',
  [
    ['k8s-secret.yml', `AWS_KEY: ${KEY} ${HASH}`],
    ['Makefile', `AWS_KEY=${KEY} ${HASH}`],
    ['deploy.sh', `export AWS_KEY=${KEY} ${HASH}`],
    ['vars.tf', `key = "${KEY}" ${HASH}`],
  ],
  'ask',
);

judge(
  'C',
  '`#` in a .js file, where it is not a comment',
  [['fixture.js', `const k = '${KEY}'; ${HASH}`]],
  'deny',
);

judge(
  'D',
  'control: `//` in a .js file — the original case',
  [
    ['fixture.js', `const k = '${KEY}'; ${SLASH}`],
    ['fixture.mjs', `const k = '${KEY}'; ${SLASH}`],
    ['fixture.ts', `const k = '${KEY}'; ${SLASH}`],
  ],
  'ask',
);

judge(
  'E',
  'a format with no comments at all',
  [
    ['config.json', `{"aws_key": "${KEY}"} ${SLASH}`],
    ['config.json', `{"aws_key": "${KEY}"} ${HASH}`],
  ],
  'deny',
);

judge(
  'F',
  'control: a commit message accepts either sigil',
  [
    ['a.js', 'const a = 1;', `token: ${KEY} ${SLASH}`],
    ['a.js', 'const a = 1;', `token: ${KEY} ${HASH}`],
  ],
  'ask',
);

// ---- G: control — this plugin's own tree must stay pushable --------------------
{
  const got = push(REPO);
  if (got === 'deny') {
    note(
      "control G: this plugin's own tree is now refused. Five files here carry the marker as a " +
        'trailing comment and all five are .mjs; if the fix withdrew a real exemption it has broken ' +
        'the project it protects, which is the failure that gets a guard switched off',
    );
  } else {
    console.log(`  G  control: this plugin's own tree ............... ${got}`);
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
  '\nPASS: the opt-out applies only where the marker is genuinely a comment, it still works wherever ' +
    "it is one, and this plugin's own exemptions are intact.",
);
