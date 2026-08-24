#!/usr/bin/env node
//
// Reproduction for X284 — indirection was followed for exactly ONE hop, and one hop is not the shape
// of real deploy tooling. `deploy.sh` calls `build.sh`; `npm run release` calls `npm run push`.
//
// AND A MISS HERE IS NOT A WEAKER VERDICT. `isPushCapable` gates the whole content scan, so a command
// it does not recognise is not scanned at all: the staged key reaches the network with the hook
// silent. The failure is total, not partial, which is why depth was worth finding.
//
// MEASURED AT THE PARENT, against a committed studio repo with a tracked AWS-shaped key:
//
//   bash build.sh    deny          one hop — build.sh pushes directly
//   bash outer.sh    NO DECISION   outer.sh is `bash build.sh`
//   npm run chain    NO DECISION   scripts.chain is `npm run build`
//   make chain       NO DECISION   the recipe is `bash build.sh`
//
// Three further spellings of the same axis — "the runner" — were also unmodelled, and the parent
// reproduction held that constant at `npm` throughout: `yarn build` (yarn omits `run`, so the same
// script by the same route was silent while `pnpm run build` denied), `npm run --silent build`, and
// `source build.sh` / `. build.sh`.
//
// THIS WAS DISCLOSED, and that is the part worth being honest about. X15's row said "one level only
// (a script that runs another script is not followed)" and SECURITY.md said the same. A disclosed
// limitation is better than a hidden one, and it is not a substitute for the fix when the fix is
// eleven lines and the pattern for it was already in the same file — `unwrapShellText` has bounded
// itself at three levels since X227, for exactly this reason and with exactly this reasoning.
//
//   case                                                    required
//   A  two hops, all three mechanisms                        deny
//   B  three hops                                            deny
//   C  the unmodelled runner spellings                       deny
//   D  control: one hop still works                          deny
//   E  the bound is REAL: four hops is not caught            no decision, and this is the residual
//   F  a script that runs itself terminates                  no decision, no hang
//   G  control: ordinary commands                            silent
//
// CASE E IS AN ASSERTION, NOT AN OMISSION. Three hops is a bound, and a bound that is not tested is a
// claim. A four-deep chain that only pushes at the fourth hop IS still missed; this file states that
// in a test so the limit cannot be quietly forgotten or quietly overstated. If someone raises the
// depth, case E fails and they must decide deliberately what the new bound is.
//
// NOTHING IS PUSHED AND NO SCRIPT IS EXECUTED. Every command is a string handed to the hook on stdin.
// The fixture's `git push` lines are text inside files the hook READS; no remote exists.
//
// Usage:
//   node X284-transitive-indirection.mjs                # asserts the fixed state
//   node X284-transitive-indirection.mjs --expect-bug   # asserts the one-hop limit

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');

const problems = [];
const note = (s) => problems.push(s);

// Split so the literal never appears whole in this file: the project's own secret scan reads this
// repository, and an unsplit example key here stops the project pushing itself.
const KEY = `${'AKIA'}IOSFODNN7EXAMPLE`;

const DIR = mkdtempSync(join(tmpdir(), 'x284-'));
spawnSync('git', ['init', '-q', DIR], { encoding: 'utf8' });
mkdirSync(join(DIR, 'Dev-Memory'), { recursive: true });
writeFileSync(join(DIR, '.gitignore'), 'Dev-Memory/\n', 'utf8');
writeFileSync(join(DIR, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
// The tracked key that makes a push refusable. Without it every case would return the
// publishing-consent `ask` instead, and the file would be measuring the wrong thing.
writeFileSync(join(DIR, 'creds.txt'), `aws_key = ${KEY}\n`, 'utf8');
const w = (name, body) => writeFileSync(join(DIR, name), `${body}\n`, 'utf8');
w('build.sh', 'git push origin main');
w('outer.sh', 'bash build.sh');
w('outer2.sh', './build.sh');
w('outer3.sh', 'bash outer.sh');
w('h1.sh', 'git push origin main');
w('h2.sh', 'bash h1.sh');
w('h3.sh', 'bash h2.sh');
w('h4.sh', 'bash h3.sh');
w('self.sh', 'bash self.sh');
writeFileSync(
  join(DIR, 'package.json'),
  JSON.stringify({
    name: 't',
    scripts: {
      build: 'git push origin main',
      chain: 'npm run build',
      viash: 'bash build.sh',
      deep: 'npm run chain',
    },
  }),
  'utf8',
);
writeFileSync(
  join(DIR, 'Makefile'),
  'all:\n\tgit push origin main\nchain:\n\tbash build.sh\n',
  'utf8',
);
spawnSync('git', ['add', '-A'], { cwd: DIR, encoding: 'utf8' });

const decide = (command) => {
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: DIR }),
    encoding: 'utf8',
  });
  const out = (r.stdout || '').trim();
  if (!out) return 'no decision';
  try {
    return JSON.parse(out).hookSpecificOutput.permissionDecision;
  } catch {
    return '(unparsed)';
  }
};

const check = (id, label, commands, want) => {
  const wrong = commands.filter((c) => decide(c) !== want);
  if (wrong.length) {
    note(
      `case ${id}: ${wrong.length} of ${commands.length} ${label} gave the wrong answer (wanted ` +
        `${want}): ${wrong.map((c) => `${JSON.stringify(c)} -> ${decide(c)}`).join(', ')}`,
    );
    return;
  }
  console.log(`  ${id}  ${label.padEnd(46, '.')} ${want}`);
};

check(
  'A',
  'two hops, all three mechanisms',
  ['bash outer.sh', 'bash outer2.sh', 'npm run chain', 'npm run viash', 'make chain'],
  'deny',
);
check('B', 'three hops', ['bash outer3.sh', 'npm run deep'], 'deny');
check(
  'C',
  'the unmodelled runner spellings',
  ['yarn build', 'npm run --silent build', 'source build.sh', '. build.sh'],
  'deny',
);
check(
  'D',
  'control: one hop',
  ['bash build.sh', 'npm run build', 'make all', 'pnpm run build'],
  'deny',
);

// ---- E: the bound is real, and stated ------------------------------------------
{
  const four = decide('bash h4.sh');
  const three = decide('bash h3.sh');
  if (three !== 'deny') {
    note(
      `case E: the three-hop control is not denied (${three}), so this case is measuring nothing`,
    );
  } else if (four === 'deny') {
    note(
      'case E: four hops IS now caught, so the depth bound has been raised above three. That may well ' +
        'be right — but the new bound must be chosen deliberately, stated in resolveScriptChain and in ' +
        'SECURITY.md, and asserted here. Update this case rather than deleting it.',
    );
  } else {
    console.log('  E  the bound is real: four hops .............. not caught (disclosed residual)');
  }
}

// ---- F: a script that runs itself must terminate -------------------------------
{
  const started = process.hrtime.bigint();
  const got = decide('bash self.sh');
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (ms > 15000) {
    note(
      `case F: a self-referential script took ${Math.round(ms)} ms — the resolver is not bounded`,
    );
  } else if (got === 'deny') {
    note(
      `case F: a script whose only content is a call to itself was DENIED (${got}), which it should not be`,
    );
  } else {
    console.log(
      `  F  a script that runs itself ................. terminates (${Math.round(ms)} ms)`,
    );
  }
}

check(
  'G',
  'control: ordinary commands',
  ['npm test', 'yarn install', 'yarn add lodash', 'make', 'git status', 'echo hi', 'ls -la'],
  'no decision',
);

rmSync(DIR, { recursive: true, force: true });

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
  '\nPASS: indirection is followed to three hops through every mechanism and runner spelling, the ' +
    'bound is real and asserted, and a self-referential script terminates.',
);
