// scheduler-honesty.test.mjs — 2026-08-22.
//
// Three defects in the scheduler, all of the same family: it reports an outcome it did not achieve.
// Found by the completeness critic over the executing-surfaces adjudication, which is worth recording
// because two of the three were sitting inside a file the adjudicator had read line by line and one
// was PINNED by a test in the suite next door.
//
//   1  X232 was only half fixed. `enable()` returns early the moment it sees CRON_MARKER, so on any
//      machine where `autoupdate on` was run before 2026-08-18 the crontab still ends
//      `>/dev/null 2>&1` — the nightly job still discards conflict markers and a non-zero exit — and
//      re-running the documented remedy reports success while changing nothing. The macOS path DOES
//      self-heal (`enable()` rewrites the plist unconditionally), so this is the same L14 asymmetry
//      the X232 comment claims to have removed: one mechanism migrates, the other does not.
//
//      And `autoupdate.test.mjs`'s "enabling twice does not add a second line" builds its fixture out
//      of the literal OLD line and asserts `nothing should be written`. That test is right about not
//      duplicating and wrong about not migrating, so its fixture is corrected to the CURRENT line —
//      the same repair X230 needed when a fixture quietly stopped representing its own case.
//
//   2  `readCrontab` returns '' whenever `crontab -l` exits non-zero FOR ANY REASON. Its comment
//      justifies that for one case only — an empty crontab exits non-zero with "no crontab for
//      <user>" — but `writeCrontab` then runs `crontab <file>`, which REPLACES THE WHOLE TABLE. So on
//      a machine where the read fails while entries exist, enabling a daily update check deletes
//      every other cron job the user has, and reports "A daily update check is now scheduled".
//      That is the worst outcome in this file and nothing in the 47-finding list covered it.
//
//   3  `disable()` calls `writeCrontab(...)` and throws the result away, then sets
//      `removedAnything = true` unconditionally. A failed write reports "The daily update check has
//      been removed." Same shape on win32, where any schtasks failure — not just absence — reports
//      "There was no daily update check to remove."
//
// The unifying rule these tests assert: NEVER REPORT AN OUTCOME YOU DID NOT ACHIEVE, and never
// conflate "there was nothing to do" with "I could not do it". That is the same distinction X235
// forced on this programme's own verification runner four hours earlier.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const autoupdate = require('../src/autoupdate.js');

const RM = { recursive: true, force: true, maxRetries: 3 };
const mkTmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

// A runner that lets a test say exactly what `crontab -l` did, including its stderr — which is the
// only thing that separates "no crontab yet" from "I could not read your crontab".
function runnerWith({ listOk, listStdout = '', listStderr = '', writeOk = true, systemd = false }) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'systemctl' && args[1] === '--version')
      return { ok: systemd, status: systemd ? 0 : 1, stdout: '', stderr: '' };
    if (cmd === 'crontab' && args[0] === '-l')
      return { ok: listOk, status: listOk ? 0 : 1, stdout: listStdout, stderr: listStderr };
    if (cmd === 'crontab') {
      // 2026-08-25, X351: capture what we are being asked to INSTALL, here, while the file still
      // exists. `writeCrontab` deletes its temp directory before returning (autoupdate.js:173), so
      // reading `args[0]` after the call always finds nothing — and line 86 below already ASSUMED
      // someone had done this, reading a `run.lastText` that nothing in the repository ever set.
      try {
        run.lastText = fs.readFileSync(args[0], 'utf8');
      } catch {
        run.lastText = null; // recorded as unreadable rather than as empty
      }
      return { ok: writeOk, status: writeOk ? 0 : 1, stdout: '', stderr: writeOk ? '' : 'crontab: installing new crontab failed' };
    }
    return { ok: true, status: 0, stdout: '', stderr: '' };
  };
  run.calls = calls;
  run.lastText = undefined;
  return run;
}
// Each write carries the content that was installed, captured at call time (X351). `text` is a
// string for a readable temp file and null when it could not be read — never silently absent.
const writes = (runner) =>
  runner.calls
    .filter((c) => c.cmd === 'crontab' && c.args[0] !== '-l')
    .map((c) => ({ ...c, text: runner.lastText }));
const OLD_LINE = (m) => `17 4 * * * "/usr/bin/node" "/x/index.js" update >/dev/null 2>&1 ${m}`;

// ---- 1. the stale cron line must be migrated, not silently kept ---------------------
test('cron: a pre-X232 line that discards output is rewritten, not reported as already fine', () => {
  const home = mkTmp('gru-sched-migrate-');
  const M = autoupdate.CRON_MARKER;
  const existing = `0 9 * * * /usr/bin/backup\n${OLD_LINE(M)}`;
  const runner = runnerWith({ listOk: true, listStdout: existing });
  const r = autoupdate.enable({
    platform: 'linux',
    homeDir: home,
    runner,
    nodePath: '/usr/bin/node',
    cliPath: '/x/index.js',
    env: {},
  });
  assert.equal(r.ok, true);
  const w = writes(runner);
  assert.equal(w.length, 1, 'the stale line must be rewritten, so exactly one write must happen');
  // 2026-08-25, X351. `runner.lastText` was never assigned by anything in the repository — a grep for
  // `lastText =` returned zero — and the temp file is deleted before the call returns, so `written`
  // was ALWAYS the empty string and `if (written)` was always false. The three assertions inside were
  // dead: exactly finding 1 of this file's own header, "X232 was only half fixed", switched off by the
  // guard meant to tolerate a missing file. What still ran was the message-shape assertion below,
  // which the BUGGY code also satisfies — so this file could report the migration working while
  // `autoupdate on` reinstalled the pre-X232 line that throws the nightly updater's only failure
  // report at /dev/null.
  //
  // The capture now happens in runnerWith, and the guard is GONE: a capture that stops working must
  // fail loudly rather than quietly stop testing. That distinction is finding X347, found by CI in
  // this repository earlier today, and this is the same shape one directory across.
  const written = w[0].text;
  assert.equal(typeof written, 'string', 'the crontab being installed must have been captured');
  assert.ok(!written.includes('>/dev/null'), 'the migrated crontab must not still discard output');
  assert.ok(written.includes('.gru953-studio-update.log'), 'it must name the log');
  assert.ok(written.includes('/usr/bin/backup'), "the user's own entries must survive");
  assert.match(r.message, /updat|rewrit|migrat/i, 'the user must be told the old line was replaced');
  assert.doesNotMatch(r.message, /Nothing changed/i);
  fs.rmSync(home, RM);
});

test('cron: a line that is ALREADY current is left alone and reported as such', () => {
  const home = mkTmp('gru-sched-current-');
  const current = autoupdate.cronLineFor('/usr/bin/node', '/x/index.js');
  const runner = runnerWith({ listOk: true, listStdout: `0 9 * * * /usr/bin/backup\n${current}` });
  const r = autoupdate.enable({
    platform: 'linux',
    homeDir: home,
    runner,
    nodePath: '/usr/bin/node',
    cliPath: '/x/index.js',
    env: {},
  });
  assert.equal(r.ok, true);
  assert.equal(writes(runner).length, 0, 'nothing to migrate means nothing written');
  assert.match(r.message, /already scheduled/i);
  fs.rmSync(home, RM);
});

// ---- 2. an unreadable crontab must never be treated as an empty one -----------------
test('cron: a crontab that cannot be READ is never overwritten', () => {
  const home = mkTmp('gru-sched-unreadable-');
  // Not "no crontab for sam" - a real failure, with entries that would be destroyed.
  const runner = runnerWith({
    listOk: false,
    listStdout: '',
    listStderr: 'crontab: cannot open /var/at/tabs/sam: Permission denied',
  });
  const r = autoupdate.enable({
    platform: 'linux',
    homeDir: home,
    runner,
    nodePath: '/usr/bin/node',
    cliPath: '/x/index.js',
    env: {},
  });
  assert.equal(writes(runner).length, 0, 'refusing to write is the only safe answer to an unreadable crontab');
  assert.equal(r.ok, false, 'and it must be reported as a failure, not as a scheduled job');
  assert.match(r.message, /could not read|unreadable|not able to read/i);
  fs.rmSync(home, RM);
});

test('cron: an EMPTY crontab still enables normally (the case the old comment was right about)', () => {
  const home = mkTmp('gru-sched-empty-');
  const runner = runnerWith({ listOk: false, listStdout: '', listStderr: 'no crontab for sam' });
  const r = autoupdate.enable({
    platform: 'linux',
    homeDir: home,
    runner,
    nodePath: '/usr/bin/node',
    cliPath: '/x/index.js',
    env: {},
  });
  assert.equal(r.ok, true, 'a first-ever enable on a machine with no cron entries must still work');
  assert.equal(writes(runner).length, 1);
  fs.rmSync(home, RM);
});

// ---- 3. removal must not be claimed when it did not happen -------------------------
test('cron: a FAILED crontab write is never reported as a successful removal', () => {
  const home = mkTmp('gru-sched-offfail-');
  const M = autoupdate.CRON_MARKER;
  const runner = runnerWith({ listOk: true, listStdout: `0 9 * * * /usr/bin/backup\n${OLD_LINE(M)}`, writeOk: false });
  const r = autoupdate.disable({ platform: 'linux', homeDir: home, runner, env: {} });
  assert.equal(r.ok, false, 'the write failed, so the job is still scheduled');
  assert.doesNotMatch(r.message, /has been removed/i, 'that sentence would be untrue');
  assert.match(r.message, /could not|failed|still/i);
  fs.rmSync(home, RM);
});

test('cron: an unreadable crontab on disable is reported, not read as "nothing to remove"', () => {
  const home = mkTmp('gru-sched-offunread-');
  const runner = runnerWith({ listOk: false, listStderr: 'crontab: cannot open /var/at/tabs/sam: Permission denied' });
  const r = autoupdate.disable({ platform: 'linux', homeDir: home, runner, env: {} });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /was no daily update check/i, 'absence and unreadability are different answers');
  fs.rmSync(home, RM);
});

test('win32: a schtasks failure that is not absence is reported as a failure', () => {
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { ok: false, status: 1, stdout: '', stderr: 'ERROR: Access is denied.' };
  };
  runner.calls = calls;
  const r = autoupdate.disable({ platform: 'win32', homeDir: 'C:\\Users\\sam', runner, env: {} });
  assert.equal(r.ok, false, 'access denied is not the same as nothing to remove');
  assert.doesNotMatch(r.message, /was no daily update check/i);
});

test('win32: schtasks reporting the task does not exist IS absence, and stays a success', () => {
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { ok: false, status: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
  };
  runner.calls = calls;
  const r = autoupdate.disable({ platform: 'win32', homeDir: 'C:\\Users\\sam', runner, env: {} });
  assert.equal(r.ok, true, 'nothing to remove is not a failure');
  assert.match(r.message, /was no daily update check/i);
});

// 2026-08-25, X348. Everything above tests enable() and disable(). status() — the function `doctor`
// prints and `uninstall` branches on — was tested only on darwin, so its cron branch was never
// reached by anything: darwin returns at launchd, win32 at schtasks, and the sole leg that reaches
// the crontab read is Linux, which this machine cannot run. It crashed there on
// `readCrontab(...).includes is not a function` and took the whole doctor report down mid-page.
// Found by CI on the first push, not by the suite.
test('status on linux: an unreadable crontab is UNKNOWN, not "nothing is scheduled"', () => {
  const home = mkTmp('gru-status-unreadable-');
  const runner = runnerWith({
    listOk: false,
    listStdout: '',
    listStderr: 'crontab: cannot open /var/spool/cron/crontabs/sam: Permission denied',
  });
  const s = autoupdate.status({ platform: 'linux', homeDir: home, runner, env: {} });
  assert.equal(s.known, false, 'a read that failed cannot know whether a job is scheduled');
  assert.match(s.message, /unknown/i);
  assert.doesNotMatch(
    s.message,
    /nothing checks on its own/i,
    'that sentence is the reassuring answer and must not be given on a failed read',
  );
  fs.rmSync(home, RM);
});

test('status on linux: an EMPTY crontab really is "not scheduled"', () => {
  const home = mkTmp('gru-status-empty-');
  const runner = runnerWith({ listOk: false, listStdout: '', listStderr: 'no crontab for sam' });
  const s = autoupdate.status({ platform: 'linux', homeDir: home, runner, env: {} });
  assert.equal(s.enabled, false);
  assert.notEqual(s.known, false, 'an empty crontab was read successfully, so this IS known');
  assert.match(s.message, /not scheduled/i);
  fs.rmSync(home, RM);
});

test('status on linux: a crontab carrying our marker is reported as scheduled', () => {
  const home = mkTmp('gru-status-on-');
  const runner = runnerWith({
    listOk: true,
    listStdout: `# something of the user's own\n${OLD_LINE(autoupdate.CRON_MARKER)}\n`,
  });
  const s = autoupdate.status({ platform: 'linux', homeDir: home, runner, env: {} });
  assert.equal(s.enabled, true);
  assert.equal(s.mechanism, 'cron');
  fs.rmSync(home, RM);
});
