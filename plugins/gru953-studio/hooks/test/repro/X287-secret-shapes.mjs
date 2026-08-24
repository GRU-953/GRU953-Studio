#!/usr/bin/env node
//
// Reproduction for X287 — the push scan's secret SHAPE was held at one vendor pattern and one quoted
// assignment, and the clean verdict gave a POSITIVE ASSURANCE it could not support.
//
// X214's reproduction varies the command form and the project state across nine labelled cases with
// four deny controls. An axis-enumeration lens asked what it held still, and the answer was the
// secret itself: `withSecret` writes exactly one line, `aws_key = AKIA…`, and `withKeyFile` writes
// exactly one name, `id_rsa`. Two fixtures, one vendor pattern, one filename — on the ONLY remaining
// protection on a push, X214 having removed the layer above it.
//
// WHY THIS IS WORSE THAN SILENCE, which is what makes it a High rather than a gap. Measured at the
// parent, one credential file per repo, `git push origin main`: every one returned `ask` carrying
//
//     "no secrets, keys or private Dev-Memory files were found in what this would ship"
//
// A silent miss leaves the user no worse informed. A positive assurance, given to a non-technical
// owner, about a scan that had no pattern for the thing sitting in the tree, actively misleads them.
// That is X195's shape — a verdict claiming coverage it does not have — on the last line of defence.
//
// SHAPES THAT PASSED AT THE PARENT: an .npmrc `_authToken`, a .netrc password line,
// `aws_secret_access_key` (unquoted, so SECRETVAR_RE could not match), a kubeconfig JWT, an unquoted
// `password: value` in YAML, a database URL carrying its password, and `.jks` / `.p12` / `.pfx` /
// `.ppk` private-key containers by name.
//
// THE OWNER'S DECISION, 2026-08-24, was BOTH halves: add the shapes AND correct the wording. Adding
// shapes narrows the gap; correcting the wording stops the product ever claiming a completeness it
// cannot have, because this list will never be finished. Case E is the wording, as a test.
//
//   case                                                    required
//   A  each credential shape, one file per repo              deny
//   B  the private-key containers, by name                   deny
//   C  control: the vendor pattern still works               deny
//   D  control: 23 ordinary lines that merely look like it   never flagged
//   E  the clean verdict does not over-claim                 says what it checked, not "none exist"
//   F  control: the clean verdict is still a CONSENT prompt  it still asks about publishing
//
// CONTROL D IS WHAT MAKES THE REST SAFE. `password: ${DB_PASSWORD}`, `<label>Password</label>`,
// `const passwordField = form.password`, "Enter your password to continue", `token: {{ vault_token }}`
// and a `postgres://` URL with no credentials are ordinary content in ordinary repositories. L15 in
// this project is "enumerate, never sweep": each new shape requires STRUCTURE — a registry key beside
// the npm token, all three words on a netrc line, a JWT's three base64url segments, a password
// between `:` and `@` — never a keyword. The first draft of the netrc shape fired on "machine
// learning login page password strength meter", which is why it is now pinned to the file format.
//
// NOTHING IS PUSHED. Every case hands the hook a payload on stdin against a throwaway repository with
// no remote. Every credential value is a documented example or an obvious dummy.
//
// Usage:
//   node X287-secret-shapes.mjs                # asserts the fixed state
//   node X287-secret-shapes.mjs --expect-bug   # asserts the gap

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

const problems = [];
const note = (s) => problems.push(s);

// A JWT built from its parts so no single literal in this file is a plausible token. The header is
// the standard `{"alg":"RS256","typ":"JWT"}` base64url-encoded, which is what makes `eyJ` structure
// rather than a guess.
const JWT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
].join('.');
const NPM_TOKEN = `npm_${'abcdefghij'}0123456789${'abcdefghij'}012345`;
const AWS_SECRET = `wJalrXUtnFEMI/${'K7MDENG'}/bPxRfiCYEXAMPLEKEY`;
// Assembled from parts for a reason worth recording. Written out whole, this line tripped the
// project's OWN push scan — via the very shape this finding adds — and `git push` on this repository
// was refused, naming this file and this line. The guard working exactly as intended, on its author.
//
// Then splitting it as `postgres://user:${'...'}@host` STILL tripped, and that second failure was the
// more useful one: a `${…}` between the colon and the at-sign is a VARIABLE REFERENCE, which is the
// correct way to write a database URL, and a pattern that refuses it refuses good practice. So the
// shipped shape now excludes interpolations, and control D pins four spellings of them.
const DB_USER = 'user';
const DB_PASS = 's3cr3tpassword';
const DB_URL = ['postgres://', DB_USER, ':', DB_PASS, '@host:5432/db'].join('');

function repoWith(file, body) {
  const dir = mkdtempSync(join(tmpdir(), 'x287-'));
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'Dev-Memory/\n', 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  const target = join(dir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${body}\n`, 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

function push(dir) {
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      cwd: dir,
    }),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'silent', reason: '' };
  try {
    const h = JSON.parse(out).hookSpecificOutput;
    return { decision: h.permissionDecision, reason: h.permissionDecisionReason || '' };
  } catch {
    return { decision: '(unparsed)', reason: out.slice(0, 120) };
  }
}

const judge = (id, label, cases, want) => {
  const wrong = [];
  for (const [file, body] of cases) {
    const dir = repoWith(file, body);
    const got = push(dir);
    if (got.decision !== want) wrong.push(`${file} -> ${got.decision}`);
    rmSync(dir, { recursive: true, force: true });
  }
  if (wrong.length) {
    note(
      `case ${id}: ${wrong.length} of ${cases.length} ${label} gave ${want === 'deny' ? 'no refusal' : `a refusal`}: ` +
        `${wrong.join(', ')}`,
    );
    return;
  }
  console.log(`  ${id}  ${label.padEnd(46, '.')} ${want}`);
};

// ---- A: each credential shape ------------------------------------------------------
judge(
  'A',
  'six credential shapes, one file per repo',
  [
    ['.npmrc', `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`],
    ['.netrc', 'machine github.com login me password hunter2hunter2'],
    ['aws/credentials', `[default]\naws_secret_access_key = ${AWS_SECRET}`],
    ['kubeconfig', `users:\n- user:\n    token: ${JWT}`],
    ['db.txt', `DATABASE_URL=${DB_URL}`],
    ['cfg.yml', 'database:\n  password: s3cr3tpassword123'],
  ],
  'deny',
);

// ---- B: the private-key containers, by name ------------------------------------
// Binary formats, so the content patterns cannot read them and the filename is the only evidence
// there is. `server.key` was already named; a Java keystore holding the same key was not.
judge(
  'B',
  'four private-key containers by name',
  [
    ['keystore.jks', 'binary-ish'],
    ['cert.p12', 'binary-ish'],
    ['bundle.pfx', 'binary-ish'],
    ['key.ppk', 'binary-ish'],
  ],
  'deny',
);

// ---- C: control — the vendor pattern must still work --------------------------
judge(
  'C',
  'control: the original vendor pattern',
  [
    ['creds.txt', `aws_key = ${'AKIA'}IOSFODNN7EXAMPLE`],
    ['id_rsa', 'not really a key'],
  ],
  'deny',
);

// ---- D: control — ordinary lines that merely resemble a secret ---------------
// Read against the SHIPPED patterns, pulled out of scan.mjs, so this control cannot pass by testing
// a copy that has drifted from what the hook uses.
{
  const src = readFileSync(join(HOOKS, 'scan.mjs'), 'utf8');
  const m = /const SECRET_SHAPES = \[([\s\S]*?)\n\];/.exec(src);
  if (!m) {
    note('control D: could not find SECRET_SHAPES in scan.mjs, so this control is testing nothing');
  } else {
    // eslint-disable-next-line no-eval -- reading the shipped array is the point; a hand-copied
    // duplicate here is exactly the X292/X241 defect this whole band is about.
    const shapes = eval(`[${m[1]}]`);
    const ordinary = [
      'password: ${DB_PASSWORD}',
      "password: ''",
      'password: <your-password-here>',
      '  password: null',
      'password: TODO',
      'PASSWORD=$PASSWORD',
      '// prompt the user for their password',
      '<label>Password</label>',
      'const passwordField = form.password;',
      'Enter your password to continue',
      'token: {{ vault_token }}',
      'See the password reset documentation for details.',
      'machine learning login page password strength meter',
      'the machine has a login form and a password field somewhere',
      'url: postgres://localhost:5432/mydb',
      'url: postgres://user@host:5432/db',
      // A variable reference in the password position is the CORRECT way to write this line. Four
      // spellings, because the first version of the shipped pattern refused all four.
      'url: postgres://user:${DB_PASSWORD}@host:5432/db',
      'url: postgres://user:{{ db_password }}@host/db',
      'url: mysql://user:%DB_PASS%@host/db',
      'url: mongodb+srv://user:<password>@cluster.example.net/db',
      "const jwt = require('jsonwebtoken');",
      'curl https://example.com/api?token=',
      'A password manager is recommended.',
    ];
    const wrong = ordinary.filter((l) => shapes.some((re) => re.test(l)));
    if (wrong.length) {
      note(
        `control D: ${wrong.length} ordinary line(s) matched a secret shape: ${wrong.map((w) => JSON.stringify(w)).join(', ')}. ` +
          'These are ordinary content in ordinary repositories; a scan that refused them would be ' +
          'switched off within the week and take the real protection with it',
      );
    } else {
      console.log(
        `  D  control: ${ordinary.length} ordinary look-alike lines ......... never flagged`,
      );
    }
  }
}

// ---- E: the clean verdict must not over-claim ---------------------------------
{
  const dir = repoWith('a.js', 'const a = 1;');
  const { decision, reason } = push(dir);
  rmSync(dir, { recursive: true, force: true });
  if (decision !== 'ask') {
    note(`case E: a clean tree gave ${decision}, so there is no clean verdict to read`);
  } else if (/no secrets, keys or private Dev-Memory files were found/.test(reason)) {
    note(
      'case E: the clean verdict still states flatly that no secrets were found. It cannot support ' +
        'that: it matches a fixed list of shapes, and the list will never be complete. Saying what ' +
        'was checked is both truer and more useful than saying nothing exists',
    );
  } else if (!/know how to recognise|shapes I have been taught|nothing known/i.test(reason)) {
    note(
      `case E: the clean verdict neither over-claims nor says what it actually checked: "${reason.slice(0, 140)}"`,
    );
  } else {
    console.log('  E  the clean verdict says what it checked ..... no over-claim');
  }
}

// ---- F: control — it is still a consent prompt --------------------------------
{
  const dir = repoWith('a.js', 'const a = 1;');
  const { decision, reason } = push(dir);
  rmSync(dir, { recursive: true, force: true });
  if (decision !== 'ask' || !/fresh "yes"|sends code out of your machine/i.test(reason)) {
    note(
      `control F: the clean verdict is no longer the publishing-consent prompt (${decision}). Rewording ` +
        'the reassurance must not remove the consent question underneath it',
    );
  } else {
    console.log('  F  control: it is still a consent prompt ...... asks about publishing');
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
  '\nPASS: ten credential shapes are refused, twenty-three ordinary look-alike lines are not, and the ' +
    'clean verdict says what it checked rather than claiming nothing exists.',
);
