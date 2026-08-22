// autoupdate.js — the OPT-IN daily update job.
//
// 2026-08-22, X247: this used to describe "a check on first use each day" as the default. There is
// no such default — see the note in `enable()` and the correction in SECURITY.md. The default is
// that nothing checks at all until the user runs `gru953-studio update` or turns this scheduler on.
// Left in place rather than deleted because the sentence that followed it is still true and useful:
// plugin's own hooks/auto-update.mjs already does that with a `.last-update-check`
// file and a 24-hour window. Nothing runs in the background, and nothing runs
// when the user is not there.
//
// This module is the separate, explicit step: `gru953-studio autoupdate on`
// registers a real daily job with the operating system's own scheduler. It is
// off unless asked for, because software that runs on a schedule without the
// owner choosing it is a different kind of thing from software they open —
// whatever the convenience.
//
// One scheduler per platform, each the OS's own documented mechanism rather than
// a cron entry everywhere (launchd is the supported mechanism on macOS, and cron
// on a modern Mac is both deprecated and blocked by default under System
// Integrity Protection for many paths):
//
//   macOS    launchd, via a LaunchAgent plist in ~/Library/LaunchAgents
//   Windows  Task Scheduler, via schtasks
//   Linux    a systemd --user timer, falling back to crontab where systemd is
//            absent (containers, WSL1, some minimal distributions)
//
// Every path writes ONLY inside the user's own account. Nothing here needs
// administrator rights, and anything that would is not done.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LABEL = 'com.gru953.studio.autoupdate';
const SYSTEMD_UNIT = 'gru953-studio-update';
const CRON_MARKER = '# GRU953-STUDIO:AUTOUPDATE';

/** Where each platform's job definition lives, so status/off can find it. */
function jobPaths({ platform = process.platform, homeDir = os.homedir(), env = process.env } = {}) {
    return {
        launchAgent: path.join(homeDir, 'Library', 'LaunchAgents', `${LABEL}.plist`),
        // env is an argument, not read straight from process.env, so a test
        // pointing at a temporary home directory cannot be redirected somewhere
        // else entirely by whatever XDG_CONFIG_HOME the real machine happens to
        // have set — which would make it write outside its own fixture.
        systemdDir: path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'systemd', 'user'),
        systemdService: `${SYSTEMD_UNIT}.service`,
        systemdTimer: `${SYSTEMD_UNIT}.timer`,
        platform,
    };
}

// The default runner. Injectable throughout this module for one concrete
// reason: without it, testing the cron path would run `crontab` against the
// developer's own account and testing the macOS path would register a real
// LaunchAgent on their machine. A test suite that alters the machine it runs on
// is not a test suite anyone will trust enough to run.
function defaultRunner(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
    return { ok: r.status === 0, status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

function hasSystemd(run) {
    return run('systemctl', ['--user', '--version']).ok;
}

// 2026-08-22, X246: every value below is interpolated into XML, and none of it was escaped. A path
// containing an XML metacharacter therefore produced a plist Apple's own validator rejects — proven,
// not reasoned: `plutil -lint` on a plist built with a cliPath under "/Users/ben & co/…" returns
// "Encountered unknown ampersand-escape sequence at line 9", exit 1, while the ordinary case returns
// OK. launchd then has nothing loadable, and `enable()` still reports "A daily update check is now
// scheduled".
//
// A macOS short username cannot contain `&`, which is why this is narrow rather than common — but a
// path can, because the CLI can be installed anywhere and `updateLogPath()` is built from
// `os.homedir()`. Narrow is not the same as impossible, and the fix costs five lines.
function xmlEscape(v) {
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function launchAgentPlist(nodePath, cliPath) {
    // A fixed hour rather than a repeating interval: StartInterval fires
    // relative to load time, so on a laptop that sleeps and wakes it drifts and
    // can fire the moment the lid opens. StartCalendarInterval at a quiet hour
    // is predictable and does not compete with the user for the machine.
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(cliPath)}</string>
    <string>update</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>17</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${xmlEscape(updateLogPath())}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(updateLogPath())}</string>
</dict>
</plist>
`;
}

function systemdUnits(nodePath, cliPath) {
    return {
        service: `[Unit]
Description=Check for a GRU953-Studio update

[Service]
Type=oneshot
ExecStart=${nodePath} ${cliPath} update
`,
        // Persistent=true so a machine that was off at the scheduled time still
        // checks once when it comes back, rather than skipping that day
        // entirely. RandomizedDelaySec spreads the load so every installation
        // does not call GitHub at the same second.
        timer: `[Unit]
Description=Daily GRU953-Studio update check

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
`,
    };
}

// 2026-08-22: this used to `return r.ok ? r.stdout : ''` — an empty string for ANY non-zero exit.
// The comment justified that for one case, an empty crontab, and it was right about that case. But
// `writeCrontab` runs `crontab <file>`, which REPLACES THE WHOLE TABLE, so on a machine where the
// READ failed while entries existed — a permissions problem, a missing spool directory, a cron
// daemon that is not there — enabling a daily update check would have deleted every other cron job
// the user had, and then reported "A daily update check is now scheduled".
//
// So the two cases are now separated and the caller is required to look. An empty crontab really
// does exit non-zero, with "no crontab for <user>" on stderr and nothing on stdout; a genuine
// failure says something else. Where the answer is not clearly "empty", the only safe action is to
// refuse to write, and both callers below do.
function readCrontab(run) {
    const r = run('crontab', ['-l']);
    if (r.ok) return { text: r.stdout, readable: true };
    const err = String(r.stderr || '').trim();
    // "no crontab for sam" — and the empty-stderr case, which is what a fake runner in the tests
    // produces and what some cron implementations do for the same condition.
    if (err === '' || /no crontab/i.test(err)) return { text: '', readable: true };
    return { text: '', readable: false, error: err };
}

function writeCrontab(run, text) {
    const tmp = path.join(os.tmpdir(), `gru953-cron-${process.pid}`);
    fs.writeFileSync(tmp, text.endsWith('\n') ? text : text + '\n', 'utf8');
    const r = run('crontab', [tmp]);
    fs.rmSync(tmp, { force: true });
    return r;
}

// 2026-08-22, X232: ONE definition of where a scheduled run's output goes, because the launchd
// plist and the crontab line each used to decide for themselves — the plist named
// `~/.gru953-studio-update.log` and cron named /dev/null. Two mechanisms holding different answers to
// the same question is the L14 shape, and here one of the answers was "throw it away".
function updateLogPath() {
  return path.join(os.homedir(), '.gru953-studio-update.log');
}

function cronLineFor(nodePath, cliPath) {
    // 2026-08-22, X232: this ended `>/dev/null 2>&1`, which discarded the updater's ONLY failure
    // report — four console.error lines and a non-zero exit code — on the one path where nobody is
    // watching. SECURITY.md promised "if the pull leaves conflicts, the updater reports them and
    // stops"; on this path it stopped and reported to nothing, leaving literal conflict markers in
    // the user's tracked files and their uncommitted work un-popped in a stash, with nothing said.
    //
    // Output now goes to a log the user can be pointed at, and stderr is merged into it rather than
    // thrown away. cron also mails a job's output to the local user by default, and dropping the
    // redirect entirely would resurrect that noise every night for the ordinary no-op case — so the
    // output is kept, in a named file, rather than either discarded or mailed.
    return `17 4 * * * "${nodePath}" "${cliPath}" update >> "${updateLogPath()}" 2>&1 ${CRON_MARKER}`;
}

/**
 * @returns {{ok: boolean, mechanism: string, message: string, detail?: string}}
 */
function enable(options = {}) {
    const {
        platform = process.platform,
        homeDir = os.homedir(),
        nodePath = process.execPath,
        cliPath = path.join(__dirname, 'index.js'),
        dryRun = false,
        runner = defaultRunner,
        env = process.env,
    } = options;
    const run = runner;
    const p = jobPaths({ platform, homeDir, env });

    if (platform === 'darwin') {
        if (dryRun) return { ok: true, mechanism: 'launchd', message: `would write ${p.launchAgent}`, detail: launchAgentPlist(nodePath, cliPath) };
        fs.mkdirSync(path.dirname(p.launchAgent), { recursive: true });
        fs.writeFileSync(p.launchAgent, launchAgentPlist(nodePath, cliPath), 'utf8');
        // `bootstrap` is the current verb; `load` is the deprecated one. Try the
        // modern form first and fall back, so this works on both older and
        // current macOS without reporting a failure on either.
        const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
        let r = run('launchctl', ['bootstrap', `gui/${uid}`, p.launchAgent]);
        if (!r.ok) r = run('launchctl', ['load', '-w', p.launchAgent]);
        return {
            ok: true, // the plist is written; launchd picks it up at next login regardless
            mechanism: 'launchd',
            message: r.ok
                ? `A daily update check is now scheduled (macOS launchd), and is active straight away. It pulls new code from GitHub and that code then runs; its output, including any failure, is written to ${updateLogPath()}.`
                : `A daily update check is now scheduled (macOS launchd). It becomes active the next time you log in. It pulls new code from GitHub and that code then runs; its output, including any failure, is written to ${updateLogPath()}.`,
        };
    }

    if (platform === 'win32') {
        if (dryRun) return { ok: true, mechanism: 'schtasks', message: 'would register a Task Scheduler task' };
        const r = run('schtasks', [
            '/Create', '/F',
            '/SC', 'DAILY',
            '/ST', '04:17',
            '/TN', 'GRU953-Studio Update',
            '/TR', `"${nodePath}" "${cliPath}" update`,
        ], { shell: true });
        return r.ok
            ? { ok: true, mechanism: 'schtasks', message: 'A daily update check is now scheduled (Windows Task Scheduler). It pulls new code from GitHub and that code then runs. NOTE: this mechanism does not capture the updater output, so a failed update reports to nothing — run `gru953-studio update` by hand if you want to see the result.' }
            : { ok: false, mechanism: 'schtasks', message: `Could not create the scheduled task. ${r.stderr.trim() || r.stdout.trim()}` };
    }

    // Linux and anything else POSIX.
    if (hasSystemd(run)) {
        const units = systemdUnits(nodePath, cliPath);
        if (dryRun) return { ok: true, mechanism: 'systemd', message: `would write ${p.systemdTimer}`, detail: units.timer };
        fs.mkdirSync(p.systemdDir, { recursive: true });
        fs.writeFileSync(path.join(p.systemdDir, p.systemdService), units.service, 'utf8');
        fs.writeFileSync(path.join(p.systemdDir, p.systemdTimer), units.timer, 'utf8');
        run('systemctl', ['--user', 'daemon-reload']);
        const r = run('systemctl', ['--user', 'enable', '--now', p.systemdTimer]);
        return r.ok
            ? { ok: true, mechanism: 'systemd', message: 'A daily update check is now scheduled (systemd user timer). It pulls new code from GitHub and that code then runs; its output goes to the systemd journal — see it with `journalctl --user -u gru953-studio-update`.' }
            : { ok: false, mechanism: 'systemd', message: `The timer files were written but could not be started. ${r.stderr.trim()}` };
    }

    if (dryRun) return { ok: true, mechanism: 'cron', message: 'would add a crontab line', detail: cronLineFor(nodePath, cliPath) };
    const read = readCrontab(run);
    if (!read.readable) {
        return {
            ok: false,
            mechanism: 'cron',
            message: `Could not read your crontab, so nothing was changed. Writing one would have replaced every entry in it. ${read.error || ''}`.trim(),
        };
    }
    const existing = read.text;
    const wanted = cronLineFor(nodePath, cliPath);
    // 2026-08-22: X232 gave the cron line a real log path instead of `>/dev/null 2>&1`, and this
    // early return meant no machine that had already enabled the job ever received that fix — the
    // nightly run kept discarding its only failure report, and re-running the documented remedy
    // reported success while changing nothing. The macOS path rewrites its plist unconditionally, so
    // one mechanism self-healed and the other did not: the same L14 asymmetry X232 set out to remove.
    // Our own line is therefore compared, not merely detected, and replaced when it is out of date.
    if (existing.includes(CRON_MARKER)) {
        const lines = existing.split('\n');
        const mine = lines.filter((l) => l.includes(CRON_MARKER));
        if (mine.length === 1 && mine[0].trim() === wanted.trim()) {
            return { ok: true, mechanism: 'cron', message: 'A daily update check was already scheduled (cron). Nothing changed.' };
        }
        const migrated = lines.filter((l) => !l.includes(CRON_MARKER)).join('\n');
        const rm = writeCrontab(run, `${migrated.trimEnd()}\n${wanted}`.trimStart());
        return rm.ok
            ? {
                  ok: true,
                  mechanism: 'cron',
                  message: `An out-of-date daily update check was already scheduled (cron); its line has been rewritten. Older versions sent the updater's output to /dev/null, so a failed update reported to nothing. Its output, including any failure, now goes to ${updateLogPath()}.`,
              }
            : { ok: false, mechanism: 'cron', message: `Could not rewrite the out-of-date crontab line. ${rm.stderr.trim()}` };
    }
    const r = writeCrontab(run, `${existing.trimEnd()}\n${wanted}`.trimStart());
    return r.ok
        ? { ok: true, mechanism: 'cron', message: `A daily update check is now scheduled (cron). It pulls new code from GitHub and that code then runs; its output, including any failure, is written to ${updateLogPath()}.` }
        : { ok: false, mechanism: 'cron', message: `Could not update your crontab. ${r.stderr.trim()}` };
}

/** @returns {{ok: boolean, mechanism: string, message: string}} */
function disable(options = {}) {
    const { platform = process.platform, homeDir = os.homedir(), runner = defaultRunner, env = process.env } = options;
    const run = runner;
    const p = jobPaths({ platform, homeDir, env });

    if (platform === 'darwin') {
        const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
        if (fs.existsSync(p.launchAgent)) {
            let r = run('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
            if (!r.ok) run('launchctl', ['unload', '-w', p.launchAgent]);
            fs.rmSync(p.launchAgent, { force: true });
            return { ok: true, mechanism: 'launchd', message: 'The daily update check has been removed.' };
        }
        return { ok: true, mechanism: 'launchd', message: 'There was no daily update check to remove.' };
    }

    if (platform === 'win32') {
        const r = run('schtasks', ['/Delete', '/F', '/TN', 'GRU953-Studio Update'], { shell: true });
        if (r.ok) return { ok: true, mechanism: 'schtasks', message: 'The daily update check has been removed.' };
        // 2026-08-22: every failure used to report "There was no daily update check to remove."
        // Access denied, a Task Scheduler service that is not running and a task that genuinely is
        // not there all produced the same sentence, so the one case where the user needed to act
        // read exactly like the case where nothing was needed. Only absence is absence.
        const err = `${r.stderr || ''} ${r.stdout || ''}`.trim();
        const absent = /cannot find|does not exist|no such|not exist/i.test(err);
        return absent
            ? { ok: true, mechanism: 'schtasks', message: 'There was no daily update check to remove.' }
            : {
                  ok: false,
                  mechanism: 'schtasks',
                  message: `The daily update check may STILL be scheduled — the task could not be deleted. ${err}`,
              };
    }

    let removedAnything = false;
    if (hasSystemd(run) && fs.existsSync(path.join(p.systemdDir, p.systemdTimer))) {
        run('systemctl', ['--user', 'disable', '--now', p.systemdTimer]);
        fs.rmSync(path.join(p.systemdDir, p.systemdTimer), { force: true });
        fs.rmSync(path.join(p.systemdDir, p.systemdService), { force: true });
        run('systemctl', ['--user', 'daemon-reload']);
        removedAnything = true;
    }
    // 2026-08-22: this called writeCrontab and DISCARDED its result, then set removedAnything
    // unconditionally — so a failed write reported "The daily update check has been removed." while
    // the job stayed scheduled and kept running every night. Throwing away the only signal that says
    // whether the thing you promised actually happened is the same shape as the /dev/null redirect
    // this file was already corrected for.
    const read = readCrontab(run);
    if (!read.readable) {
        return {
            ok: false,
            mechanism: 'cron',
            message: `Could not read your crontab, so a scheduled update check may still be there. ${read.error || ''} Check it with \`crontab -l\`.`.trim(),
        };
    }
    if (read.text.includes(CRON_MARKER)) {
        const rm = writeCrontab(run, read.text.split('\n').filter((l) => !l.includes(CRON_MARKER)).join('\n'));
        if (!rm.ok) {
            return {
                ok: false,
                mechanism: 'cron',
                message: `The daily update check is STILL SCHEDULED — your crontab could not be rewritten. ${rm.stderr.trim()}`,
            };
        }
        removedAnything = true;
    }
    return {
        ok: true,
        mechanism: hasSystemd(run) ? 'systemd' : 'cron',
        message: removedAnything ? 'The daily update check has been removed.' : 'There was no daily update check to remove.',
    };
}

/** @returns {{enabled: boolean, mechanism: string, message: string}} */
function status(options = {}) {
    const { platform = process.platform, homeDir = os.homedir(), runner = defaultRunner, env = process.env } = options;
    const run = runner;
    const p = jobPaths({ platform, homeDir, env });
    if (platform === 'darwin') {
        const on = fs.existsSync(p.launchAgent);
        return { enabled: on, mechanism: 'launchd', message: on ? `Scheduled daily (macOS launchd). Definition: ${p.launchAgent}` : 'Not scheduled, and nothing checks on its own. GRU953-Studio updates only when you ask it to — run `gru953-studio update`, or `/studio-update` inside a session.' };
    }
    if (platform === 'win32') {
        const on = run('schtasks', ['/Query', '/TN', 'GRU953-Studio Update'], { shell: true }).ok;
        return { enabled: on, mechanism: 'schtasks', message: on ? 'Scheduled daily (Windows Task Scheduler).' : 'Not scheduled, and nothing checks on its own. GRU953-Studio updates only when you ask it to — run `gru953-studio update`, or `/studio-update` inside a session.' };
    }
    const timerFile = path.join(p.systemdDir, p.systemdTimer);
    if (fs.existsSync(timerFile)) return { enabled: true, mechanism: 'systemd', message: `Scheduled daily (systemd user timer). Definition: ${timerFile}` };
    if (readCrontab(run).includes(CRON_MARKER)) return { enabled: true, mechanism: 'cron', message: 'Scheduled daily (cron).' };
    return { enabled: false, mechanism: hasSystemd(run) ? 'systemd' : 'cron', message: 'Not scheduled, and nothing checks on its own. GRU953-Studio updates only when you ask it to — run `gru953-studio update`, or `/studio-update` inside a session.' };
}

module.exports = {
    defaultRunner,
    enable,
    disable,
    status,
    jobPaths,
    launchAgentPlist,
    systemdUnits,
    cronLineFor,
    LABEL,
    CRON_MARKER,
};
