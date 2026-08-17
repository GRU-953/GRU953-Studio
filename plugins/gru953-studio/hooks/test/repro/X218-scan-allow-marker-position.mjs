#!/usr/bin/env node
//
// Reproduction for X218 (the code half of X205) — the scan-suppression marker is honoured ANYWHERE
// on a line, while the code's own comment says only a line ENDING in it is exempt.
//
// `scan.mjs` defines one deliberate opt-out:
//
//     const SCAN_ALLOW_MARKER = '// scan-allow: known test fixture';
//
// and its comment at :728-730 states the intent precisely: "only a line ENDING in the explicit
// marker ... is exempt — this marks ONE deliberately-annotated source line, not the string itself."
// Every enforcement site then tested `ln.includes(SCAN_ALLOW_MARKER)`, which is a different and
// weaker question. A line whose marker sits mid-line — inside a JSON string value, inside a
// `/* */` block, or before further code — was exempted too, so a real secret sharing that line was
// never reported.
//
// This is the narrowed, code half of X205. X205's severity was corrected DOWN to Medium for a good
// reason that still holds: the marker is an opt-out the pusher writes themselves, like
// `gitleaks:allow`, and the 33-character string appears in no skill, agent, command or document, so
// there is no honest path by which a user arrives at it. The finding is worth closing anyway on two
// grounds that have nothing to do with severity — the code contradicted its own stated contract,
// and ten enforcement sites each asked the question separately, which is how sites drift apart
// (L14: the same defect is worth fixing at every place carrying its shape). The register recorded
// SIX such sites; there are ten. That miscount is why the fix routes all of them through one named
// helper rather than correcting them one at a time.
//
//   case                                                              required
//   A  secret on a line ending in the marker                           exempt (control: the
//                                                                      legitimate opt-out survives)
//   B  secret on a line whose marker sits INSIDE a JSON string value   DENIED          <- X218
//   C  secret on a line with no marker at all                          DENIED (control: the
//                                                                      scanner still works)
//   D  this plugin's own tree, pushed from the root                    not refused (control: the
//                                                                      12 real trailing exemptions
//                                                                      in the test files still hold)
//
// Control D is the one that makes the tightening safe rather than merely stricter: 12 lines in this
// repository rely on the marker, and a fix that silently withdrew their exemption would turn a green
// suite red for a reason nobody would connect to this finding.
//
// Usage:
//   node X218-scan-allow-marker-position.mjs                # asserts the FIXED state
//   node X218-scan-allow-marker-position.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO_ROOT = join(HOOKS, '..', '..', '..');
const NODE = process.execPath;
const PUSH = ['git', 'push', 'origin', 'main'].join(' ');
const MARKER = '// scan-allow: known test fixture';
// Split so this reproduction's own source is not itself a secret-shaped line.
const KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function decide(cwd) {
  const v = refuseCrash(
    readDecision(NODE, join(HOOKS, 'scan.mjs'), {
      tool_name: 'Bash',
      tool_input: { command: PUSH },
      cwd,
    }),
    'X218',
    die,
  );
  return {
    decision: v.kind === 'silent' ? 'none' : v.decision,
    reason: (v.reason || '').replace(/\s+/g, ' '),
  };
}

// Two facts about scan.mjs that a probe repository must respect, both measured rather than assumed:
//
//   1. It stands aside ENTIRELY outside a studio project ("Not a studio project: never interfere"),
//      so a bare temp repo is never scanned and every case comes back `silent`. The probe therefore
//      carries a Dev-Memory/ folder.
//   2. An unignored Dev-Memory/ is refused on its own, by a differently-worded rule. That refusal
//      would mask the secret finding this reproduction is about, so Dev-Memory/ is GITIGNORED here
//      and the only thing left to refuse is the secret.
//
// Both were learned the hard way: the first version of this file used a bare repo, every case read
// `silent`, and control C caught it. That control existed because X188 established the rule — a
// check that cannot tell two causes apart reports whichever the author expected.
const SECRET_REASON = /secrets, key files/i;

/** A committed studio-shaped repo whose single source line is `line`. */
function repoWithLine(line, name) {
  const dir = mkdtempSync(join(tmpdir(), 'x218-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '**Objective:** probe\n');
  writeFileSync(join(dir, '.gitignore'), '/Dev-Memory/\n');
  writeFileSync(join(dir, name), line + '\n');
  writeFileSync(join(dir, 'README.md'), '# probe\n');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main', '.');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

function verdictFor(line, name) {
  const dir = repoWithLine(line, name);
  try {
    return decide(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- A: the marker as a trailing comment must still exempt ----------------------
{
  const got = verdictFor(`aws_key = '${KEY}' ${MARKER}`, 'fixture.js');
  if (got.decision === 'deny') {
    die(
      'control A failed: a secret on a line ENDING in the marker was refused. That is the one use ' +
        'the marker exists for, and 12 lines in this repository depend on it — so this is a broken ' +
        `fix, not a stricter one. Reason given: ${got.reason.slice(0, 200)}`,
    );
  }
  console.log(`  A  marker trailing, secret exempt ............... ${got.decision}   (control)`);
}

// ---- B: the marker mid-line must NOT exempt ------------------------------------
const bLine = `{"note": "${MARKER}", "aws_key": "${KEY}"}`;
const B = verdictFor(bLine, 'config.json');
const bExempted = B.decision !== 'deny';
if (!bExempted && !SECRET_REASON.test(B.reason)) {
  die(
    'case B refused, but not for the secret — so the fix cannot be credited with catching it. ' +
      `Reason given: ${B.reason.slice(0, 200)}`,
  );
}
console.log(
  `  B  marker inside a JSON string value ........... ${B.decision}${bExempted ? '   <- X218' : ', for the secret'}`,
);

// ---- C: no marker at all must be refused ---------------------------------------
{
  const got = verdictFor(`aws_key = '${KEY}'`, 'creds.js');
  if (got.decision !== 'deny') {
    die(
      'control C failed: a plain secret with no marker was not refused, so this run measures ' +
        'nothing — a scanner that refuses nothing would pass case B by accident. This is the control ' +
        'that caught the first draft of this file probing a NON-studio repo, where scan.mjs stands ' +
        `aside on purpose. Got ${got.decision}.`,
    );
  }
  if (!SECRET_REASON.test(got.reason)) {
    die(
      `control C refused for the wrong reason, so it proves nothing: ${got.reason.slice(0, 200)}`,
    );
  }
  console.log('  C  no marker, plain secret ..................... deny, for the secret (control)');
}

// ---- D: this plugin's own tree must still push clean ---------------------------
{
  const got = decide(REPO_ROOT);
  if (got.decision === 'deny') {
    die(
      "control D failed: this plugin's own tree is now refused. 12 lines here carry the marker as a " +
        'trailing comment; if the fix withdrew their exemption it has broken the repository it ships ' +
        `from. Reason given: ${got.reason.slice(0, 250)}`,
    );
  }
  console.log(`  D  this plugin's own tree, from the root ....... ${got.decision}   (control)`);
}

if (expectBug) {
  if (!bExempted) {
    die(
      'expected the X218 defect and did not find it. If it was fixed, remove this --expect-bug ' +
        'branch deliberately rather than leaving a check that can no longer fail.',
    );
  }
  console.log(
    '\nX218 REPRODUCED: the marker suppressed the scan from inside a JSON string value, so a real ' +
      'secret sharing that line went unreported.',
  );
  process.exit(0);
}

if (!bExempted) {
  console.log(
    '\nPASS: the marker exempts a line only as a trailing comment; a secret sharing a line with a ' +
      "mid-line marker is still refused, and the tree's own 12 exemptions hold.",
  );
  process.exit(0);
}

die(
  'X218 is OPEN: the marker was honoured inside a JSON string value. The enforcement sites ask ' +
    "`ln.includes(SCAN_ALLOW_MARKER)`, but scan.mjs's own comment at :728-730 says only a line " +
    'ENDING in the marker is exempt. Route every site through one named helper that asks the ' +
    'documented question, rather than correcting ten call sites separately.',
);
