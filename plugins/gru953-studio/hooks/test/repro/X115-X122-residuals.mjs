#!/usr/bin/env node
//
// Reproduction for the residuals of X115 and X122 — both found by a DEFEAT PROBE against the real
// gate, after both had been proposed for closure and both survived a reading of the fix.
//
// That method distinction is the point, and this register has now watched it hold twice. Every
// proposed closure backed only by a MUTATION TEST — varying the product code while holding the test
// input fixed — was later overturned. Every one backed by a NOVEL ADVERSARIAL INPUT held. X113 was
// probed the same way on the same day and survived; these two did not.
//
// X115's residual. The X115 fix added `statSync(root).isDirectory()`, which properly closed the "the
// directory does not EXIST" half. `dirEntries()` was untouched, and it was
// `try { readdirSync } catch { return [] }` — so a directory that exists, IS a directory, and simply
// cannot be READ yielded zero entries, produced zero manifests, and the scan fell through to
// `{"status":"clean"}` with exit 0. Two proven cases: the scan root itself unreadable while holding a
// package.json and a GPL-3.0 dependency; and, more dangerous, one unreadable SUBDIRECTORY while the
// root is fine, where the gate looks like it worked and simply never saw that subtree.
//
// FIFTH INSTANCE OF ONE SHAPE in this project — unreadable input reading as empty — after X113
// (verify-progress), X118 (docs-consistency), X281 and X283 (memory-integrity). Five is not a
// coincidence; `try { … } catch { return [] }` is what the habit looks like, and case C exists so the
// next person who writes it in this file trips over a test.
//
// X122's residual. The X279 repair reports a table that plainly claims to be a content register —
// three or more content-specific columns and no readable asset or medium column. That threshold was
// chosen against X122's own controls so it cannot fire on `Model | Status`. But a table with only ONE
// OR TWO content columns and unreadable asset headers is genuinely ambiguous: indistinguishable from
// an unrelated table by its headers alone. It was still skipped in SILENCE while the verdict affirmed
// that every recorded asset had approval, provenance and rights.
//
// THE FIX IS NOT A LOWER THRESHOLD, which would fire on the controls. Silence is the defect, not the
// skip. Every skipped table is now NAMED in the verdict, blocking nothing — so a reader of a clean
// result can see which tables were not read and judge for themselves. Case E asserts that an unrelated
// table is still not blocked while still being named.
//
//   case                                                      required
//   A  licence-scan: the scan ROOT unreadable                   BLOCKED, saying so   [POSIX only]
//   B  licence-scan: one unreadable SUBDIRECTORY                BLOCKED — dangerous  [POSIX only]
//   C  control: everything readable                             READ, and not blocked for that
//   D  content-check: an ambiguous table is NAMED               listed in tablesSkipped
//   E  control: an unrelated table is named but not blocked      clean, and listed
//   F  control: a register with no skipped tables                clean, empty list
//   G  control: the real project                                 unchanged
//
// A and B carry X115's half and cannot run on win32 — see the X358 note above the fixture. D carries
// X122's half and runs everywhere, which is the only reason this file still means anything on
// Windows; the `liveCases` guard at the bottom is what stops that from going quiet again.
//
// Usage:
//   node X115-X122-residuals.mjs                # asserts the fixed state
//   node X115-X122-residuals.mjs --expect-bug   # asserts the residuals

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO = join(HOOKS, '..', '..', '..');

const problems = [];
const note = (s) => problems.push(s);

const WINDOWS = process.platform === 'win32';

// The cases that VARY with the fix, as opposed to the controls, which assert the absence of a false
// alarm and therefore pass in both directions by construction. Recorded by name because a platform
// on which every varying case is skipped runs green in BOTH directions and has stopped testing
// anything, while still reporting as a passing reproduction — finding X347, found by CI in this very
// file. The guard at the bottom refuses that state out loud instead of letting it look healthy.
const liveCases = [];

function run(hook, root) {
  const r = spawnSync(process.execPath, [join(HOOKS, hook), root], { encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: '(crashed or unparsed)', raw: `${r.stdout}${r.stderr}`.slice(0, 200) };
  }
}

// ---- A to C: licence-scan and the unreadable directory ---------------------------
//
// 2026-08-26, finding X358 — found by CI on `hooks (windows-latest, node 22)`, the one leg the
// development machine cannot run. Cases A and B manufacture an unreadable directory with
// `chmodSync(dir, 0o000)`. POSIX mode bits are ADVISORY on Windows: `fs.chmod` there can only
// toggle the read-only attribute, and Windows ignores even that on a DIRECTORY. So the directory
// stayed perfectly readable, the walk never reached the unreadable branch, and both cases read the
// gate's honest answer about something else as the defect coming back.
//
// DEMONSTRATED, not supposed, in two halves that meet:
//   * on this Mac the three fixtures below differ — `readdirSync` on the chmod'd root throws EACCES
//     and licence-scan says BLOCKED (A), the chmod'd subdirectory likewise (B), the untouched one
//     says INCOMPLETE (C);
//   * on the Windows leg all three reported the SAME status as each other,
//       INCOMPLETE — install dependencies for every ecosystem present, then re-run
//     which is licence-scan.mjs:992 and is reachable only once `results.length > 0` — i.e. only
//     after `findManifestDirs` had SUCCESSFULLY READ the very directory the chmod was meant to
//     close, and found the package.json inside it. The gate was right; the fixture was inert.
//
// WHY NOT MAKE IT REALLY UNREADABLE THERE. `icacls /deny` is the only mechanism on Windows that
// genuinely closes a directory, and it was rejected deliberately, not for convenience:
//   * it cannot be exercised from this machine at all, so it would ship as untested code inside a
//     test — the worst place in the tree for it;
//   * an explicit DENY ace is bypassed by a process holding backup/restore privilege, and whether
//     GitHub's windows-latest image runs elevated is something this machine CANNOT verify. A DENY
//     that silently fails to bite leaves the case green for the wrong reason, which is exactly the
//     disease X347 treated in this file hours earlier;
//   * a test that only works when the runner is not an administrator is a flaky test, not a fix;
//   * and cleanup inherits the problem — `rmSync` on a denied directory throws EPERM, so the repro
//     would have to un-deny before deleting, adding two more unverifiable subprocess calls.
// There is also no PORTABLE fixture for this fact. The branch needs a path where
// `statSync(p).isDirectory()` is true and `readdirSync(p)` throws; every Windows trick that makes
// readdir fail (a dangling junction, a path past MAX_PATH, replacing the directory with a file)
// makes statSync fail in the same breath, so it lands in X115's "does not EXIST" half, which is
// already covered. Deleting the directory between the two calls would work and is a race, not a test.
//
// So A and B are skipped EXPLICITLY on win32, and X115's half of this file is UNEXERCISED there.
// Stated plainly rather than hidden, because the alternative — weakening `blockedForUnreadable` so
// INCOMPLETE counts as "blocked for being unreadable" — would delete the only assertion these two
// cases exist to make, on every platform, to buy a green tick on one.
// What still covers the class on Windows: phase1-gate-honesty.mjs case P7, which replaces a file
// with a DIRECTORY — a failure every platform produces — and, in this file, case D.
const SKIPPED_ON_WINDOWS =
  'chmod 0o000 cannot close a directory on Windows, so the fixture is inert there (X358)';

function licenceFixture(makeUnreadable) {
  const dir = mkdtempSync(join(tmpdir(), 'x115r-'));
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"t","dependencies":{}}\n', 'utf8');
  writeFileSync(join(dir, 'sub', 'package.json'), '{"name":"s"}\n', 'utf8');
  if (makeUnreadable) chmodSync(join(dir, makeUnreadable), 0o000);
  return dir;
}
const blockedForUnreadable = (v) =>
  v.status === 'BLOCKED' && /could not be read/i.test(String(v.reason || ''));

if (WINDOWS) {
  console.log(`  skip A  licence-scan: the scan root unreadable . ${SKIPPED_ON_WINDOWS}`);
} else {
  liveCases.push('A');
  const dir = licenceFixture('.');
  const v = run('licence-scan.mjs', dir);
  chmodSync(dir, 0o755);
  if (!blockedForUnreadable(v)) {
    note(`case A: an unreadable scan ROOT -> ${v.status} (${String(v.reason || '').slice(0, 80)}), expected BLOCKED for being unreadable`);
  } else {
    console.log('  A  licence-scan: the scan root unreadable ..... BLOCKED, saying so');
  }
  rmSync(dir, { recursive: true, force: true });
}
if (WINDOWS) {
  console.log(`  skip B  licence-scan: one unreadable subdir .... ${SKIPPED_ON_WINDOWS}`);
} else {
  liveCases.push('B');
  const dir = licenceFixture('sub');
  const v = run('licence-scan.mjs', dir);
  chmodSync(join(dir, 'sub'), 0o755);
  if (!blockedForUnreadable(v)) {
    note(
      `case B: one unreadable SUBDIRECTORY with a readable root -> ${v.status}. This is the dangerous ` +
        'case: the gate looks like it worked and simply never saw that subtree',
    );
  } else {
    console.log('  B  licence-scan: one unreadable subdirectory .. BLOCKED');
  }
  rmSync(dir, { recursive: true, force: true });
}
// 2026-08-26, finding X360 — the X347 shape one line down from control G, noticed while fixing
// X358. This control's job is "the READABLE case is not blocked FOR BEING UNREADABLE", and it
// asserted only the negative: anything that was not `BLOCKED … could not be read` counted as a
// pass. A gate that crashed before walking, bailed out on the root, or opened no directory at all
// satisfies that too — the control would go green having witnessed nothing about readability. That
// is precisely how control G passed on this machine and failed on every clean checkout.
//
// The negative is kept and TWO POSITIVES are added, so the control can only pass by seeing the gate
// actually read a readable tree. This narrows what is accepted; it does not widen it.
//
// The honest answers for THIS fixture, and why each one is honest:
//   * `INCOMPLETE — install dependencies …` (licence-scan.mjs:992) — what the fixture really
//     produces, on every platform. It is a fresh temp dir holding package.json and sub/package.json
//     with no node_modules and no lockfile, so the npm scan returns `checked: false`
//     (licence-scan.mjs:91) and the gate refuses to conclude. It is also POSITIVE PROOF the tree was
//     read: that branch is only reachable once `results.length > 0`, and results come only from
//     directories `findManifestDirs` succeeded in reading.
//   * `clean` (licence-scan.mjs:969, "no recognised dependency manifests found") — honest, though
//     not reachable while the fixture declares a manifest. Kept so that editing `licenceFixture`
//     cannot turn a correct answer into a red test.
// Nothing else is honest here, and the list is deliberately not widened past these two: any other
// BLOCKED means the gate objected to something this fixture does not contain; NEEDS HUMAN REVIEW
// needs unrecognised licence strings and there are no dependencies at all; a crash is a crash.
// Accepting "anything but one status" is the vacuum this note exists to close.
const READABLE_FIXTURE_IS_HONEST = (s) => s === 'clean' || /^INCOMPLETE\b/.test(s);
{
  // NOT added to `liveCases`: strengthened or not, C is still a control. It passes against the
  // pre-fix gate too (a readable tree walked fine before the fix as well), so it can never stand in
  // for a case that varies with the fix. Counting it here would have quietly satisfied the guard
  // below and re-created X347 in the act of guarding against it.
  const dir = licenceFixture(null);
  const v = run('licence-scan.mjs', dir);
  const status = String(v.status || '');
  // The gate reports each scanned directory as `path.relative(root, dir) || '.'`, and
  // path.relative emits '\' on win32 — the separator-sensitivity class this whole Windows pass is
  // about. Normalised before comparison so this control cannot become the next X358.
  const read = (Array.isArray(v.results) ? v.results : [])
    .map((r) => String(r.dir || '').split(/[\\/]/).join('/'))
    .sort();
  const sawBoth = read.length === 2 && read[0] === '.' && read[1] === 'sub';
  if (blockedForUnreadable(v)) {
    note(`control C: everything readable was blocked for being unreadable — a false alarm: ${JSON.stringify(v).slice(0, 160)}`);
  } else if (!READABLE_FIXTURE_IS_HONEST(status)) {
    note(
      `control C: a fully readable fixture gave "${status}" — expected "clean" or "INCOMPLETE …". ` +
        'Anything else means the gate never got as far as reading the tree, so "not blocked for ' +
        'being unreadable" would have been true for a reason that has nothing to do with readability',
    );
  } else if (status !== 'clean' && !sawBoth) {
    note(
      `control C: the verdict does not show both readable directories being read (results dirs = ` +
        `${JSON.stringify(read)}, expected ["." , "sub"]), so this control cannot witness that a ` +
        'readable tree was in fact read, and its pass would prove nothing',
    );
  } else {
    console.log(
      `  C  control: everything readable ..... read ${JSON.stringify(read)}, not blocked for that (${status})`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- D to F: content-check names every table it skips ---------------------------
const GOOD =
  '# Content\n\n| Asset | Medium | Provenance | Approval | Rights | Alt-text |\n' +
  '| :-- | :-- | :-- | :-- | :-- | :-- |\n| intro.md | text | in-house | approved | owned | n/a |\n';

function contentFixture(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x122r-'));
  mkdirSync(join(dir, 'Dev-Memory'), { recursive: true });
  writeFileSync(join(dir, 'Dev-Memory', 'CONTENT.md'), GOOD + (extra || ''), 'utf8');
  return dir;
}
const skipped = (v) => (Array.isArray(v.tablesSkipped) ? v.tablesSkipped : null);

{
  // Counted as live on every platform, and that is what keeps this file honest on win32 once A and
  // B are skipped there (X358). Nothing in this case touches chmod, a path separator or an
  // absolute-path import — it is a markdown table fed to a gate — so it answers the same way
  // everywhere, and CI's Windows leg shows it running and passing. Verified to VARY with the product
  // code, not merely to pass: against content-check.mjs as it stands the verdict names the skipped
  // table, and against a copy with the `tablesSkipped.push` at content-check.mjs:265 removed — the
  // pre-fix behaviour, skipping in silence — this case reports `tablesSkipped` empty and notes.
  liveCases.push('D');
  // Two content columns only — below the reporting threshold, and ambiguous by design.
  const dir = contentFixture(
    '\n## Artwork\n\n| Artwork | Format | Approved | Rights |\n| :-- | :-- | :-- | :-- |\n| hero.svg | image | | |\n',
  );
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (list === null) {
    note('case D: the verdict carries no tablesSkipped list at all, so a skipped table is still silent');
  } else if (!list.some((h) => /Artwork/.test(h))) {
    note(`case D: the ambiguous table was skipped and NOT named: ${JSON.stringify(list)}`);
  } else {
    console.log('  D  content-check: an ambiguous table ......... named in tablesSkipped');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = contentFixture('\n## Models\n\n| Model | Status |\n| :-- | :-- |\n| gpt | ok |\n');
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (v.status !== 'clean') {
    note(`control E: an unrelated table blocked the gate (${v.status}) — that is the false alarm X122 was already burned by`);
  } else if (!list || !list.some((h) => /Model/.test(h))) {
    note(`control E: it stays clean, correctly, but the unrelated table is not named either: ${JSON.stringify(list)}`);
  } else {
    console.log('  E  control: an unrelated table ............... named, not blocked');
  }
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = contentFixture('');
  const v = run('content-check.mjs', dir);
  const list = skipped(v);
  if (v.status !== 'clean' || !Array.isArray(list) || list.length !== 0) {
    note(`control F: a register with nothing to skip -> ${v.status}, tablesSkipped=${JSON.stringify(list)}, expected clean and empty`);
  } else {
    console.log('  F  control: nothing skipped ................. clean, empty list');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- G: control — the real project --------------------------------------------
// 2026-08-25, found by CI on the first push — the leg that could never run on the development
// machine. `Dev-Memory/` is GITIGNORED, so a fresh clone has none, and a gate handed a directory with
// no `Dev-Memory/` correctly answers "not a studio project" rather than "clean". Both are honest
// answers to different questions; this control accepted only one, so it passed locally for a reason
// that had nothing to do with the product being correct and failed on every clean checkout.
//
// The sample sweep flagged this exact shape about X22 on 24 August — "case A cannot fail when
// Dev-Memory/ is absent at the checkout root, the environment CI runs in" — and it was not acted on.
// CI acted on it instead.
const HONEST_ON_THIS_PROJECT = (s) => s === 'clean' || s === 'not a studio project';
for (const hook of ['licence-scan.mjs', 'content-check.mjs']) {
  const v = run(hook, REPO);
  if (!HONEST_ON_THIS_PROJECT(v.status)) {
    note(
      `control G: ${hook} gave "${v.status}" on this project — expected either "clean" (a checkout ` +
        'whose gitignored Dev-Memory/ is present on disk) or "not a studio project" (a fresh clone, ' +
        'which is what CI has). Anything else means this fix has broken the real repository.',
    );
  } else {
    console.log(`  G  control: ${hook.padEnd(30)} ${v.status}`);
  }
}

// 2026-08-26, the executable half of finding X347 — and the reason X358 could be answered with a
// skip rather than an untestable ACL. Skipping a case on a platform is only honest while some case
// that VARIES with the fix still runs there. If none does, this file exits 0 plain and non-zero on
// --expect-bug on that platform for a reason that has nothing to do with the product: it asserts
// nothing and reports as a healthy reproduction. X347 was that exact trap, in this file, and it took
// CI to find it because nothing here said so out loud. This does, in both directions, before any
// verdict is reached.
console.log(`\n  cases that vary with the fix, live on ${process.platform}: ${liveCases.join(', ') || 'NONE'}`);
if (!liveCases.length) {
  console.error(
    `\nFAIL: every case that varies with the fix is skipped on ${process.platform}, so this file ` +
      'now passes in both directions here and tests nothing. That is finding X347 exactly — a ' +
      'reproduction that cannot run in the environment CI runs in, looking green. Restore a live ' +
      'case on this platform or delete the file; do not leave it reporting success.',
  );
  process.exit(1);
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
  '\nPASS: a directory that cannot be read is never reported as clean, and no content table is ever ' +
    'skipped without the verdict naming it.',
);
