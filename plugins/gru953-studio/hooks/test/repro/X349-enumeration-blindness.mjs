#!/usr/bin/env node
//
// Reproduction for X349 — the push scan built its file list from three `git` calls and threw away
// whether any of them SUCCEEDED, so a failed enumeration produced an empty would-ship set, the scan
// found nothing in it, and the verdict told the owner in plain words that it had looked.
//
// scan.mjs:1128 read `git(...).stdout` three times and never `.ok`. Fourteen lines below, the
// force-add branch always had the correct form — `if (out.ok) for (const p of ...)` — so this file
// knew the right shape in one place and not in the other three. That is L14 exactly: fix every place
// carrying the shape. Found 2026-08-25 by a sweep for the shape behind X348, which was the same
// mistake in clients/cli/src/autoupdate.js.
//
// WHY THIS IS WORSE THAN SILENCE, which is what makes it a High. On a repository whose index git
// cannot read, the parent produced `ask` carrying
//
//     "I checked what this would send for the kinds of secret I know how to recognise … and found
//      none."
//
// Nothing had been checked. Zero files were enumerated. A non-technical owner reads that sentence,
// says yes, and publishes the key. The message even hedges about which SHAPES it knows while saying
// nothing about having looked at no files at all — a verdict claiming coverage it does not have,
// which is X195's shape, on the last line of defence before a push.
//
// THE FIXTURE IS THE SAME REPOSITORY IN CASES A AND B. That is the whole design. One temp repo with
// one plaintext AWS key tracked in it; case B pushes it and must be REFUSED, case A pushes it with
// git's own enumeration broken and must not be told the tree is clean. Any claim that the scan
// "found none" in case A is therefore demonstrably false, by construction, in the same run.
//
// HOW THE ENUMERATION IS BROKEN, and why it has to be this exact way. `GIT_INDEX_FILE` is pointed at
// a DIRECTORY, so `git ls-files` and `git diff --cached` fail while `git rev-parse
// --is-inside-work-tree` still succeeds. That distinction is the whole reachability argument, and the
// first draft of this reproduction got it wrong: pointing `GIT_DIR` at a missing path breaks the
// work-tree check too, and scan.mjs ALREADY guards that — it answers `deny`, "not a git work tree;
// cannot prove the push set is clean". So the interesting case is not "git is broken", it is "git
// works well enough to look like a repository and not well enough to list it", which is what an
// unreadable or corrupt index actually is. Control E pins the already-correct guard so the two are
// never confused again.
//
// Deliberately NOT `chmod 000` on the index: POSIX mode bits are ADVISORY ON WINDOWS, so a
// permissions-based fixture would silently break nothing there and this case would pass on the
// Windows leg by never being exercised. That is finding X347, which CI caught in this very directory
// earlier today. An environment variable behaves identically on all three platforms.
//
// MEASURED AT THE PARENT (a207b57), same fixture, same command:
//     ask — "studio scan: I checked what this would send for the kinds of secret I know how to
//            recognise ... and found none."
// on a repository with `aws_access_key_id = AKIA…EXAMPLE` tracked in it.
//
//   case                                                              required
//   A  a repo with a tracked key, index unreadable                   says UNCHECKED, never "found none"
//   B  control: the SAME repo with git working                        deny
//   C  control: a genuinely clean repo with git working               may still say "found none"
//   D  control: a broken enumeration must not REFUSE the push         not deny (L5: no crying wolf)
//   E  control: a broken WORK TREE is a different, older guard        still deny, and says so
//
// CONTROL C IS WHAT STOPS THE OVER-FIX. The honest reassurance must survive when the scan really did
// run; a fix that removed the "found none" wording altogether would pass A and D and be wrong.
// CONTROL D IS THE OTHER HALF: `deny` on a transient git failure is a gate that cries wolf, and a
// gate that cries wolf gets switched off (L5). `ask` is the decided architecture — fail closed to
// asking the person, with the reason named.
//
// NOTHING IS PUSHED. Every case hands the hook a payload on stdin against a throwaway repository
// with no remote. The key is AWS's own documented example value.
//
// Usage:
//   node X349-enumeration-blindness.mjs                # asserts the fixed state
//   node X349-enumeration-blindness.mjs --expect-bug   # asserts the defect

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

// AWS's own documented example access key id, assembled so no single literal in this file is a
// plausible credential. This project's own push scan reads its own reproductions.
const AWS_KEY = `AKIA${'IOSFODNN'}7EXAMPLE`;

function repo(withKey) {
  const dir = mkdtempSync(join(tmpdir(), 'x349-'));
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'Dev-Memory/\n', 'utf8');
  writeFileSync(join(dir, 'Dev-Memory', 'FOCUS.md'), '# focus\n', 'utf8');
  // NOT named `*.env`: scan.mjs flags credential files BY NAME, so a fixture called config.env is
  // denied for its name whatever is inside it — which would have made control B pass without the
  // content ever being read, and control C fail on a file with nothing in it. Found while building
  // this reproduction, and it is the same lesson as the rest of the file: check what you think you
  // are checking.
  writeFileSync(
    join(dir, 'settings.yaml'),
    withKey ? `aws_access_key_id = ${AWS_KEY}\n` : 'debug = true\n',
    'utf8',
  );
  spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8' });
  mkdirSync(join(dir, 'broken-index'), { recursive: true });
  return dir;
}

// mode 'index'  — the index is unreadable; the work tree still resolves. This is the case under test.
// mode 'worktree'— nothing resolves at all. This is the OTHER, already-guarded case (control E).
function push(dir, mode = 'ok') {
  const env = { ...process.env };
  if (mode === 'index') env.GIT_INDEX_FILE = join(dir, 'broken-index');
  if (mode === 'worktree') env.GIT_DIR = join(dir, 'no-such-git-dir');
  const r = spawnSync(process.execPath, [join(HOOKS, 'scan.mjs')], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      cwd: dir,
    }),
    encoding: 'utf8',
    env,
  });
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'silent', reason: '' };
  try {
    const h = JSON.parse(out).hookSpecificOutput;
    return { decision: h.permissionDecision, reason: h.permissionDecisionReason || '' };
  } catch {
    return { decision: '(unparsed)', reason: out.slice(0, 200) };
  }
}

const CLAIMS_IT_LOOKED = /found none/i;
const ADMITS_IT_COULD_NOT = /could NOT list|UNCHECKED/i;

console.log(`X349 reproduction — expecting the ${expectBug ? 'DEFECT' : 'FIX'}\n`);

const dirty = repo(true);
const clean = repo(false);

try {
  // ---- A: the defect, and D: the same measurement's other half ----------------------------
  const a = push(dirty, 'index');
  const lies = CLAIMS_IT_LOOKED.test(a.reason);
  const honest = ADMITS_IT_COULD_NOT.test(a.reason);
  const okA = expectBug ? lies && !honest : honest && !lies;
  if (!okA) note(`case A: with git enumeration broken the verdict was ${a.decision} — ${a.reason.slice(0, 200)}`);
  console.log(
    `  ${okA ? 'ok  ' : 'FAIL'}  A  broken enumeration: ${a.decision}, ` +
      `${lies ? 'claims "found none"' : honest ? 'admits it could not look' : 'says neither'}`,
  );

  const okD = a.decision !== 'deny';
  if (!okD) note('control D: a git failure REFUSED the push. A gate that cries wolf gets switched off (L5).');
  console.log(`  ${okD ? 'ok  ' : 'FAIL'}  D  control: it asks rather than refuses -> ${a.decision}`);

  // ---- B: control — the SAME repository, git working, must still be refused ----------------
  const b = push(dirty, 'ok');
  const okB = b.decision === 'deny';
  if (!okB) note(`control B: the same repo with git working gave ${b.decision}, not deny — the key is tracked in it`);
  console.log(`  ${okB ? 'ok  ' : 'FAIL'}  B  control: same repo, git working -> ${b.decision}`);

  // ---- C: control — the honest reassurance must survive a scan that really ran -------------
  const c = push(clean, 'ok');
  const okC = c.decision === 'ask' && CLAIMS_IT_LOOKED.test(c.reason);
  if (!okC)
    note(
      `control C: a genuinely clean repo gave ${c.decision} and ${
        CLAIMS_IT_LOOKED.test(c.reason) ? 'the usual wording' : 'lost the "found none" wording'
      } — the fix must not remove the honest reassurance, only the false one`,
    );
  console.log(
    `  ${okC ? 'ok  ' : 'FAIL'}  C  control: genuinely clean, git working -> ${c.decision}, wording kept`,
  );

  // ---- E: control — the pre-existing work-tree guard is a DIFFERENT thing, and still works -----
  const e = push(dirty, 'worktree');
  const okE = e.decision === 'deny' && /not a git work tree/i.test(e.reason);
  if (!okE)
    note(
      `control E: with no resolvable work tree the answer was ${e.decision} — ${e.reason.slice(0, 160)}. ` +
        'That guard predates this finding and must keep working; if it has gone, the new branch is ' +
        'masking it rather than sitting beside it.',
    );
  console.log(`  ${okE ? 'ok  ' : 'FAIL'}  E  control: no work tree at all -> ${e.decision}`);
} finally {
  rmSync(dirty, { recursive: true, force: true, maxRetries: 3 });
  rmSync(clean, { recursive: true, force: true, maxRetries: 3 });
}

if (problems.length) {
  console.log(`\nMISMATCH (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('\nALL AS EXPECTED — every case is in the expected state.');
