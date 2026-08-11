// autoupdate.js — the OPT-IN daily update job.
//
// The default, which needs nothing here, is a check on first use each day: the
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

function launchAgentPlist(nodePath, cliPath) {
    // A fixed hour rather than a repeating interval: StartInterval fires
    // relative to load time, so on a laptop that sleeps and wakes it drifts and
    // can fire the moment the lid opens. StartCalendarInterval at a quiet hour
    // is predictable and does not compete with the user for the machine.
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliPath}</string>
    <string>update</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>17</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${path.join(os.homedir(), '.gru953-studio-update.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(os.homedir(), '.gru953-studio-update.log')}</string>
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

function readCrontab(run) {
    const r = run('crontab', ['-l']);
    // An empty crontab exits non-zero with "no crontab for <user>", which is not
    // an error condition — treating it as one would make the first-ever enable
    // fail on a machine that simply has no cron entries yet.
    return r.ok ? r.stdout : '';
}

function writeCrontab(run, text) {
    const tmp = path.join(os.tmpdir(), `gru953-cron-${process.pid}`);
    fs.writeFileSync(tmp, text.endsWith('\n') ? text : text + '\n', 'utf8');
    const r = run('crontab', [tmp]);
    fs.rmSync(tmp, { force: true });
    return r;
}

function cronLineFor(nodePath, cliPath) {
    return `17 4 * * * "${nodePath}" "${cliPath}" update >/dev/null 2>&1 ${CRON_MARKER}`;
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
                ? 'A daily update check is now scheduled (macOS launchd), and is active straight away.'
                : 'A daily update check is now scheduled (macOS launchd). It becomes active the next time you log in.',
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
            ? { ok: true, mechanism: 'schtasks', message: 'A daily update check is now scheduled (Windows Task Scheduler).' }
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
            ? { ok: true, mechanism: 'systemd', message: 'A daily update check is now scheduled (systemd user timer).' }
            : { ok: false, mechanism: 'systemd', message: `The timer files were written but could not be started. ${r.stderr.trim()}` };
    }

    if (dryRun) return { ok: true, mechanism: 'cron', message: 'would add a crontab line', detail: cronLineFor(nodePath, cliPath) };
    const existing = readCrontab(run);
    if (existing.includes(CRON_MARKER)) {
        return { ok: true, mechanism: 'cron', message: 'A daily update check was already scheduled (cron). Nothing changed.' };
    }
    const r = writeCrontab(run, `${existing.trimEnd()}\n${cronLineFor(nodePath, cliPath)}`.trimStart());
    return r.ok
        ? { ok: true, mechanism: 'cron', message: 'A daily update check is now scheduled (cron).' }
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
        return {
            ok: true,
            mechanism: 'schtasks',
            message: r.ok ? 'The daily update check has been removed.' : 'There was no daily update check to remove.',
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
    const existing = readCrontab(run);
    if (existing.includes(CRON_MARKER)) {
        writeCrontab(run, existing.split('\n').filter((l) => !l.includes(CRON_MARKER)).join('\n'));
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
        return { enabled: on, mechanism: 'launchd', message: on ? `Scheduled daily (macOS launchd). Definition: ${p.launchAgent}` : 'Not scheduled. GRU953-Studio checks for an update the first time you use it each day.' };
    }
    if (platform === 'win32') {
        const on = run('schtasks', ['/Query', '/TN', 'GRU953-Studio Update'], { shell: true }).ok;
        return { enabled: on, mechanism: 'schtasks', message: on ? 'Scheduled daily (Windows Task Scheduler).' : 'Not scheduled. GRU953-Studio checks for an update the first time you use it each day.' };
    }
    const timerFile = path.join(p.systemdDir, p.systemdTimer);
    if (fs.existsSync(timerFile)) return { enabled: true, mechanism: 'systemd', message: `Scheduled daily (systemd user timer). Definition: ${timerFile}` };
    if (readCrontab(run).includes(CRON_MARKER)) return { enabled: true, mechanism: 'cron', message: 'Scheduled daily (cron).' };
    return { enabled: false, mechanism: hasSystemd(run) ? 'systemd' : 'cron', message: 'Not scheduled. GRU953-Studio checks for an update the first time you use it each day.' };
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
