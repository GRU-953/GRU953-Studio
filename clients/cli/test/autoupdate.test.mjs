// autoupdate.test.mjs — 2026-08-10, with the opt-in daily update job.
//
// Every test injects a fake `runner`, so nothing here registers a real
// LaunchAgent, creates a real Task Scheduler entry, or touches the developer's
// crontab. That injection point exists purely for this reason: a test suite that
// alters the machine running it is one nobody will trust enough to run, and this
// module's whole job is altering the machine.

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

/** Records every command it is asked to run, and answers however the test needs. */
function fakeRunner({ ok = true, stdout = '', systemd = true } = {}) {
    const calls = [];
    const run = (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        if (cmd === 'systemctl' && args[1] === '--version') return { ok: systemd, status: systemd ? 0 : 1, stdout: '', stderr: '' };
        if (cmd === 'crontab' && args[0] === '-l') return { ok: !!stdout, status: stdout ? 0 : 1, stdout, stderr: '' };
        // 2026-08-25, X351: capture the crontab we are being asked to INSTALL, here, while the file
        // still exists. `writeCrontab` deletes its temp directory before returning (autoupdate.js:173),
        // so a test that reads `write.args[0]` afterwards always finds nothing — see the comment on the
        // assertions below for what that cost.
        if (cmd === 'crontab' && args[0] !== '-l') {
            try {
                run.lastText = fs.readFileSync(args[0], 'utf8');
            } catch {
                run.lastText = null; // recorded as unreadable rather than as empty
            }
        }
        return { ok, status: ok ? 0 : 1, stdout: '', stderr: ok ? '' : 'pretend failure' };
    };
    run.calls = calls;
    run.lastText = undefined;
    return run;
}

test('off by default: status reports not scheduled, and explains what happens instead', () => {
    const home = mkTmp('gru-au-status-');
    const s = autoupdate.status({ platform: 'darwin', homeDir: home, runner: fakeRunner(), env: {} });
    assert.equal(s.enabled, false);
    // 2026-08-22, X233. This asserted /first time you use it each day/ — and that daily default
    // check DOES NOT EXIST. Only two call sites invoke auto-update.mjs and both pass --force; it is
    // not in hooks.json; session-start.mjs stopped running it, its own comment recording the removal.
    // So the 24-hour .last-update-check window inside auto-update.mjs is unreachable, and this test
    // was PINNING THE FALSE WORDING — the reason nothing could tell, in four shipped statements.
    //
    // The comment it replaced had the right instinct and the wrong fact: a user told "not scheduled"
    // does need to know what happens instead. What happens instead is nothing, so that is what the
    // message must say, and this test now holds that.
    assert.match(s.message, /nothing checks on its own/i);
    assert.doesNotMatch(
        s.message,
        /first time you use it each day/,
        'the daily default check does not exist; a message promising one is a false claim (X233)',
    );
    fs.rmSync(home, RM);
});

test('macOS: writes a LaunchAgent plist with a fixed daily time, and loads it', () => {
    const home = mkTmp('gru-au-mac-');
    const runner = fakeRunner();
    const r = autoupdate.enable({ platform: 'darwin', homeDir: home, runner, nodePath: '/usr/bin/node', cliPath: '/x/index.js', env: {} });
    assert.equal(r.ok, true);
    const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.gru953.studio.autoupdate.plist');
    assert.ok(fs.existsSync(plistPath), 'the plist must be written inside the given home directory, not the real one');
    const plist = fs.readFileSync(plistPath, 'utf8');
    // StartCalendarInterval, not StartInterval: an interval fires relative to load
    // time, so on a laptop that sleeps it drifts and can fire on lid-open.
    assert.match(plist, /StartCalendarInterval/);
    assert.ok(!/StartInterval/.test(plist.replace(/StartCalendarInterval/g, '')), 'must not use a drifting interval');
    assert.match(plist, /<string>\/usr\/bin\/node<\/string>/);
    assert.match(plist, /<string>update<\/string>/);
    assert.ok(runner.calls.some((c) => c.cmd === 'launchctl'), 'launchd must be told about it');
    assert.equal(autoupdate.status({ platform: 'darwin', homeDir: home, runner, env: {} }).enabled, true);
    fs.rmSync(home, RM);
});

test('macOS: still reports success when launchctl declines, because the plist loads at next login', () => {
    const home = mkTmp('gru-au-mac-fail-');
    const r = autoupdate.enable({ platform: 'darwin', homeDir: home, runner: fakeRunner({ ok: false }), env: {} });
    assert.equal(r.ok, true, 'the job IS scheduled — reporting failure would be untrue');
    assert.match(r.message, /next time you log in/, 'but the user must be told it is not active yet');
    fs.rmSync(home, RM);
});

test('Windows: registers a daily Task Scheduler task', () => {
    const runner = fakeRunner();
    const r = autoupdate.enable({ platform: 'win32', homeDir: 'C:\\Users\\sam', runner, nodePath: 'C:\\node.exe', cliPath: 'C:\\cli\\index.js', env: {} });
    assert.equal(r.ok, true);
    const call = runner.calls.find((c) => c.cmd === 'schtasks');
    assert.ok(call, 'schtasks must be used — it is the documented mechanism on Windows');
    assert.ok(call.args.includes('/SC') && call.args.includes('DAILY'), 'it must be a daily schedule');
    assert.ok(call.args.includes('GRU953-Studio Update'), 'the task must be named recognisably so a user can find it');
});

test('Windows: a refused task registration is reported as a failure, not as success', () => {
    const r = autoupdate.enable({ platform: 'win32', homeDir: 'C:\\Users\\sam', runner: fakeRunner({ ok: false }), env: {} });
    assert.equal(r.ok, false);
    assert.match(r.message, /Could not create/);
});

test('Linux with systemd: writes a user timer with Persistent=true', () => {
    const home = mkTmp('gru-au-systemd-');
    const runner = fakeRunner({ systemd: true });
    const r = autoupdate.enable({ platform: 'linux', homeDir: home, runner, nodePath: '/usr/bin/node', cliPath: '/x/index.js', env: {} });
    assert.equal(r.ok, true);
    assert.equal(r.mechanism, 'systemd');
    const timer = fs.readFileSync(path.join(home, '.config', 'systemd', 'user', 'gru953-studio-update.timer'), 'utf8');
    // Persistent=true so a machine that was switched off at the scheduled time
    // still checks when it returns, instead of skipping that day silently.
    assert.match(timer, /Persistent=true/);
    assert.match(timer, /OnCalendar=daily/);
    assert.ok(fs.existsSync(path.join(home, '.config', 'systemd', 'user', 'gru953-studio-update.service')));
    fs.rmSync(home, RM);
});

test('Linux without systemd: falls back to cron rather than failing', () => {
    const home = mkTmp('gru-au-cron-');
    const runner = fakeRunner({ systemd: false });
    const r = autoupdate.enable({ platform: 'linux', homeDir: home, runner, nodePath: '/usr/bin/node', cliPath: '/x/index.js', env: {} });
    assert.equal(r.ok, true);
    assert.equal(r.mechanism, 'cron', 'containers and WSL1 have no systemd, and must still work');
    const wrote = runner.calls.filter((c) => c.cmd === 'crontab' && c.args[0] !== '-l');
    assert.equal(wrote.length, 1, 'the crontab must be replaced exactly once');
    fs.rmSync(home, RM);
});

test('cron: an empty crontab is not treated as an error (the first-ever enable must work)', () => {
    // `crontab -l` exits non-zero with "no crontab for <user>" when there are no
    // entries. Reading that as a failure would break the very first enable on a
    // machine that simply has no cron entries yet.
    const home = mkTmp('gru-au-cron-empty-');
    const runner = fakeRunner({ systemd: false, stdout: '' });
    const r = autoupdate.enable({ platform: 'linux', homeDir: home, runner, env: {} });
    assert.equal(r.ok, true);
    fs.rmSync(home, RM);
});

// 2026-08-22: this test's FIXTURE was corrected, not its purpose. It built `existing` out of the
// literal pre-X232 cron line ending `>/dev/null 2>&1` and then asserted `nothing should be written`
// — so it pinned the very defect X232 was meant to remove, and no machine that had already enabled
// the job could ever be migrated to a line that keeps its failure report. The fixture now uses the
// CURRENT line, which is what "already scheduled, nothing to do" actually means. The stale-line case
// it used to occupy is asserted the other way round in scheduler-honesty.test.mjs, where a write MUST
// happen. Same repair X230 needed: a fixture had quietly stopped representing its own case.
test('cron: enabling twice does not add a second line', () => {
    const home = mkTmp('gru-au-cron-twice-');
    const current = autoupdate.cronLineFor('/usr/bin/node', '/x/index.js');
    const existing = `0 9 * * * /usr/bin/backup\n${current}`;
    const runner = fakeRunner({ systemd: false, stdout: existing });
    const r = autoupdate.enable({ platform: 'linux', homeDir: home, runner, nodePath: '/usr/bin/node', cliPath: '/x/index.js', env: {} });
    assert.equal(r.ok, true);
    assert.match(r.message, /already scheduled/);
    assert.equal(runner.calls.filter((c) => c.cmd === 'crontab' && c.args[0] !== '-l').length, 0, 'nothing should be written');
    fs.rmSync(home, RM);
});

test("cron: turning it off removes only our line and keeps the user's own entries", () => {
    const home = mkTmp('gru-au-cron-off-');
    const existing = `0 9 * * * /usr/bin/backup\n17 4 * * * "/usr/bin/node" "/x/index.js" update >/dev/null 2>&1 ${autoupdate.CRON_MARKER}\n30 2 * * 0 /usr/bin/weekly`;
    const runner = fakeRunner({ systemd: false, stdout: existing });
    autoupdate.disable({ platform: 'linux', homeDir: home, runner, env: {} });
    const write = runner.calls.find((c) => c.cmd === 'crontab' && c.args[0] !== '-l');
    assert.ok(write, 'the crontab must be rewritten');
    // 2026-08-25, X351. This read `write.args[0]` — a temp file `writeCrontab` had already deleted —
    // so `written` was ALWAYS null and the three assertions below never ran, on any platform, in any
    // checkout. The comment that stood here said the check happened "instead via the marker's absence
    // in the runner's recorded input"; no such check existed anywhere in the file, and none could:
    // the recorded input is a PATH, so the marker can never appear in it.
    //
    // Measured cost, by mutation: inverting autoupdate.js:358 so that `disable()` keeps OUR line and
    // deletes the USER'S made no test in the repository fail — 60/60 in clients/cli and 479/479 in the
    // hooks suite, before and after. `autoupdate off` deleting every one of the user's own cron jobs
    // while leaving the GRU953 updater running was invisible to the whole suite. The three assertions
    // that would have caught it are these, and they were switched off by a guard.
    //
    // The content is now captured by the fake runner at call time, and the guard is GONE: if the
    // capture ever stops working these assertions must fail loudly rather than quietly not run.
    const written = runner.lastText;
    assert.equal(typeof written, 'string', 'the crontab being installed must have been captured');
    assert.match(written, /\/usr\/bin\/backup/, "the user's own backup line must survive");
    assert.match(written, /\/usr\/bin\/weekly/, "the user's own weekly line must survive");
    assert.ok(!written.includes(autoupdate.CRON_MARKER), 'our line must be gone');
    fs.rmSync(home, RM);
});

test('macOS: turning it off deletes the plist, and saying off twice is not an error', () => {
    const home = mkTmp('gru-au-mac-off-');
    const runner = fakeRunner();
    autoupdate.enable({ platform: 'darwin', homeDir: home, runner, env: {} });
    const first = autoupdate.disable({ platform: 'darwin', homeDir: home, runner, env: {} });
    assert.equal(first.ok, true);
    assert.match(first.message, /has been removed/);
    assert.ok(!fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'com.gru953.studio.autoupdate.plist')));
    const second = autoupdate.disable({ platform: 'darwin', homeDir: home, runner, env: {} });
    assert.equal(second.ok, true, 'turning off something already off must not be an error');
    assert.match(second.message, /no daily update check to remove/);
    fs.rmSync(home, RM);
});

test('dryRun changes nothing on disk but shows what would be written', () => {
    const home = mkTmp('gru-au-dry-');
    const r = autoupdate.enable({ platform: 'darwin', homeDir: home, runner: fakeRunner(), dryRun: true, env: {} });
    assert.equal(r.ok, true);
    assert.match(r.detail, /StartCalendarInterval/);
    assert.ok(!fs.existsSync(path.join(home, 'Library')), 'dryRun must not create anything');
    fs.rmSync(home, RM);
});

test('the systemd path honours the given home directory, not the real XDG_CONFIG_HOME', () => {
    // Without env being an argument, a developer with XDG_CONFIG_HOME set would
    // have this test write outside its own fixture — into their real config.
    const home = mkTmp('gru-au-xdg-');
    autoupdate.enable({ platform: 'linux', homeDir: home, runner: fakeRunner({ systemd: true }), env: {} });
    assert.ok(fs.existsSync(path.join(home, '.config', 'systemd', 'user', 'gru953-studio-update.timer')));
    fs.rmSync(home, RM);
});
